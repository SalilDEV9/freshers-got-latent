"""Disposable server for browser acceptance tests; never uses the live database."""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

password=os.environ.get('FGL_E2E_PASSWORD')
if not password or len(password)<12:
    raise SystemExit('Set FGL_E2E_PASSWORD to a temporary 12+ character test password.')
with tempfile.TemporaryDirectory() as folder:
    os.environ['DATABASE_URL']='sqlite:///'+str(Path(folder)/'browser-test.db')
    os.environ['ALLOWED_ORIGINS']='http://127.0.0.1:8000'
    os.environ['COOKIE_SECURE']='false'
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
    from app.db import Base,engine,transaction,User,Event
    from app.domain import initial_event
    from app.operations import new_act
    from app.security import password_hash
    Base.metadata.create_all(engine)
    with transaction() as s:
        judges=[]
        for name,role in [('admin','super_admin'),('judge1','judge'),('judge2','judge'),('viewer','audience')]:
            u=User(username=name,name=name,role=role,password=password_hash(password));s.add(u);s.flush()
            if role=='judge':judges.append(u.id)
        data=initial_event();data.update(phase='LIVE',judges=judges,judge_names={str(j):'Judge '+str(i+1) for i,j in enumerate(judges)})
        act=new_act({'name':'Browser rehearsal','category':'Music','bio':'A fictional browser test.'},1,'JUDGING')
        act.update(self_score=8,self_locked_at=1,panel=judges)
        data['participants']=[act];s.add(Event(id=1,data=data))
    proc=subprocess.Popen([sys.executable,'-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000'],cwd=Path(__file__).resolve().parents[1]/'backend',env=os.environ)
    try: raise SystemExit(proc.wait())
    finally:
        if proc.poll() is None:proc.terminate();proc.wait(timeout=10)
