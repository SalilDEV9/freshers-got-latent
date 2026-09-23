import asyncio
import copy
import csv
import io
import json
import os
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from fastapi import FastAPI, Depends, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import select, delete, text
from .db import Base, engine, Session, User, Event, Audit, LoginSession, LoginAttempt, AccountControl, transaction, locked_event
from .domain import ADMIN, CREW, ROLES, STAGES, ACTIVE, initial_event, score_value, validate_rules, public_event
from .security import password_hash, password_ok, token_hash
from .operations import extra_command, new_act

SECURE = os.getenv('COOKIE_SECURE', 'false').lower() == 'true'
ALLOWED_ORIGINS = set(os.getenv('ALLOWED_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000').split(','))
DUMMY_HASH = password_hash(secrets.token_urlsafe(32))

@asynccontextmanager
async def lifespan(app):
    Base.metadata.create_all(engine)
    with transaction() as s:
        if not s.get(Event, 1):
            s.add(Event(id=1, data=initial_event()))
    yield

app = FastAPI(title='Freshers Got Latent API', version='1.0.0', lifespan=lifespan)

@app.middleware('http')
async def protect_origin(request: Request, call_next):
    if request.method in {'POST', 'PUT', 'PATCH', 'DELETE'}:
        origin = request.headers.get('origin')
        if origin and origin not in ALLOWED_ORIGINS:
            return Response('Origin rejected', status_code=403)
        if request.headers.get('sec-fetch-site') == 'cross-site':
            return Response('Cross-site request rejected', status_code=403)
        if request.url.path.startswith('/api/') and request.headers.get('x-fgl-request') != '1':
            return Response('Missing request protection header', status_code=403)
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'same-origin'
    response.headers['X-Frame-Options'] = 'DENY'
    if request.url.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store'
    return response


def current_user(request: Request):
    token = request.cookies.get('fgl_session')
    if not token:
        return None
    with Session() as s:
        session = s.get(LoginSession, token_hash(token))
        if not session or session.expires <= time.time():
            return None
        control = s.get(AccountControl, session.user_id)
        return None if control and control.disabled else s.get(User, session.user_id)


def require(user, roles=None):
    if not user:
        raise HTTPException(401, 'Sign in to continue.')
    if roles and user.role not in roles:
        raise HTTPException(403, 'Your role cannot perform this action.')


def audit(s, user, action, detail=''):
    s.add(Audit(actor=user.username, action=action, detail=detail, created=time.time()))

class LoginBody(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=256)

class UserBody(LoginBody):
    password: str = Field(min_length=12, max_length=256)
    name: str = Field(min_length=1, max_length=100)
    role: str

class Command(BaseModel):
    revision: int = Field(ge=0)
    action: str
    participant_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)

class VoteBody(BaseModel):
    participant_id: str

@app.get('/api/health')
def health():
    with Session() as s:
        s.execute(text('SELECT 1'))
    return {'status': 'ok'}

@app.post('/api/login')
def login(body: LoginBody, request: Request, response: Response):
    username = body.username.strip().lower()
    # Both account and direct-peer throttles; do not trust forwarded IP headers.
    keys = [token_hash('user:' + username), token_hash('ip:' + (request.client.host if request.client else 'unknown'))]
    with transaction() as s:
        locked_event(s)  # serializes rate-limit counters across application workers
        now = time.time()
        for key in keys:
            attempt = s.get(LoginAttempt, key)
            if attempt and attempt.expires > now and attempt.count >= 15:
                raise HTTPException(429, 'Too many sign-in attempts. Try again in 15 minutes.')
        user = s.scalar(select(User).where(User.username == username))
        valid = password_ok(body.password, user.password if user else DUMMY_HASH)
        control = s.get(AccountControl, user.id) if user else None
        if not user or not valid or (control and control.disabled):
            for key in keys:
                attempt = s.get(LoginAttempt, key)
                if not attempt:
                    s.add(LoginAttempt(key=key, count=1, expires=now + 900))
                else:
                    attempt.count = attempt.count + 1 if attempt.expires > now else 1
                    attempt.expires = now + 900
        else:
            s.execute(delete(LoginAttempt).where(LoginAttempt.key == keys[0]))
            token = secrets.token_urlsafe(32)
            s.add(LoginSession(token_hash=token_hash(token), user_id=user.id, expires=now + 28800))
            s.execute(delete(LoginSession).where(LoginSession.expires < now))
            response.set_cookie('fgl_session', token, httponly=True, secure=SECURE, samesite='strict', max_age=28800)
            return {'id': user.id, 'name': user.name, 'role': user.role}
    raise HTTPException(401, 'Incorrect username or password.')

