import os
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

TEST_DIR = tempfile.TemporaryDirectory()
test_url=os.getenv('TEST_DATABASE_URL')
if test_url and ('/fgl_test' not in test_url or os.getenv('FGL_ALLOW_TEST_DATABASE')!='1'):
    raise RuntimeError('Refusing to reset an unapproved test database.')
os.environ['DATABASE_URL'] = test_url or 'sqlite:///' + str(Path(TEST_DIR.name) / 'test.db')
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.main import app
from app.db import Base, engine, Session, User, Event, transaction
from app.domain import initial_event, result_for, validate_rules, score_value
from app.security import password_hash
import pytest

HEADERS = {'X-FGL-Request': '1'}
PASSWORD = 'test-only-password-123'

@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with transaction() as s:
        s.add(Event(id=1, data=initial_event()))
        for name, role in [('admin','super_admin'),('judge1','judge'),('judge2','judge'),('backstage','backstage'),('controller','controller'),('host','host'),('viewer','audience')]:
            s.add(User(username=name, name=name, role=role, password=password_hash(PASSWORD)))
    with TestClient(app, headers=HEADERS) as c:
        yield c

def login(c, username='admin'):
    r=c.post('/api/login',json={'username':username,'password':PASSWORD})
    assert r.status_code==200, r.text
    return r.json()

def command(c, action, payload=None, pid=None, status=200, revision=None):
    rev = c.get('/api/event').json()['revision'] if revision is None else revision
    r=c.post('/api/command',json={'revision':rev,'action':action,'payload':payload or {},'participant_id':pid})
    assert r.status_code==status, r.text
    return r.json()

def prepare(c):
    login(c)
    users=c.get('/api/users').json()
    judges=[u['id'] for u in users if u['role']=='judge']
    command(c,'settings',{'judges':judges})
    e=command(c,'participant_add',{'name':'Rehearsal act','category':'Music','bio':'A test performance.'})
    pid=e['participants'][0]['id']
    for state in ['CHECKED_IN','BACKSTAGE']:
        command(c,'transition',{'state':state},pid)
    command(c,'self_score',{'value':8},pid)
    command(c,'transition',{'state':'READY'},pid)
    command(c,'phase',{'phase':'LIVE'})
    for state in ['ON_STAGE','PERFORMING','JUDGING']:
        command(c,'transition',{'state':state},pid)
    return pid

def test_full_event_with_reveal_and_vote(client):
    c=client;pid=prepare(c)
    command(c,'transition',{'state':'REVEAL'},pid,status=422)
    for name,value in [('judge1',7),('judge2',9)]:
        login(c,name)
        e=command(c,'score',{'value':value},pid)
        assert e['participants'][0]['my_score']['value']==value
        assert 'scores' not in e['participants'][0] and 'self_score' not in str(e)
        command(c,'score',{'value':1},pid,status=422)
    c.post('/api/logout',json={})
    public=c.get('/api/event').json()['participants'][0]
    assert set(public)=={'id','name','category','bio','state','position','members'}
    login(c,'controller')
    e=command(c,'transition',{'state':'REVEAL'},pid)
    assert e['participants'][0]['result']=={'average':8,'self_score':8,'difference':0,'match':True}
    command(c,'transition',{'state':'COMPLETED'},pid)
    command(c,'voting',{'open':True})
    login(c,'viewer')
    assert c.post('/api/vote',json={'participant_id':pid}).status_code==200
    assert c.post('/api/vote',json={'participant_id':pid}).status_code==409
    assert 'audience_results' not in c.get('/api/event').json()
    login(c,'controller');command(c,'phase',{'phase':'ENDED'})
    assert c.get('/api/event').json()['audience_results'][pid]==1
    assert 'Rehearsal act' in c.get('/api/export.csv').text

def test_role_and_origin_guards(client):
    c=client
    assert c.post('/api/command',json={'revision':0,'action':'phase'}).status_code==401
    login(c,'viewer')
    command(c,'participant_add',{'name':'x','category':'Music'},status=403)
    assert c.get('/api/users').status_code==403
    assert c.get('/api/audit').status_code==403
    assert c.post('/api/logout',json={},headers={'Origin':'https://attacker.example'}).status_code==403
    assert c.post('/api/logout',json={},headers={'X-FGL-Request':''}).status_code==403

