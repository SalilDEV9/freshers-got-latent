import "server-only";
import { db, eventId } from "./db";
import { staff } from "./entry";
import { safeCSV } from "./imports.mjs";
type Actor = { id: string; email: string };
type SQL = any;
const crew = ["super_admin", "event_admin", "controller", "backstage", "host"];
const active = ["ON_STAGE", "PERFORMING", "JUDGING", "REVEAL"];
const stages = [
  "REGISTERED",
  "CHECKED_IN",
  "BACKSTAGE",
  "READY",
  "ON_STAGE",
  "PERFORMING",
  "JUDGING",
  "REVEAL",
  "COMPLETED",
];
const validText = (v: any, n: number) => {
  if (typeof v !== "string" || !v.trim() || v.length > n)
    throw new Error("Invalid text");
  return v.trim();
};
export async function eventAction(action: string, data: any, actor: Actor) {
  const sql = db(),
    e = eventId();
  const role = await staff(sql, e, actor, [...crew, "judge"]);
  if (action === "event_export") {
    if (!["super_admin", "event_admin", "controller"].includes(role))
      throw new Error("Forbidden");
    const rows =
      await sql`select judge_rank,name,average,self_score,difference,match from fgl.results where event_id=${e} order by judge_rank,name`;
    return {
      csv: rows.length
        ? safeCSV([Object.keys(rows[0]), ...rows.map((r) => Object.values(r))])
        : "",
    };
  }
  if (action === "event_panel") {
    const [event] = await sql`select * from fgl.events where id=${e}`;
    const performances =
      await sql`select id,name,category,bio,members,position,state,panel,self_score is not null self_locked,timer_end from fgl.performances where event_id=${e} order by position`;
    const submissions =
      await sql`select performance_id,judge_id from fgl.judge_scores where event_id=${e}`;
    const mine =
      await sql`select * from fgl.judge_scores where event_id=${e} and judge_id=${actor.id}`;
    const judges =
      await sql`select user_id,active from fgl.event_staff where event_id=${e} and role='judge'`;
    return {
      event,
      performances,
      submissions,
      mine,
      judges,
      role,
      user_id: actor.id,
    };
  }
  return await sql.begin(async (tx: SQL) => {
    const [event] = await tx`select * from fgl.events where id=${e} for update`;
    const role = await staff(tx, e, actor, [...crew, "judge"]); // Recheck after acquiring the operation lock.
    if (
      action !== "event_score" &&
      event.revision !== String(data.revision) &&
      Number(event.revision) !== data.revision
    )
      throw new Error("Event changed. Reload before submitting again.");
    if (event.phase === "ENDED") throw new Error("Event has ended");
    const admin = ["super_admin", "event_admin"].includes(role);
    const control = admin || role === "controller";
    const backstage = admin || role === "backstage";
    const [p] = data.id
      ? await tx`select * from fgl.performances where event_id=${e} and id=${data.id}`
      : [];
    if (action === "event_add") {
      if (!backstage) throw new Error("Forbidden");
      const members = String(data.members || "")
        .split(";")
        .map((s: string) => s.trim())
        .filter(Boolean);
      if (members.length > 12 || members.some((m: string) => m.length > 80))
        throw new Error("Maximum 12 team members");
      await tx`insert into fgl.performances(event_id,name,category,bio,members,position) values(${e},${validText(data.name, 100)},${validText(data.category, 60)},${String(data.bio || "").slice(0, 500)},${tx.json(members)},(select coalesce(max(position),0)+1 from fgl.performances where event_id=${e}))`;
    } else if (action === "event_edit") {
      if(!backstage || !p || active.includes(p.state) || ['COMPLETED','VOID'].includes(p.state)) throw new Error('Only waiting performers can be edited');
      const members=String(data.members||'').split(';').map((x:string)=>x.trim()).filter(Boolean);
      if(members.length>12||members.some((m:string)=>m.length>80))throw new Error('Maximum 12 team members');
      await tx`update fgl.performances set name=${validText(data.name,100)},category=${validText(data.category,60)},bio=${String(data.bio||'').slice(0,500)},members=${tx.json(members)} where id=${p.id}`;
    } else if (action === "event_order") {
      if(!backstage||!p||!['REGISTERED','CHECKED_IN','BACKSTAGE','READY'].includes(p.state))throw new Error('Only waiting performers can move');
      const rows=await tx`select id,position from fgl.performances where event_id=${e} and state in ('REGISTERED','CHECKED_IN','BACKSTAGE','READY') order by position`;
      const i=rows.findIndex((r:any)=>r.id===p.id),offset=data.direction==='up'?-1:data.direction==='down'?1:0;
      const target=rows[i+offset];if(!offset||!target)throw new Error('Cannot move further');
      await tx`update fgl.performances set position=case when id=${p.id} then ${target.position} else ${p.position} end where id in (${p.id},${target.id})`;
    } else if (action === "event_replace_judge") {
      if(!admin||!p||!active.includes(p.state)||!p.panel.includes(data.old)||p.panel.includes(data.new))throw new Error('Select an active panel judge and a reserve');
      validText(data.reason,500);
      if((await tx`select 1 from fgl.judge_scores where performance_id=${p.id} and judge_id=${data.old}`).length)throw new Error('Submitted judges cannot be replaced on this performance');
      if(!(await tx`select 1 from fgl.event_staff where event_id=${e} and user_id=${data.new} and role='judge'`).length)throw new Error('Reserve must have a judge role');
      await tx`update fgl.event_staff set active=false where event_id=${e} and user_id=${data.old}`;
      await tx`update fgl.event_staff set active=true where event_id=${e} and user_id=${data.new}`;
      await tx`update fgl.performances set panel=array_replace(panel,${data.old}::uuid,${data.new}::uuid) where id=${p.id}`;
    } else if (action === "event_self") {
      if (!backstage) throw new Error("Forbidden");
      if (
        !p ||
        p.self_score !== null ||
        !["CHECKED_IN", "BACKSTAGE"].includes(p.state)
      )
        throw new Error("Self score must be locked once before READY");
      if (!Number.isInteger(data.score) || data.score < 1 || data.score > 10)
        throw new Error("Self score must be an integer from 1–10");
      await tx`update fgl.performances set self_score=${data.score} where id=${p.id}`;
    } else if (action === "event_score") {
      if (
        role !== "judge" ||
        !p ||
        p.state !== "JUDGING" ||
        event.phase !== "LIVE" ||
        !p.panel.includes(actor.id)
      )
        throw new Error("Judging is unavailable");
      const criteria = {
        creativity: data.creativity,
        entertainment: data.entertainment,
        originality: data.originality,
      };
      if (
        Object.values(criteria).some(
          (v) => !Number.isInteger(v) || v < 1 || v > 10,
        )
      )
        throw new Error("Each score must be an integer from 1–10");
      const total =
        criteria.creativity + criteria.entertainment + criteria.originality;
      await tx`insert into fgl.judge_scores(event_id,performance_id,judge_id,value,criteria,remarks) values(${e},${p.id},${actor.id},${total}::numeric/3,${tx.json(criteria)},${String(data.remarks || "").slice(0, 1000)})`;
    } else if (action === "event_transition") {
      if (!p) throw new Error("Performance missing");
      const index = stages.indexOf(p.state);
      if(index < 0 || index >= stages.length - 1) throw new Error("This state cannot advance");
      const next = stages[index + 1];
      if (data.state !== next)
        throw new Error("Follow the performance sequence");
      if (["CHECKED_IN", "BACKSTAGE", "READY"].includes(next)) {
        if (!backstage) throw new Error("Forbidden");
      } else if (!control) throw new Error("Forbidden");
      if (next === "READY" && p.self_score === null)
        throw new Error("Lock self score first");
      if (active.includes(next) && event.phase !== "LIVE")
        throw new Error("Set event LIVE first");
      if (next === "ON_STAGE") {
        const judges =
          await tx`select user_id from fgl.event_staff where event_id=${e} and role='judge' and active order by user_id`;
        if (!judges.length) throw new Error("Assign judges first");
        await tx`update fgl.performances set panel=${tx.array(
          judges.map((j: any) => j.user_id),
          2950,
        )} where id=${p.id}`;
      }
      if (next === "REVEAL") {
        const scores =
          await tx`select judge_id from fgl.judge_scores where performance_id=${p.id}`;
        if (
          !p.panel.length ||
          !p.panel.every((id: string) =>
            scores.some((s: any) => s.judge_id === id),
          )
        )
          throw new Error("All assigned judges must submit before reveal");
      }
      await tx`update fgl.performances set state=${next},timer_end=case when ${next}='PERFORMING' then now()+interval '90 seconds' when ${next} in ('JUDGING','COMPLETED') then null else timer_end end where id=${p.id}`;
    } else if (action === "event_recover") {
      if (!admin || !p) throw new Error("Forbidden");
      validText(data.reason, 500);
      if (["REVEAL", "COMPLETED", "VOID"].includes(p.state))
        throw new Error("Historical results cannot be silently withdrawn");
      if (
        !["ABSENT", "SKIPPED", "VOID", "READY", "CHECKED_IN"].includes(
          data.state,
        )
      )
        throw new Error("Invalid recovery state");
      if (
        ["READY", "CHECKED_IN"].includes(data.state) &&
        !["ABSENT", "SKIPPED"].includes(p.state)
      )
        throw new Error("Only restore absent or skipped acts");
      if (data.state === "READY" && p.self_score === null)
        throw new Error("Self score required");
      if (active.includes(p.state) && data.state !== "VOID")
        throw new Error("Void an active act with a reason");
      await tx`update fgl.performances set state=${data.state},timer_end=null where id=${p.id}`;
    } else if (action === "event_rules") {
      if (!admin || event.phase !== "DRAFT")
        throw new Error("Rules are locked once the event starts");
      if (!["exact", "nearest", "quarter", "half"].includes(data.mode))
        throw new Error("Invalid match mode");
      await tx`update fgl.events set match_mode=${data.mode} where id=${e}`;
    } else if (action === "event_settings") {
      if (!control) throw new Error("Forbidden");
      if (!["DRAFT", "LIVE", "PAUSED", "ENDED"].includes(data.phase))
        throw new Error("Invalid phase");
      if (event.phase !== "DRAFT" && data.phase === "DRAFT")
        throw new Error("Cannot return to draft");
      if (
        data.phase === "ENDED" &&
        (
          await tx`select id from fgl.performances where event_id=${e} and state in ('ON_STAGE','PERFORMING','JUDGING','REVEAL')`
        ).length
      )
        throw new Error("Complete the active act first");
      if (data.phase === "PAUSED" && event.phase === "LIVE")
        await tx`update fgl.performances set timer_remaining=greatest(0,extract(epoch from(timer_end-now()))::int),timer_end=null where event_id=${e} and timer_end is not null`;
      if (data.phase === "LIVE" && event.phase === "PAUSED")
        await tx`update fgl.performances set timer_end=now()+timer_remaining*interval '1 second',timer_remaining=null where event_id=${e} and timer_remaining is not null`;
      await tx`update fgl.events set phase=${data.phase},announcement=${String(data.announcement || "").slice(0, 1000)},voting_open=${data.phase === "LIVE" && data.voting_open === true} where id=${e}`;
    } else throw new Error("Unknown event operation");
    await tx`update fgl.events set revision=revision+1 where id=${e}`;
    // No self-score or sealed judge value is copied to an audit export.
    await tx`select fgl.append_audit(${e},${p?.id || e},${action.toUpperCase()},${actor.id},null,${tx.json({ state: data.state || null, reason: data.reason || null, old_judge:data.old||null,new_judge:data.new||null })})`;
    return { ok: true };
  });
}