@app.post('/api/logout')
def logout(request: Request, response: Response):
    with transaction() as s:
        s.execute(delete(LoginSession).where(LoginSession.token_hash == token_hash(request.cookies.get('fgl_session', ''))))
    response.delete_cookie('fgl_session')
    return {'ok': True}

@app.get('/api/me')
def me(user=Depends(current_user)):
    return {'id': user.id, 'name': user.name, 'role': user.role} if user else None

@app.get('/api/event')
def event(user=Depends(current_user)):
    with Session() as s:
        return public_event(s.get(Event, 1).data, user)

@app.get('/api/users')
def users(user=Depends(current_user)):
    require(user, ADMIN)
    with Session() as s:
        return [{'id': u.id, 'name': u.name, 'username': u.username, 'role': u.role, 'disabled': bool((c := s.get(AccountControl, u.id)) and c.disabled)} for u in s.scalars(select(User).order_by(User.id))]

@app.post('/api/users', status_code=201)
def create_user(body: UserBody, user=Depends(current_user)):
    require(user, ADMIN)
    if body.role not in ROLES or (body.role in ADMIN and user.role != 'super_admin'):
        raise HTTPException(403, 'Only a super admin can create administrators.')
    username = body.username.strip().lower()
    if not username or not body.name.strip():
        raise HTTPException(422, 'Name and username cannot be blank.')
    with transaction() as s:
        locked_event(s)  # also serializes account creation on PostgreSQL
        if s.scalar(select(User).where(User.username == username)):
            raise HTTPException(409, 'Username already exists.')
        u = User(username=username, name=body.name.strip(), password=password_hash(body.password), role=body.role)
        s.add(u)
        audit(s, user, 'account_created', username + ':' + body.role)
    return {'ok': True}


def short_text(payload, key, maximum, default=''):
    value = payload.get(key, default)
    if not isinstance(value, str) or len(value.strip()) > maximum:
        raise ValueError(f'{key} must be text, at most {maximum} characters.')
    return value.strip()

