import "server-only";
import { randomUUID } from "node:crypto";
import { db, eventId } from "./db";
import { makeNonce, signTicket, verifyTicket } from "./tickets.mjs";
import { preview, safeCSV } from "./imports.mjs";
type Actor = { id: string; email: string };
// Transaction SQL is intentionally isolated here; caller data is always parameterized.
type SQL = any;
const admins = ["super_admin", "event_admin"];
const text = (x: unknown, max = 500) => {
  if (typeof x !== "string" || !x.trim() || x.length > max)
    throw new Error("Invalid text field");
  return x.trim();
};
export async function staff(sql: SQL, e: string, a: Actor, roles: string[]) {
  const [s] =
    await sql`select role from fgl.event_staff where event_id=${e} and user_id=${a.id} and active`;
  if (!s || !roles.includes(s.role)) throw new Error("Forbidden");
  return s.role;
}
async function audit(
  sql: SQL,
  e: string,
  a: Actor,
  entity: string,
  action: string,
  details: unknown = {},
  device: string | null = null,
) {
  await sql`select fgl.append_audit(${e},${entity},${action},${a.id},${device},${sql.json(details)})`;
}
function keys() {
  return JSON.parse(process.env.FGL_VERIFY_KEYS_JSON || "{}");
}
function signed(t: any) {
  return signTicket(
    t,
    JSON.parse(process.env.FGL_SIGNING_PRIVATE_KEY_JSON || "null"),
  );
}
async function own(sql: SQL, e: string, a: Actor) {
  const [r] =
    await sql`select * from fgl.audience_registrations where event_id=${e} and auth_id=${a.id}`;
  if (!r)
    throw new Error(
      "REGISTRATION NOT FOUND. Sign in using the email used during event registration.",
    );
  return r;
}
export async function handle(action: string, data: any, a: Actor) {
  const sql = db(),
    e = eventId();
  if (action === "dashboard") {
    // Reads never return another attendee's record or use a cached ticket state.
    const [role] =
      await sql`select role from fgl.event_staff where event_id=${e} and user_id=${a.id} and active`;
    const [r] =
      await sql`select id,name,email,roll_number,status from fgl.audience_registrations where event_id=${e} and auth_id=${a.id}`;
    if (!r)
      return {
        registration: null,
        role: role?.role,
        message:
          "REGISTRATION NOT FOUND. Use the email used for event registration.",
      };
    const [payment] =
      await sql`select status from fgl.payments where event_id=${e} and attendee_id=${r.id}`;
    const [ticket] =
      await sql`select t.*,g.label gate from fgl.tickets t left join fgl.gate_devices g on g.id=t.gate_id where t.event_id=${e} and t.attendee_id=${r.id}`;
    const [event] =
      await sql`select expires_at,phase from fgl.events where id=${e}`;
    const active =
      ticket?.status === "ACTIVE" &&
      r.status === "PASS_ISSUED" &&
      payment?.status === "VERIFIED" &&
      new Date(event.expires_at) > new Date() &&
      event.phase !== "ENDED";
    return {
      registration: r,
      payment,
      ticket: ticket
        ? {
            id: ticket.id,
            status: active
              ? "ACTIVE"
              : ticket.status === "ACTIVE"
                ? "EXPIRED"
                : ticket.status,
            redeemed_at: ticket.redeemed_at,
            gate: ticket.gate,
            qr: active ? ticket.qr : null,
          }
        : null,
      role: role?.role,
    };
  }
  if (action === "overview") {
    await staff(sql, e, a, admins);
    const registrations =
      await sql`select r.*,p.reference,p.proof,p.status payment_status,t.id ticket_id,t.status ticket_status from fgl.audience_registrations r join fgl.payments p on p.attendee_id=r.id left join fgl.tickets t on t.attendee_id=r.id where r.event_id=${e} order by r.created_at desc limit 2000`;
    const attempts =
      await sql`select * from fgl.entry_attempts where event_id=${e} order by created_at desc limit 100`;
    const gates = await sql`select * from fgl.gate_devices where event_id=${e}`;
    const batches =
      await sql`select id,source,mapping,status,created_at from fgl.import_batches where event_id=${e} order by created_at desc limit 30`;
    return { event_id: e, registrations, attempts, gates, batches };
  }
  if (action === "gates") {
    await staff(sql, e, a, [...admins, "gate"]);
    return await sql`select id,label from fgl.gate_devices where event_id=${e} and active and staff_id=${a.id}`;
  }
  if (action === "export") {
    await staff(sql, e, a, admins);
    let rows: any[];
    if (data.kind === "audit")
      rows =
        await sql`select * from fgl.audit_ledger where event_id=${e} order by audit_id`;
    else if (data.kind === "checkins")
      rows =
        await sql`select r.name,r.roll_number,t.redeemed_at,g.label gate from fgl.tickets t join fgl.audience_registrations r on r.id=t.attendee_id left join fgl.gate_devices g on g.id=t.gate_id where t.event_id=${e} and t.status='REDEEMED'`;
    else
      rows =
        await sql`select name,email,phone,roll_number,status from fgl.audience_registrations where event_id=${e}`;
    return {
      csv: rows.length
        ? safeCSV([
            Object.keys(rows[0]),
            ...rows.map((r) =>
              Object.values(r).map((v) =>
                typeof v === "object" ? JSON.stringify(v) : v,
              ),
            ),
          ])
        : "",
    };
  }
  return await sql.begin(async (tx: SQL) => {
    const [event] = await tx`select * from fgl.events where id=${e} for update`;
    if (!event) throw new Error("Event not configured");
    // Shared database rate limit: independent of serverless instance count.
    const [limit] =
      await tx`insert into fgl.request_limits(event_id,actor_id,window_start,count) values(${e},${a.id},date_trunc('minute',now()),1) on conflict(event_id,actor_id,window_start) do update set count=fgl.request_limits.count+1 returning count`;
    if (limit.count > 180)
      return { error: "Too many operations. Wait one minute." };
    if (action === "link") {
      const [r] =
        await tx`select r.* from fgl.audience_registrations r join fgl.payments p on p.attendee_id=r.id where r.event_id=${e} and r.email=${a.email} and r.status in ('APPROVED','PASS_ISSUED','CHECKED_IN') and p.status='VERIFIED' for update of r`;
      if (!r)
        throw new Error(
          "REGISTRATION NOT FOUND. An approved, payment-verified registration is required.",
        );
      if (r.auth_id && r.auth_id !== a.id)
        throw new Error("Registration already linked to a different identity");
      if (!r.auth_id) {
        await tx`update fgl.audience_registrations set auth_id=${a.id} where id=${r.id}`;
        await audit(tx, e, a, r.id, "ACCOUNT_LINKED");
      }
      if (r.status === "APPROVED") {
        if (new Date(event.expires_at) <= new Date() || event.phase === "ENDED")
          throw new Error("Event has ended");
        const t = {
          id: randomUUID(),
          event_id: e,
          attendee_id: r.id,
          nonce: makeNonce(),
          key_id: process.env.FGL_SIGNING_KEY_ID,
          issued_at: Math.floor(Date.now() / 1000),
        };
        // Validate keys before writing; no half-issued ticket on configuration failure.
        const qr = signed(t);
        verifyTicket(qr, keys(), e);
        await tx`insert into fgl.tickets ${tx({ ...t, qr })}`;
        await tx`update fgl.audience_registrations set status='PASS_ISSUED' where id=${r.id}`;
        await audit(tx, e, a, t.id, "PASS_CREATED");
      }
      return { ok: true };
    }
    if (action === "vote") {
      const r = await own(tx, e, a);
      if (
        r.status !== "CHECKED_IN" ||
        !event.voting_open ||
        event.phase !== "LIVE"
      )
        throw new Error("Voting is unavailable");
      if (
        !(
          await tx`select id from fgl.tickets where attendee_id=${r.id} and event_id=${e} and status='REDEEMED'`
        ).length
      )
        throw new Error("Check in before voting");
      const [p] =
        await tx`select id from fgl.performances where event_id=${e} and id=${data.performance_id} and state in ('PERFORMING','JUDGING')`;
      if (!p) throw new Error("This performance is not accepting votes");
      for (const k of ["creativity", "entertainment", "originality"])
        if (!Number.isInteger(data[k]) || data[k] < 1 || data[k] > 5)
          throw new Error("Ratings must be 1–5");
      await tx`insert into fgl.audience_votes(event_id,performance_id,audience_id,creativity,entertainment,originality) values(${e},${p.id},${r.id},${data.creativity},${data.entertainment},${data.originality})`;
      await audit(tx, e, a, p.id, "VOTE_SUBMITTED");
      return { ok: true };
    }
    if (["scan", "redeem", "override"].includes(action)) {
      const role = await staff(
        tx,
        e,
        a,
        action === "override" ? admins : [...admins, "gate"],
      );
      const [gate] =
        await tx`select * from fgl.gate_devices where id=${data.device_id} and event_id=${e} and active and (staff_id=${a.id} or ${admins.includes(role)})`;
      if (!gate) throw new Error("Gate device not authorized");
      let ticket: any;
      if (action === "override") {
        text(data.reason, 500);
        [ticket] =
          await tx`select * from fgl.tickets where id=${data.ticket_id} and event_id=${e}`;
      } else {
        try {
          const p = verifyTicket(data.qr, keys(), e);
          [ticket] =
            await tx`select * from fgl.tickets where id=${p.ticket_id} and event_id=${e} and nonce=${p.nonce} and key_id=${p.key_id} and issued_at=${p.issued_at}`;
        } catch {
          /* log invalid tokens without storing raw QR */
        }
      }
      if (!ticket) {
        await tx`insert into fgl.entry_attempts(event_id,actor_id,device_id,action,reason) values(${e},${a.id},${gate.id},'ENTRY_REJECTED','INVALID_QR')`;
        await audit(
          tx,
          e,
          a,
          "unknown",
          "ENTRY_REJECTED",
          { reason: "INVALID_QR" },
          gate.id,
        );
        return { allowed: false, reason: "INVALID_QR" };
      }
      if (action !== "scan")
        return (
          await tx`select fgl.redeem(${e},${ticket.id},${a.id},${gate.id},${data.identity_confirmed === true},${action === "override" ? text(data.reason, 500) : null}) result`
        )[0].result;
      const [r] =
        await tx`select r.name,r.roll_number,r.status,p.status payment_status from fgl.audience_registrations r join fgl.payments p on p.attendee_id=r.id where r.id=${ticket.attendee_id}`;
      const valid =
        ticket.status === "ACTIVE" &&
        r.status === "PASS_ISSUED" &&
        r.payment_status === "VERIFIED" &&
        new Date(event.expires_at) > new Date() &&
        event.phase !== "ENDED";
      const reason = valid
        ? "VALID_PASS"
        : ticket.status === "REDEEMED"
          ? "ALREADY_USED"
          : ticket.status !== "ACTIVE"
            ? ticket.status
            : "NOT_ELIGIBLE";
      await tx`insert into fgl.entry_attempts(event_id,ticket_id,actor_id,device_id,action,reason) values(${e},${ticket.id},${a.id},${gate.id},${valid ? "QR_SCANNED" : "ENTRY_REJECTED"},${reason})`;
      await audit(
        tx,
        e,
        a,
        ticket.id,
        valid ? "QR_SCANNED" : "ENTRY_REJECTED",
        { reason },
        gate.id,
      );
      return {
        valid,
        reason,
        name: r.name,
        roll_number: r.roll_number,
        first_entry: ticket.redeemed_at,
        gate_id: ticket.gate_id,
      };
    }
    await staff(tx, e, a, admins);
    if (action === "preview") {
      const existing =
        await tx`select r.name,r.email,r.roll_number,p.reference payment_reference from fgl.audience_registrations r join fgl.payments p on p.attendee_id=r.id where r.event_id=${e}`;
      const rows = preview(data.rows, data.mapping, existing);
      const [batch] =
        await tx`insert into fgl.import_batches(event_id,actor_id,source,mapping,preview) values(${e},${a.id},${text(data.source, 100)},${tx.json(data.mapping)},${tx.json(rows)}) returning id`;
      await audit(tx, e, a, batch.id, "IMPORT_PREVIEW_CREATED", {
        rows: rows.length,
      });
      return { id: batch.id, rows };
    }
    if (action === "import") {
      const [b] =
        await tx`select * from fgl.import_batches where id=${data.batch_id} and event_id=${e} and status='PREVIEW' for update`;
      if (!b) throw new Error("Preview already imported or missing");
      if (!Array.isArray(data.rows) || !data.rows.length)
        throw new Error("Select reviewed rows");
      const selected = b.preview.filter((r: any) => data.rows.includes(r.row));
      if (
        selected.length !== data.rows.length ||
        selected.some((r: any) => r.status !== "PAYMENT REVIEW REQUIRED")
      )
        throw new Error(
          "Only validated, nonduplicate preview rows may be imported",
        );
      const [total] =
        await tx`select count(*)::int count from fgl.audience_registrations where event_id=${e}`;
      if (total.count + selected.length > 2000)
        throw new Error("Event registration limit exceeded");
      for (const row of selected) {
        const d = row.data;
        const [r] =
          await tx`insert into fgl.audience_registrations(event_id,batch_id,name,email,phone,roll_number,status) values(${e},${b.id},${d.name},${d.email},${d.phone},${d.roll_number},'PAYMENT_PENDING') returning id`;
        await tx`insert into fgl.payments(event_id,attendee_id,reference,proof) values(${e},${r.id},${d.payment_reference || null},${d.payment_proof})`;
        await audit(tx, e, a, r.id, "REGISTRATION_IMPORTED", {
          batch_id: b.id,
        });
      }
      await tx`update fgl.import_batches set status='IMPORTED' where id=${b.id}`;
      return { imported: selected.length };
    }
    if (
      [
        "payment",
        "approve",
        "issue",
        "block",
        "revoke",
        "restore",
        "reject",
      ].includes(action)
    ) {
      if (
        !Array.isArray(data.ids) ||
        data.ids.length < 1 ||
        data.ids.length > 500 ||
        new Set(data.ids).size !== data.ids.length
      )
        throw new Error("Select 1–500 distinct registrations");
      const reason = text(data.reason, 500);
      for (const id of data.ids) {
        const [r] =
          await tx`select * from fgl.audience_registrations where id=${id} and event_id=${e} for update`;
        if (!r) throw new Error("Registration missing");
        if (action === "payment") {
          if (!["PAYMENT_PENDING", "NEEDS_REVIEW"].includes(r.status))
            throw new Error("Payment cannot change in this state");
          await tx`update fgl.payments set status='VERIFIED',verified_by=${a.id},verified_at=now() where attendee_id=${id}`;
          await tx`update fgl.audience_registrations set status='PAYMENT_VERIFIED' where id=${id}`;
        }
        if (action === "approve") {
          if (r.status !== "PAYMENT_VERIFIED")
            throw new Error("Verify payment first");
          await tx`update fgl.audience_registrations set status='APPROVED' where id=${id}`;
        }
        if (action === "issue") {
          if (
            r.status !== "APPROVED" ||
            event.phase === "ENDED" ||
            new Date(event.expires_at) <= new Date()
          )
            throw new Error("Approved, unexpired registration required");
          const [payment] =
            await tx`select status from fgl.payments where attendee_id=${id}`;
          if (payment?.status !== "VERIFIED")
            throw new Error("Payment verification required");
          const t = {
            id: randomUUID(),
            event_id: e,
            attendee_id: id,
            nonce: makeNonce(),
            key_id: process.env.FGL_SIGNING_KEY_ID,
            issued_at: Math.floor(Date.now() / 1000),
          };
          const qr = signed(t);
          verifyTicket(qr, keys(), e);
          await tx`insert into fgl.tickets ${tx({ ...t, qr })}`;
          await tx`update fgl.audience_registrations set status='PASS_ISSUED' where id=${id}`;
        }
        if (["block", "revoke", "reject"].includes(action)) {
          if (r.status === "CHECKED_IN")
            throw new Error("Checked-in history cannot be changed");
          const status =
            action === "block"
              ? "BLOCKED"
              : action === "reject"
                ? "REJECTED"
                : "REVOKED";
          await tx`update fgl.audience_registrations set status=${status} where id=${id}`;
          await tx`update fgl.tickets set status=${action === "block" ? "BLOCKED" : "REVOKED"} where attendee_id=${id} and status<>'REDEEMED'`;
        }
        if (action === "restore") {
          if (r.status !== "BLOCKED")
            throw new Error("Only blocked registrations can be restored");
          const [p] =
            await tx`select status from fgl.payments where attendee_id=${id}`;
          if (p?.status !== "VERIFIED")
            throw new Error("Payment is not verified");
          const [t] =
            await tx`update fgl.tickets set status='ACTIVE' where attendee_id=${id} and status='BLOCKED' returning id`;
          await tx`update fgl.audience_registrations set status=${t ? "PASS_ISSUED" : "APPROVED"} where id=${id}`;
        }
        await audit(
          tx,
          e,
          a,
          id,
          (
            {
              payment: "PAYMENT_APPROVED",
              approve: "REGISTRATION_APPROVED",
              issue: "PASS_CREATED",
              block: "PASS_BLOCKED",
              revoke: "PASS_REVOKED",
              restore: "PASS_RESTORED",
              reject: "REGISTRATION_REJECTED",
            } as Record<string, string>
          )[action],
          { reason },
        );
      }
      return { ok: true };
    }
    if (action === "gate_add") {
      const [s] =
        await tx`select user_id from fgl.event_staff where event_id=${e} and user_id=${data.staff_id} and role in ('gate','super_admin','event_admin') and active`;
      if (!s) throw new Error("Assign staff role first");
      const [g] =
        await tx`insert into fgl.gate_devices(event_id,staff_id,label) values(${e},${s.user_id},${text(data.label, 80)}) returning id`;
      await audit(tx, e, a, g.id, "GATE_CREATED");
      return g;
    }
    if (action === "gate_disable") {
      await tx`update fgl.gate_devices set active=false where event_id=${e} and id=${data.id}`;
      await audit(tx, e, a, data.id, "GATE_DISABLED");
      return { ok: true };
    }
    if (action === "staff_assign") {
      await staff(tx, e, a, ["super_admin"]);
      if (
        ![
          "event_admin",
          "gate",
          "judge",
          "controller",
          "backstage",
          "host",
        ].includes(data.role) ||
        data.user_id === a.id
      )
        throw new Error("Invalid role or self-change");
      if(data.active!==true || data.role!=='judge') {
        const pending=await tx`select p.id from fgl.performances p where p.event_id=${e} and p.state in ('ON_STAGE','PERFORMING','JUDGING') and ${data.user_id}::uuid=any(p.panel) and not exists(select 1 from fgl.judge_scores s where s.performance_id=p.id and s.judge_id=${data.user_id})`;
        if(pending.length)throw new Error('Replace the pending judge on the active act before disabling their role');
      }
      await tx`insert into fgl.event_staff(event_id,user_id,role,active) values(${e},${data.user_id},${data.role},${data.active === true}) on conflict(event_id,user_id) do update set role=excluded.role,active=excluded.active`;
      await audit(tx, e, a, data.user_id, "STAFF_CHANGED", {
        role: data.role,
        active: data.active === true,
      });
      return { ok: true };
    }
    throw new Error("Unknown operation");
  });
}
