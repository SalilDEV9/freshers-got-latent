// Deliberately separate from unit tests. Requires a disposable PostgreSQL database.
import postgres from 'postgres';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const url=process.env.FGL_TEST_DATABASE_URL;
if(!url||new URL(url).pathname!=='/fgl_entry_test'||process.env.FGL_ALLOW_TEST_DATABASE!=='1')throw new Error('Use a disposable /fgl_entry_test database and FGL_ALLOW_TEST_DATABASE=1');
const sql=postgres(url,{max:50,prepare:false});
try{
 await sql.unsafe(await readFile(new URL('../../supabase/schema.sql',import.meta.url),'utf8'));
 const e=randomUUID(),a=randomUUID(),r=randomUUID(),t=randomUUID();const gates=Array.from({length:50},()=>randomUUID());
 await sql`insert into fgl.events(id,title,expires_at) values(${e},'Disposable race test',now()+interval '1 day')`;
 await sql`insert into fgl.event_staff values(${e},${a},'gate',true)`;
 for(const [i,g] of gates.entries())await sql`insert into fgl.gate_devices(id,event_id,label,staff_id) values(${g},${e},${'Gate '+i},${a})`;
 await sql`insert into fgl.audience_registrations(id,event_id,name,email,roll_number,status) values(${r},${e},'Synthetic Attendee','synthetic@example.com','TEST001','PASS_ISSUED')`;
 await sql`insert into fgl.payments(event_id,attendee_id,status) values(${e},${r},'VERIFIED')`;
 await sql`insert into fgl.tickets(id,event_id,attendee_id,nonce,key_id,issued_at) values(${t},${e},${r},'test','test',1)`;
 const outcomes=await Promise.all(gates.map(g=>sql`select fgl.redeem(${e},${t},${a},${g},true) result`));
 assert.equal(outcomes.filter(x=>x[0].result.allowed).length,1);
 assert.equal(outcomes.filter(x=>x[0].result.reason==='ALREADY_USED').length,49);
 const [attempts]=await sql`select count(*)::int total from fgl.entry_attempts where event_id=${e}`;assert.equal(attempts.total,50);
 console.log('50 concurrent PostgreSQL connections: 1 granted, 49 rejected; all 50 attempts audited.');
}finally{await sql.end();}