@app.post('/api/command')
def command(cmd: Command, user=Depends(current_user)):
    require(user)
    with transaction() as s:
        row = locked_event(s)
        e = copy.deepcopy(row.data)
        if cmd.revision != e['revision']:
            raise HTTPException(409, 'The event changed. Refresh and try again.')
        p = next((p for p in e['participants'] if p['id'] == cmd.participant_id), None)
        a, payload = cmd.action, cmd.payload
        try:
            if extra_command(s, user, e, p, a, payload, require):
                pass
            elif a == 'participant_add':
                require(user, ADMIN | {'backstage'})
                if e['phase'] == 'ENDED' or len(e['participants']) >= 200:
                    raise ValueError('Registration is closed or full.')
                e['participants'].append(new_act(payload, len(e['participants']) + 1))
            elif a == 'settings':
                require(user, ADMIN)
                if e['phase'] != 'DRAFT':
                    raise ValueError('Settings lock when the event goes live.')
                rules = payload.get('rules', e['rules'])
                validate_rules(rules)
                judges = payload.get('judges', [])
                if not isinstance(judges, list) or not judges or len(judges) > 12 or any(type(j) is not int for j in judges) or len(set(judges)) != len(judges):
                    raise ValueError('Assign 1–12 different judges.')
                if any(not (u := s.get(User, j)) or u.role != 'judge' or ((c := s.get(AccountControl, j)) and c.disabled) for j in judges):
                    raise ValueError('Panel members must have judge accounts.')
                if any(p.get('self_score') is not None for p in e['participants']):
                    raise ValueError('Rules and panel cannot change after a self-score is locked.')
                e['rules'], e['judges'] = rules, judges
                e['judge_names'] = {str(j): s.get(User, j).name for j in judges}
                e['title'] = short_text(payload, 'title', 100, e['title']) or e['title']
            elif a == 'phase':
                require(user, ADMIN | {'controller'})
                phase = payload.get('phase')
                if (e['phase'], phase) not in {('DRAFT', 'LIVE'), ('LIVE', 'PAUSED'), ('PAUSED', 'LIVE'), ('LIVE', 'ENDED'), ('PAUSED', 'ENDED')}:
                    raise ValueError('Invalid event transition.')
                if phase == 'LIVE' and not e['judges']:
                    raise ValueError('Assign the judging panel first.')
                if phase == 'ENDED' and any(p['state'] in ACTIVE for p in e['participants']):
                    raise ValueError('Complete the active performance before ending the event.')
                if phase == 'ENDED':
                    e['voting_open'] = False
                if phase == 'PAUSED':
                    e['timer_remaining'] = max(0, e['timer_end'] - time.time()) if e.get('timer_end') else None
                    e['timer_end'] = None
                elif phase == 'LIVE' and e['phase'] == 'PAUSED':
                    remaining = e.get('timer_remaining')
                    e['timer_end'] = time.time() + remaining if remaining else None
                    e['timer_remaining'] = None
                elif phase == 'ENDED':
                    e['timer_end'] = None
                    e['timer_remaining'] = None
                    e['registration_open'] = False
                e['phase'] = phase
            elif a in {'announcement', 'timer', 'voting'}:
                require(user, ADMIN | {'controller'})
                if e['phase'] == 'ENDED':
                    raise ValueError('The event has ended.')
                if a == 'announcement':
                    e['announcement'] = short_text(payload, 'text', 300)
                elif a == 'timer':
                    seconds = payload.get('seconds', 0)
                    if type(seconds) is not int or not 0 <= seconds <= 3600 or e['phase'] != 'LIVE':
                        raise ValueError('Use 0–3600 seconds during a live event.')
                    e['timer_end'] = time.time() + seconds if seconds else None
                else:
                    if type(payload.get('open')) is not bool or e['phase'] != 'LIVE':
                        raise ValueError('Voting can only change during a live event.')
                    e['voting_open'] = payload['open']
            elif a in {'self_score', 'score', 'transition', 'reorder'}:
                if not p:
                    raise HTTPException(404, 'Participant not found.')
                if e['phase'] in {'PAUSED', 'ENDED'}:
                    raise ValueError('Event activity is paused or ended.')
                if a == 'self_score':
                    require(user, ADMIN | {'backstage'})
                    if p['state'] != 'BACKSTAGE' or p['self_score'] is not None or not e['judges']:
                        raise ValueError('Lock the self-score once, backstage, after panel setup.')
                    p['self_score'] = score_value(payload.get('value'), e['rules'])
                    p['self_locked_at'] = time.time()
                elif a == 'score':
                    require(user, {'judge'})
                    if e['phase'] != 'LIVE' or user.id not in p.get('panel', e['judges']) or p['state'] != 'JUDGING':
                        raise ValueError('Scoring is not open for you on this act.')
                    if str(user.id) in p['scores']:
                        raise ValueError('Your submitted score is locked.')
                    p['scores'][str(user.id)] = {'value': score_value(payload.get('value'), e['rules']), 'locked_at': time.time()}
                elif a == 'reorder':
                    require(user, ADMIN | {'controller', 'backstage'})
                    if p['state'] in ACTIVE | {'COMPLETED', 'ABSENT', 'SKIPPED', 'VOID', 'PENDING'}:
                        raise ValueError('Only waiting acts can move in the queue.')
                    waiting = sorted([x for x in e['participants'] if x['state'] not in ACTIVE | {'COMPLETED', 'ABSENT', 'SKIPPED', 'VOID', 'PENDING'}], key=lambda x: x['position'])
                    index = waiting.index(p)
                    delta = payload.get('delta')
                    if delta not in (-1, 1) or not 0 <= index + delta < len(waiting):
                        raise ValueError('Cannot move farther in this direction.')
                    other = waiting[index + delta]
                    p['position'], other['position'] = other['position'], p['position']
                else:
                    state = payload.get('state')
                    backstage_step = state in {'CHECKED_IN', 'BACKSTAGE', 'READY', 'ABSENT', 'SKIPPED'}
                    require(user, ADMIN | ({'backstage', 'controller'} if backstage_step else {'controller'}))
                    if state in {'ABSENT', 'SKIPPED'}:
                        if p['state'] in ACTIVE | {'COMPLETED', 'ABSENT', 'SKIPPED', 'VOID', 'PENDING'}:
                            raise ValueError('Only a waiting act can be skipped or marked absent.')
                    elif p['state'] not in STAGES or STAGES.index(p['state']) == len(STAGES) - 1 or state != STAGES[STAGES.index(p['state']) + 1]:
                        raise ValueError('Follow the stage sequence in order.')
                    if state == 'READY' and p['self_score'] is None:
                        raise ValueError('Lock the self-score before marking ready.')
                    if state in ACTIVE | {'COMPLETED'} and e['phase'] != 'LIVE':
                        raise ValueError('The event must be live.')
                    if state == 'ON_STAGE' and any(x['id'] != p['id'] and x['state'] in ACTIVE for x in e['participants']):
                        raise ValueError('Another performance is still active.')
                    if state == 'REVEAL' and set(p['scores']) != {str(j) for j in p.get('panel', e['judges'])}:
                        raise ValueError('Every assigned judge must lock a score before reveal.')
                    if state == 'ON_STAGE':
                        p['panel'] = list(e['judges'])
                    p['state'] = state
                    if state in {'JUDGING', 'COMPLETED'}:
                        e['timer_end'] = None
            else:
                raise ValueError('Unknown action.')
        except (ValueError, ArithmeticError, TypeError) as exc:
            raise HTTPException(422, str(exc) or 'Invalid value.') from exc
        e['revision'] += 1
        row.data = e
        # Never put unrevealed scores in audit detail.
        audit(s, user, a, json.dumps({'participant': cmd.participant_id, 'revision': e['revision'], **({'reason': payload['reason']} if a in {'replace_judge','restore_act','void_act'} else {})}))
        return public_event(e, user)

