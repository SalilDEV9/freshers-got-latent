import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const E = "00000000-0000-4000-8000-000000000001",
  A = "00000000-0000-4000-8000-000000000002",
  G = "00000000-0000-4000-8000-000000000003",
  R = "00000000-0000-4000-8000-000000000004",
  T = "00000000-0000-4000-8000-000000000005";
async function setup() {
  const db = new PGlite();
  await db.exec(
    await readFile(
      new URL("../../supabase/schema.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(
    `insert into fgl.events(id,title,expires_at) values('${E}','Test',now()+interval '1 day');insert into fgl.event_staff values('${E}','${A}','gate',true);insert into fgl.gate_devices(id,event_id,label,staff_id) values('${G}','${E}','Gate 1','${A}');insert into fgl.audience_registrations(id,event_id,name,email,roll_number,status) values('${R}','${E}','Rahul','rahul@example.com','2026BCS01','PASS_ISSUED');insert into fgl.payments(event_id,attendee_id,status) values('${E}','${R}','VERIFIED');insert into fgl.tickets(id,event_id,attendee_id,nonce,key_id,issued_at) values('${T}','${E}','${R}','nonce','k',1);`,
  );
  return db;
}
const redeem = (db, confirmed = true) =>
  db.query("select fgl.redeem($1,$2,$3,$4,$5) result", [E, T, A, G, confirmed]);
test("schema compiles, redemption admits one of 50 queued requests and audits all", async () => {
  const db = await setup();
  try {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => redeem(db)),
    );
    assert.equal(results.filter((r) => r.rows[0].result.allowed).length, 1);
    assert.equal(
      (await db.query("select count(*)::int n from fgl.entry_attempts")).rows[0]
        .n,
      50,
    );
    assert.equal(
      (await db.query("select status from fgl.audience_registrations")).rows[0]
        .status,
      "CHECKED_IN",
    );
    await assert.rejects(
      db.exec("update fgl.audit_ledger set action='tampered'"),
      /append-only/,
    );
    await assert.rejects(db.exec("truncate fgl.audit_ledger"), /append-only/);
  } finally {
    await db.close();
  }
});
test("payment, identity, role, gate, expiry and block checks fail closed", async () => {
  const db = await setup();
  try {
    await assert.rejects(redeem(db, false), /identity/);
    await db.exec("update fgl.payments set status='PENDING'");
    assert.equal(
      (await redeem(db)).rows[0].result.reason,
      "PAYMENT_NOT_VERIFIED",
    );
    await db.exec(
      "update fgl.payments set status='VERIFIED';update fgl.tickets set status='BLOCKED'",
    );
    assert.equal((await redeem(db)).rows[0].result.reason, "BLOCKED");
    await db.exec(
      "update fgl.tickets set status='ACTIVE';update fgl.events set expires_at=now()-interval '1 day'",
    );
    assert.equal((await redeem(db)).rows[0].result.reason, "EXPIRED");
    await db.exec("update fgl.gate_devices set active=false");
    await assert.rejects(redeem(db), /not authorized/);
    await db.exec("update fgl.event_staff set active=false");
    await assert.rejects(redeem(db), /Forbidden/);
  } finally {
    await db.close();
  }
});
test("event identity and payment uniqueness enforced; RLS enabled on every table", async () => {
  const db = await setup();
  try {
    await assert.rejects(
      db.exec(
        `insert into fgl.audience_registrations(event_id,name,email,roll_number) values('${E}','Other','rahul@example.com','OTHER')`,
      ),
      /unique/,
    );
    await assert.rejects(
      db.exec(
        `insert into fgl.tickets(event_id,attendee_id,nonce,key_id,issued_at) values('${E}','${R}','different','k',2)`,
      ),
      /unique/,
    );
    const result = await db.query(
      "select relname from pg_class join pg_namespace on pg_namespace.oid=relnamespace where nspname='fgl' and relkind='r' and not relrowsecurity",
    );
    assert.equal(result.rows.length, 0);
  } finally {
    await db.close();
  }
});
test("admin override needs reason and still refuses a redeemed ticket", async () => {
  const db = await setup();
  try {
    await assert.rejects(
      db.query("select fgl.redeem($1,$2,$3,$4,true,$5)", [
        E,
        T,
        A,
        G,
        "Verified physical ID",
      ]),
      /Administrator/,
    );
    await db.exec("update fgl.event_staff set role='event_admin'");
    const x = await db.query("select fgl.redeem($1,$2,$3,$4,true,$5) result", [
      E,
      T,
      A,
      G,
      "Verified physical ID",
    ]);
    assert.equal(x.rows[0].result.allowed, true);
    assert.equal((await redeem(db)).rows[0].result.reason, "ALREADY_USED");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from fgl.audit_ledger where action='ADMIN_OVERRIDE'",
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});
test("ledger hashes verify and unprivileged role cannot access entry data", async () => {
  const db = await setup();
  try {
    await redeem(db);
    await db.exec("set timezone='UTC'");
    const check = await db.query(
      `with records as (select *,coalesce(lag(record_hash) over(partition by event_id order by audit_id),repeat('0',64)) expected_previous,encode(sha256(convert_to(jsonb_build_array(event_id,entity_id,action,actor_id,device_id,timestamp,details,previous_hash)::text,'UTF8')),'hex') expected_hash from fgl.audit_ledger) select audit_id from records where previous_hash<>expected_previous or record_hash<>expected_hash`,
    );
    assert.equal(check.rows.length, 0);
    await db.exec("create role anonymous_visitor;set role anonymous_visitor");
    await assert.rejects(
      db.query("select * from fgl.audience_registrations"),
      /permission denied/,
    );
    await assert.rejects(redeem(db), /permission denied/);
  } finally {
    await db.close();
  }
});
test("result calculation stays sealed until reveal and detects rational exact matches", async () => {
  const db = await setup();
  try {
    const P = "00000000-0000-4000-8000-000000000006";
    await db.exec(
      `insert into fgl.performances(id,event_id,name,category,position,state,self_score) values('${P}','${E}','Act','Music',1,'JUDGING',8);insert into fgl.judge_scores(event_id,performance_id,judge_id,value,criteria) values('${E}','${P}','${A}',8,'{"creativity":7,"entertainment":8,"originality":9}');`,
    );
    assert.equal((await db.query("select * from fgl.results")).rows.length, 0);
    await db.exec("update fgl.performances set state='REVEAL'");
    const row = (await db.query("select * from fgl.results")).rows[0];
    assert.equal(Number(row.average), 8);
    assert.equal(row.match, true);
  } finally {
    await db.close();
  }
});
