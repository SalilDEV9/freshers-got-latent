"""Account administration, performer registration, and result reports."""
import copy
import io
import time
from typing import Literal
from xml.sax.saxutils import escape
from fastapi import Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete
from .db import Session, transaction, locked_event, User, Event, LoginSession, AccountControl
from .domain import ADMIN, ROLES, public_event
from .operations import new_act
from .security import password_hash, password_ok

class PasswordChange(BaseModel):
    old_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=12, max_length=256)

class AccountChange(BaseModel):
    action: Literal['disable','enable','revoke_sessions','reset_password','role']
    password: str | None = Field(default=None, min_length=12, max_length=256)
    role: str | None = None

class Registration(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    category: str = Field(min_length=1, max_length=50)
    bio: str = Field(default='', max_length=500)
    members: list[str] = Field(default_factory=list, max_length=12)
    consent: Literal[True]


def make_report(data):
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.pagesizes import A4, landscape
    buffer=io.BytesIO();styles=getSampleStyleSheet()
    normal=ParagraphStyle('Cell',parent=styles['Normal'],fontName='Helvetica',fontSize=9,leading=12)
    small=ParagraphStyle('Small',parent=normal,fontSize=8,leading=10)
    doc=SimpleDocTemplate(buffer,pagesize=landscape(A4),leftMargin=36,rightMargin=36,topMargin=36,bottomMargin=36,title=data['title']+' - Results',author='MindQuest')
    def cell(value):
        return Paragraph(escape(str(value)),normal)
    story=[Paragraph(escape(data['title']),styles['Title']),Paragraph('MindQuest | IIIT Kottayam',styles['Normal']),Spacer(1,12),Paragraph(f"Event: {escape(data['phase'])} | Match mode: {escape(data['rules']['mode'])} | Revision: {data['revision']}",small),Paragraph('Only revealed results are included. Judge rankings, latent matches and Audience Choice are separate outcomes.',small),Spacer(1,16)]
    ranked=sorted([p for p in data['participants'] if p.get('result')],key=lambda p:(-p['result']['average'],p['position']))
    rows=[[cell(x) for x in ['Rank','Performer / team','Talent','Average','Self-score','Difference','Match']]]
    for p in ranked:
        r=p['result'];rank=next(i+1 for i,x in enumerate(ranked) if x['result']['average']==r['average'])
        rows.append([cell(x) for x in [rank,p['name'],p['category'],f"{r['average']:.2f}",r['self_score'],f"{r['difference']:.2f}",'Yes' if r['match'] else 'No']])
    table=Table(rows,colWidths=[40,240,100,70,70,80,60],repeatRows=1,hAlign='LEFT')
    table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#d4f56b')),('VALIGN',(0,0),(-1,-1),'TOP'),('BOTTOMPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),9),('LINEBELOW',(0,0),(-1,-1),.4,colors.HexColor('#a6b3a9'))]))
    story.append(table)
    if not ranked: story.append(Paragraph('No performances have been revealed yet.',normal))
    if 'audience_results' in data:
        story.extend([Spacer(1,20),Paragraph('Audience Choice - final votes',styles['Heading2'])])
        for p in sorted([p for p in data['participants'] if p['state']=='COMPLETED'],key=lambda p:-data['audience_results'].get(p['id'],0)):
            story.append(cell(f"{p['name']}: {data['audience_results'].get(p['id'],0)} votes"))
    def footer(canvas,doc):
        canvas.setFont('Helvetica',8);canvas.drawString(36,20,'Freshers Got Latent - event report');canvas.drawRightString(805,20,f'Page {doc.page}')
    doc.build(story,onFirstPage=footer,onLaterPages=footer)
    return buffer.getvalue()


def register_routes(app, current_user, require, audit):
    @app.post('/api/password')
    def change_password(body:PasswordChange,response:Response,user=Depends(current_user)):
        require(user)
        with transaction() as s:
            locked_event(s);target=s.get(User,user.id)
            if not password_ok(body.old_password,target.password):
                raise HTTPException(403,'The current password is incorrect.')
            target.password=password_hash(body.new_password)
            s.execute(delete(LoginSession).where(LoginSession.user_id==user.id))
            audit(s,user,'password_changed')
        response.delete_cookie('fgl_session')
        return {'ok':True}

    @app.post('/api/users/{user_id}/manage')
    def manage_account(user_id:int,body:AccountChange,user=Depends(current_user)):
        require(user,ADMIN)
        with transaction() as s:
            event=locked_event(s);target=s.get(User,user_id)
            if not target: raise HTTPException(404,'Account not found.')
            if target.role in ADMIN and user.role!='super_admin':
                raise HTTPException(403,'Only a super admin can manage administrators.')
            if target.id==user.id and body.action in {'disable','role','reset_password'}:
                raise HTTPException(422,'Use your own password form; do not disable or change your own role.')
            if body.action in {'disable','role'} and target.id in event.data['judges']:
                raise HTTPException(409,'Replace this judge on the panel before disabling or changing their role.')
            control=s.get(AccountControl,user_id)
            if body.action in {'disable','enable'}:
                if not control: control=AccountControl(user_id=user_id,disabled=False);s.add(control)
                control.disabled=body.action=='disable'
            elif body.action=='reset_password':
                if not body.password: raise HTTPException(422,'Enter a new password of at least 12 characters.')
                target.password=password_hash(body.password)
            elif body.action=='role':
                if body.role not in ROLES or (body.role in ADMIN and user.role!='super_admin'):
                    raise HTTPException(403,'This role change is not allowed.')
                target.role=body.role
            if body.action!='enable':
                s.execute(delete(LoginSession).where(LoginSession.user_id==user_id))
            audit(s,user,'account_'+body.action,str(user_id))
        return {'ok':True}

    @app.post('/api/register',status_code=201)
    def register(body:Registration,user=Depends(current_user)):
        require(user,{'audience'})
        with transaction() as s:
            row=locked_event(s);e=copy.deepcopy(row.data)
            if not e.get('registration_open') or e['phase'] not in {'DRAFT','LIVE'}:
                raise HTTPException(409,'Performer registration is closed.')
            if len(e['participants'])>=200: raise HTTPException(409,'The event roster is full.')
            if any(p.get('registered_by')==user.id for p in e['participants']):
                raise HTTPException(409,'You have already submitted a registration. Contact the organisers for changes.')
            try: act=new_act(body.model_dump(),len(e['participants'])+1,'PENDING')
            except ValueError as exc: raise HTTPException(422,str(exc)) from exc
            act.update(registered_by=user.id,consent_at=time.time())
            e['participants'].append(act);e['revision']+=1;row.data=e
            audit(s,user,'registration_submitted',act['id'])
        return {'ok':True,'id':act['id']}

    @app.get('/api/report.pdf')
    def report(user=Depends(current_user)):
        require(user,ADMIN|{'controller'})
        with Session() as s: data=public_event(s.get(Event,1).data,user)
        return Response(make_report(data),media_type='application/pdf',headers={'Content-Disposition':'attachment; filename=fgl-results.pdf'})