@app.post('/api/vote')
def vote(body: VoteBody, user=Depends(current_user)):
    require(user, {'audience'})
    with transaction() as s:
        row = locked_event(s)
        e = copy.deepcopy(row.data)
        if not e['voting_open'] or e['phase'] != 'LIVE':
            raise HTTPException(409, 'Audience voting is closed.')
        if str(user.id) in e['votes']:
            raise HTTPException(409, 'Your Audience Choice vote is already locked.')
        if not any(p['id'] == body.participant_id and p['state'] == 'COMPLETED' for p in e['participants']):
            raise HTTPException(422, 'Vote for a completed performance.')
        e['votes'][str(user.id)] = body.participant_id
        e['revision'] += 1
        row.data = e
        audit(s, user, 'audience_vote')
    return {'ok': True}

@app.get('/api/audit')
def audit_log(user=Depends(current_user)):
    require(user, ADMIN)
    with Session() as s:
        return [{'id': a.id, 'actor': a.actor, 'action': a.action, 'detail': a.detail, 'created': a.created} for a in s.scalars(select(Audit).order_by(Audit.id.desc()).limit(300))]

@app.get('/api/export.csv')
def export(user=Depends(current_user)):
    require(user, ADMIN | {'controller'})
    data = event(user)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(['Name', 'Category', 'State', 'Judge average', 'Self score', 'Difference', 'Match'])
    def safe(v):
        return "'" + v if isinstance(v, str) and v.startswith(('=', '+', '-', '@', '\t', '\r')) else v
    for p in data['participants']:
        r = p.get('result', {})
        writer.writerow([safe(p['name']), safe(p['category']), p['state'], *[r.get(k, '') for k in ('average', 'self_score', 'difference', 'match')]])
    return StreamingResponse(iter([out.getvalue()]), media_type='text/csv', headers={'Content-Disposition': 'attachment; filename=fgl-results.csv'})

@app.websocket('/api/ws')
async def updates(ws: WebSocket):
    origin = ws.headers.get('origin')
    if origin and origin not in ALLOWED_ORIGINS:
        await ws.close(code=1008)
        return
    await ws.accept()
    try:
        # Revision notifications carry no participant, identity, or scoring data.
        # The client refetches a role-filtered snapshot; reconnects cannot miss state.
        while True:
            with Session() as s:
                revision = s.get(Event, 1).data['revision']
            await ws.send_json({'revision': revision})
            await asyncio.sleep(2)
    except (WebSocketDisconnect, RuntimeError):
        pass

from .extensions import register_routes
register_routes(app, current_user, require, audit)

DIST = Path(__file__).resolve().parents[2] / 'frontend' / 'dist'
if DIST.exists():
    app.mount('/', StaticFiles(directory=DIST, html=True), name='frontend')
