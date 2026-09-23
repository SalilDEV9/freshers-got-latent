from test_event import client, login, command, prepare, PASSWORD

def test_account_disable_and_reset(client):
    c=client;login(c,'viewer');old=dict(c.cookies);login(c)
    uid=next(u['id'] for u in c.get('/api/users').json() if u['username']=='viewer')
    route=f'/api/users/{uid}/manage'
    assert c.post(route,json={'action':'disable'}).status_code==200
    c.cookies.clear();c.cookies.update(old)
    assert c.get('/api/me').json() is None
    assert c.post('/api/login',json={'username':'viewer','password':PASSWORD}).status_code==401
    login(c);assert c.post(route,json={'action':'enable'}).status_code==200
    assert c.post(route,json={'action':'reset_password','password':'replacement-password-123'}).status_code==200
    assert c.post('/api/login',json={'username':'viewer','password':PASSWORD}).status_code==401
    assert c.post('/api/login',json={'username':'viewer','password':'replacement-password-123'}).status_code==200

def test_password_change_revokes_sessions(client):
    c=client;login(c,'viewer');old=dict(c.cookies)
    assert c.post('/api/password',json={'old_password':'wrong','new_password':'replacement-password-123'}).status_code==403
    assert c.post('/api/password',json={'old_password':PASSWORD,'new_password':'replacement-password-123'}).status_code==200
    c.cookies.update(old);assert c.get('/api/me').json() is None

def test_admin_and_panel_account_protection(client):
    c=client;prepare(c);accounts=c.get('/api/users').json()
    for username,status in [('admin',422),('judge1',409)]:
        uid=next(u['id'] for u in accounts if u['username']==username)
        assert c.post(f'/api/users/{uid}/manage',json={'action':'disable'}).status_code==status

def test_registration_is_private_until_approval(client):
    c=client;login(c);command(c,'registration',{'open':True});login(c,'viewer')
    body={'name':'Duo','category':'Music','members':['A','B']}
    assert c.post('/api/register',json={**body,'consent':False}).status_code==422
    r=c.post('/api/register',json={**body,'consent':True});assert r.status_code==201
    pid=r.json()['id'];e=c.get('/api/event').json()
    assert e['participants']==[] and e['my_registration']['state']=='PENDING'
    assert c.post('/api/register',json={**body,'consent':True}).status_code==409
    c.post('/api/logout',json={});assert c.get('/api/event').json()['participants']==[]
    login(c,'backstage');command(c,'approve',{},pid)
    c.post('/api/logout',json={});act=c.get('/api/event').json()['participants'][0]
    assert act['members']==['A','B'] and 'registered_by' not in act

def test_csv_import_atomic_and_editable(client):
    c=client;login(c,'backstage')
    e=command(c,'roster_import',{'csv':'name,category,bio,members\n"Duo, one",Music,"A, B",A;B\n'})
    act=e['participants'][0];assert act['members']==['A','B']
    command(c,'roster_import',{'csv':'name,category\nNew,Dance\nNew,Music\n'},status=422)
    assert len(c.get('/api/event').json()['participants'])==1
    command(c,'participant_edit',{'name':'New name','category':'Music','members':['A','B']},act['id'])
    assert c.get('/api/event').json()['participants'][0]['name']=='New name'

def reserve(c):
    assert c.post('/api/users',json={'name':'Reserve','username':'reserve','password':PASSWORD,'role':'judge'}).status_code==201
    return {u['username']:u['id'] for u in c.get('/api/users').json()}

def test_reserve_judge_reveal_gate(client):
    c=client;pid=prepare(c);ids=reserve(c)
    command(c,'replace_judge',{'old':ids['judge2'],'new':ids['reserve'],'reason':'Unavailable'})
    login(c,'judge2');command(c,'score',{'value':8},pid,status=422)
    login(c,'judge1');command(c,'score',{'value':8},pid)
    login(c);command(c,'transition',{'state':'REVEAL'},pid,status=422)
    login(c,'reserve');command(c,'score',{'value':8},pid)
    login(c);assert command(c,'transition',{'state':'REVEAL'},pid)['participants'][0]['result']['match']

def test_score_cannot_be_removed_by_replacing_judge(client):
    c=client;pid=prepare(c);ids=reserve(c)
    login(c,'judge1');command(c,'score',{'value':7},pid)
    login(c);command(c,'replace_judge',{'old':ids['judge1'],'new':ids['reserve'],'reason':'Testing'},status=422)
    command(c,'void_act',{'reason':'Rehearsal restart'},pid)
    assert c.get('/api/event').json()['participants'][0]['state']=='VOID'
    command(c,'replace_judge',{'old':ids['judge1'],'new':ids['reserve'],'reason':'Replacement after void'})

def test_timer_pause_resume(client):
    import time
    c=client;prepare(c);command(c,'timer',{'seconds':90})
    e=command(c,'phase',{'phase':'PAUSED'})
    assert e['timer_end'] is None and 85<e['timer_remaining']<=90
    e=command(c,'phase',{'phase':'LIVE'})
    assert 85<e['timer_end']-time.time()<=90

def test_restore_absent_with_reason(client):
    c=client;login(c);pid=command(c,'participant_add',{'name':'Late act','category':'Music'})['participants'][0]['id']
    command(c,'transition',{'state':'ABSENT'},pid)
    command(c,'restore_act',{'reason':''},pid,status=422)
    e=command(c,'restore_act',{'reason':'Arrived backstage'},pid)
    assert e['participants'][0]['state']=='CHECKED_IN'
    assert 'Arrived backstage' in str(c.get('/api/audit').json())

def test_pdf_is_authenticated(client):
    assert client.get('/api/report.pdf').status_code==401
    login(client);r=client.get('/api/report.pdf')
    assert r.status_code==200 and r.content.startswith(b'%PDF-')
