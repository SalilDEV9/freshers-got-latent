"""Create a separate rehearsal database, refusing to touch an existing event."""
import os
import secrets
import time
from uuid import uuid4
from .db import Base, engine, transaction, User, Event
from .domain import initial_event
from .security import password_hash


def main():
    if os.getenv('FGL_REHEARSAL') != '1':
        raise SystemExit('Set FGL_REHEARSAL=1 and point DATABASE_URL at a separate rehearsal database.')
    Base.metadata.create_all(engine)
    with transaction() as s:
        if s.get(Event, 1):
            raise SystemExit('An event already exists. Refusing to overwrite it.')
        credentials=[]
        judges=[]
        for username, name, role in [('admin','Rehearsal organiser','super_admin'),('judge1','Rehearsal judge A','judge'),('judge2','Rehearsal judge B','judge'),('controller','Rehearsal controller','controller'),('backstage','Rehearsal volunteer','backstage'),('host','Rehearsal host','host'),('audience','Rehearsal audience','audience')]:
            password=secrets.token_urlsafe(18)
            user=User(username=username,name=name,role=role,password=password_hash(password))
            s.add(user);s.flush()
            credentials.append((username,password))
            if role=='judge':
                judges.append(user.id)
        event=initial_event()
        event.update(phase='LIVE',judges=judges,announcement='REHEARSAL · Sample performers and scores. Not the official event.')
        for i,(name,category,state,prediction,scores) in enumerate([
            ('Sample act · Acoustic set','Music','JUDGING',8,{}),
            ('Sample act · Stand-up','Comedy','READY',7,{}),
            ('Sample act · Freestyle','Dance','BACKSTAGE',None,{}),
            ('Sample act · Spoken word','Poetry','CHECKED_IN',None,{}),
            ('Sample act · Close-up magic','Magic','REGISTERED',None,{}),
        ]):
            event['participants'].append({'id':str(uuid4()),'name':name,'category':category,'bio':'A fictional act for the team’s event rehearsal.','state':state,'position':i+1,'self_score':prediction,'self_locked_at':time.time() if prediction else None,'scores':scores})
        s.add(Event(id=1,data=event))
    print('Rehearsal created. Keep these generated credentials private:')
    for username,password in credentials:
        print(username + ': ' + password)

if __name__=='__main__':
    main()
