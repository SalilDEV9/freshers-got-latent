"""Additional event operations; all run inside the command's locked transaction."""
import csv
import io
import time
from uuid import uuid4
from .domain import ADMIN, ACTIVE
from .db import User, AccountControl


def clean(value, name, limit, required=False):
    if not isinstance(value, str) or len(value.strip()) > limit or (required and not value.strip()):
        raise ValueError(f'{name}: enter {"1-" if required else "0-"}{limit} characters.')
    return value.strip()


def roster_fields(data):
    members = data.get('members', [])
    if not isinstance(members, list) or len(members) > 12:
        raise ValueError('A team may list up to 12 members.')
    members = [clean(m, 'Member name', 80, True) for m in members]
    if len({m.casefold() for m in members}) != len(members):
        raise ValueError('Team member names must be distinct.')
    return {'name':clean(data.get('name'), 'Stage name',80,True),
            'category':clean(data.get('category'),'Category',50,True),
            'bio':clean(data.get('bio',''),'Introduction',500),'members':members}


def new_act(data, position, state='REGISTERED'):
    return {**roster_fields(data),'id':str(uuid4()),'state':state,'position':position,
            'self_score':None,'self_locked_at':None,'scores':{}}


def extra_command(s, user, e, p, action, data, require):
    if action not in {'participant_edit','roster_import','registration','approve','restore_act','void_act','replace_judge'}:
        return False
    if e['phase'] == 'ENDED':
        raise ValueError('The event has ended.')
    if action in {'participant_edit','roster_import','approve'}:
        require(user, ADMIN | {'backstage'})
    else:
        require(user, ADMIN)
    if action in {'participant_edit','approve','restore_act','void_act'} and not p:
        raise ValueError('Participant not found.')
    if action == 'participant_edit':
        if p['state'] in ACTIVE | {'COMPLETED','VOID'}:
            raise ValueError('Only waiting acts can be edited.')
        p.update(roster_fields(data))
    elif action == 'roster_import':
        raw = data.get('csv')
        if not isinstance(raw,str) or len(raw)>100000:
            raise ValueError('CSV must contain at most 100,000 characters.')
        reader=csv.DictReader(io.StringIO(raw.lstrip('\ufeff')), strict=True)
        if not reader.fieldnames or not {'name','category'} <= set(reader.fieldnames):
            raise ValueError('CSV headers must include name and category; bio and members are optional.')
        rows=[]
        names={a['name'].casefold() for a in e['participants']}
        try:
            for number, row in enumerate(reader,2):
                if None in row:
                    raise ValueError(f'Row {number}: too many columns.')
                members=row.get('members') or ''
                row['members']=[x.strip() for x in members.split(';') if x.strip()]
                act=new_act(row,len(e['participants'])+len(rows)+1)
                if act['name'].casefold() in names:
                    raise ValueError(f'Row {number}: duplicate stage name.')
                names.add(act['name'].casefold());rows.append(act)
                if len(e['participants'])+len(rows)>200:
                    raise ValueError('The roster limit is 200 acts.')
        except csv.Error as exc:
            raise ValueError('Malformed CSV. Check quotes and columns.') from exc
        if not rows:
            raise ValueError('CSV contains no performers.')
        e['participants'].extend(rows)
    elif action == 'registration':
        if type(data.get('open')) is not bool:
            raise ValueError('Choose open or closed.')
        e['registration_open']=data['open']
    elif action == 'approve':
        if p['state'] != 'PENDING':
            raise ValueError('Only pending registrations can be approved.')
        p['state']='REGISTERED'
    elif action == 'restore_act':
        if p['state'] not in {'ABSENT','SKIPPED'}:
            raise ValueError('Only an absent or skipped act can return to the queue.')
        clean(data.get('reason'),'Reason',300,True)
        p['state']='READY' if p.get('self_score') is not None else 'CHECKED_IN'
    elif action == 'void_act':
        clean(data.get('reason'),'Reason',300,True)
        if p['state'] in {'VOID','COMPLETED','REVEAL'}:
            raise ValueError('A revealed or completed result cannot be silently withdrawn.')
        p['void_reason']=data['reason'].strip()
        if p['state'] in ACTIVE:
            e['timer_end']=None;e['timer_remaining']=None
        p['state']='VOID'
    elif action == 'replace_judge':
        clean(data.get('reason'),'Reason',300,True)
        old,new=data.get('old'),data.get('new')
        if type(old) is not int or type(new) is not int or old not in e['judges'] or new in e['judges']:
            raise ValueError('Choose an assigned judge and a different reserve judge.')
        replacement=s.get(User,new);control=s.get(AccountControl,new)
        if not replacement or replacement.role!='judge' or (control and control.disabled):
            raise ValueError('The replacement must be an enabled judge.')
        active=next((a for a in e['participants'] if a['state'] in ACTIVE),None)
        if active and str(old) in active['scores']:
            raise ValueError('This judge already submitted on the active act. Complete or void the act before replacing them.')
        e['judges']=[new if j==old else j for j in e['judges']]
        e.setdefault('judge_names',{})[str(new)]=replacement.name
        if active:
            active['panel']=[new if j==old else j for j in active.get('panel',e['judges'])]
    return True