def test_stale_command_and_immutable_rules(client):
    c=client;pid=prepare(c)
    command(c,'announcement',{'text':'Old tab'},revision=0,status=409)
    command(c,'settings',{'judges':[2]},status=422)
    command(c,'self_score',{'value':4},pid,status=422)
    command(c,'phase',{'phase':'PAUSED'})
    login(c,'judge1');command(c,'score',{'value':8},pid,status=422)

def test_stage_order_and_single_active_act(client):
    c=client;pid=prepare(c)
    e=command(c,'participant_add',{'name':'Act two','category':'Dance'});p2=e['participants'][1]['id']
    command(c,'transition',{'state':'ON_STAGE'},p2,status=422)
    for st in ['CHECKED_IN','BACKSTAGE']:
        command(c,'transition',{'state':st},p2)
    command(c,'transition',{'state':'READY'},p2,status=422)
    command(c,'self_score',{'value':7},p2)
    command(c,'transition',{'state':'READY'},p2)
    command(c,'transition',{'state':'ON_STAGE'},p2,status=422)
    command(c,'transition',{'state':'SKIPPED'},pid,status=422)
    command(c,'phase',{'phase':'ENDED'},status=422)

def test_audit_has_no_hidden_scores(client):
    c=client;prepare(c)
    logs=c.get('/api/audit').json()
    assert all('value' not in a['detail'] and 'self_score' not in a['detail'] for a in logs)

def test_account_escalation_and_unassigned_judge(client):
    c=client;pid=prepare(c)
    assert c.post('/api/users',json={'username':'third','name':'Third','role':'judge','password':PASSWORD}).status_code==201
    login(c,'third');command(c,'score',{'value':5},pid,status=422)
    assert c.post('/api/users',json={'username':'hacker','name':'x','role':'super_admin','password':PASSWORD}).status_code==403

def test_csv_formula_injection_and_no_early_export(client):
    c=client;prepare(c)
    command(c,'participant_add',{'name':'=CMD()','category':'@Music'})
    text=c.get('/api/export.csv').text
    assert "'=CMD()" in text and "'@Music" in text
    assert '8.0' not in text

def test_concurrent_commands_have_one_winner(client):
    c=client;login(c)
    rev=c.get('/api/event').json()['revision']
    cookies=dict(c.cookies)
    def submit(text):
        with TestClient(app,headers=HEADERS,cookies=cookies) as other:
            return other.post('/api/command',json={'revision':rev,'action':'announcement','payload':{'text':text}}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(submit,['First','Second']))
    assert sorted(results)==[200,409]

def test_websocket_only_revision(client):
    with client.websocket_connect('/api/ws') as ws:
        assert ws.receive_json()=={'revision':0}

def test_session_invalidation(client):
    login(client)
    assert client.get('/api/me').json()['role']=='super_admin'
    old=dict(client.cookies)
    client.post('/api/logout',json={})
    client.cookies.update(old)
    assert client.get('/api/me').json() is None

@pytest.mark.parametrize('mode,scores,prediction,expected',[
    ('exact',[7,9],8,True),('exact',[7,8,8],7.67,False),
    ('nearest',[7,8],8,True),('nearest',[7,8],7,False),
    ('quarter',[7.5,8],8,True),('quarter',[7.4,8],8,False),
    ('half',[7,8],8,True),('half',[6.9,8],8,False)])
def test_matching_precision(mode,scores,prediction,expected):
    p={'self_score':prediction,'scores':{str(i):{'value':v} for i,v in enumerate(scores)}}
    assert result_for(p,{'mode':mode})['match'] is expected

@pytest.mark.parametrize('value',[0,11,7.5,True,'NaN','Infinity'])
def test_score_validation(value):
    with pytest.raises((ValueError,ArithmeticError)):
        score_value(value,{'minimum':1,'maximum':10,'step':1})

def test_invalid_rules():
    with pytest.raises(ValueError):
        validate_rules({'minimum':1,'maximum':10,'step':0,'mode':'exact'})
