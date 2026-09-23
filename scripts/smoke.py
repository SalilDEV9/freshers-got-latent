"""Real HTTP + WebSocket rehearsal. Uses a disposable database and random passwords."""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
import httpx
from websockets.sync.client import connect

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as tmp:
    env = {**os.environ, 'DATABASE_URL': 'sqlite:///' + str(Path(tmp) / 'rehearsal.db'), 'FGL_REHEARSAL': '1'}
    seeded = subprocess.run([sys.executable, '-m', 'app.rehearsal'], cwd=ROOT/'backend', env=env, check=True, capture_output=True, text=True)
    credentials = dict(line.split(': ', 1) for line in seeded.stdout.splitlines()[1:])
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0))
        port = sock.getsockname()[1]
    origin = f'http://127.0.0.1:{port}'
    headers = {'X-FGL-Request':'1'}
    with open(Path(tmp)/'server.log','w+') as log:
        def start():
            proc = subprocess.Popen([sys.executable,'-m','uvicorn','app.main:app','--host','127.0.0.1','--port',str(port)],cwd=ROOT/'backend',env=env,stdout=log,stderr=log)
            for _ in range(100):
                try:
                    if httpx.get(origin+'/api/health', trust_env=False).status_code==200:
                        return proc
                except httpx.TransportError:
                    pass
                if proc.poll() is not None:
                    raise RuntimeError('Server exited during startup.')
                time.sleep(.1)
            proc.terminate();proc.wait()
            raise RuntimeError('Server did not become ready.')
        proc = start()
        try:
            with httpx.Client(base_url=origin,headers=headers,trust_env=False) as client:
                assert 'Freshers Got Latent' in client.get('/').text
                initial = client.get('/api/event').json()
                pid = initial['participants'][0]['id']
                assert 'self_score' not in json.dumps(initial)
                with connect(f'ws://127.0.0.1:{port}/api/ws',proxy=None) as ws:
                    assert json.loads(ws.recv())=={'revision':0}
                def login(name):
                    r=client.post('/api/login',json={'username':name,'password':credentials[name]})
                    assert r.status_code==200, r.text
                def command(action,payload=None):
                    revision=client.get('/api/event').json()['revision']
                    r=client.post('/api/command',json={'revision':revision,'action':action,'payload':payload or {},'participant_id':pid})
                    assert r.status_code==200,r.text
                    return r.json()
                for name,value in [('judge1',7),('judge2',9)]:
                    login(name)
                    command('score',{'value':value})
                login('controller')
                revealed=command('transition',{'state':'REVEAL'})
                assert revealed['participants'][0]['result']['match'] is True
                command('transition',{'state':'COMPLETED'})
                command('voting',{'open':True})
                login('audience')
                assert client.post('/api/vote',json={'participant_id':pid}).status_code==200
                assert client.get('/api/audit').status_code==403
                login('controller');command('phase',{'phase':'ENDED'})
                proc.terminate();proc.wait(timeout=10)
                proc=start()
                persisted=client.get('/api/event').json()
                assert persisted['phase']=='ENDED'
                assert persisted['audience_results'][pid]==1
                assert persisted['participants'][0]['result']['average']==8
                assert client.get('/api/export.csv').status_code==200
            print('PASS: built UI served; HTTP login, scoring, reveal, vote, role denial, CSV, WebSocket, and restart persistence.')
        finally:
            proc.terminate();proc.wait(timeout=10)
