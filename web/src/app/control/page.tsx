"use client";
import {PerformerTools,HostPrompt} from "@/components/PerformerTools";
import { StaffUpdates } from "@/components/StaffUpdates";
import { useEffect, useState } from "react";
import { action } from "@/lib/browser";
import { Live, Login, Logout, useLive } from "@/components/Common";
export default function Control() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const { live } = useLive();
  async function reload() {
    setData(await action("event_panel"));
  }
  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, []);
  async function run(op: string, body: any) {
    setBusy(true);
    setError("");
    try {
      await action(op, { ...body, revision: Number(data.event.revision) });
      await reload();
    } catch (e: any) {
      setError(e.message);
      await reload().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  const admin = ["event_admin", "super_admin"].includes(data?.role),
    controller = admin || data?.role === "controller",
    backstage = admin || data?.role === "backstage";
  const next: Record<string, string> = {
    REGISTERED: "CHECKED_IN",
    CHECKED_IN: "BACKSTAGE",
    BACKSTAGE: "READY",
    READY: "ON_STAGE",
    ON_STAGE: "PERFORMING",
    PERFORMING: "JUDGING",
    JUDGING: "REVEAL",
    REVEAL: "COMPLETED",
  };
  return (
    <main>
      <StaffUpdates eventId={data?.event?.id} onUpdate={reload} />
      <div className="row spread">
        <div>
          <div className="eyebrow">Crew / Judge workspace</div>
          <h1>Run the show.</h1>
        </div>
        <Logout />
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {!data ? (
        <Login />
      ) : (
        <>
          <div className="row">
            <span className="badge">{data.role}</span>
            {admin && <a href="/admin">Audience administration</a>}
            <a href="/results">Results / PDF</a>
            <button
              className="secondary"
              disabled={busy}
              onClick={async () => {
                try {
                  const { csv } = await action("event_export");
                  const url = URL.createObjectURL(
                    new Blob([csv], { type: "text/csv" }),
                  );
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "fgl-results.csv";
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (e: any) {
                  setError(e.message);
                }
              }}
            >
              Export results CSV
            </button>
          </div>
          <Live live={live} />
          {controller && (
            <section className="card">
              <h2>Event control</h2>
              {admin && data.event.phase === "DRAFT" && (
                <label>
                  Latent match rule
                  <select
                    value={data.event.match_mode}
                    onChange={(e) =>
                      run("event_rules", { mode: e.target.value })
                    }
                  >
                    {["exact", "nearest", "quarter", "half"].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
              )}
              <form
                key={data.event.revision}
                onSubmit={(ev) => {
                  ev.preventDefault();
                  const f = new FormData(ev.currentTarget);
                  void run("event_settings", {
                    phase: f.get("phase"),
                    announcement: f.get("announcement"),
                    voting_open: f.get("voting") === "on",
                  });
                }}
              >
                <label>
                  Event phase
                  <select name="phase" defaultValue={data.event.phase}>
                    {["DRAFT", "LIVE", "PAUSED", "ENDED"].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Announcement
                  <textarea
                    name="announcement"
                    defaultValue={data.event.announcement}
                    maxLength={1000}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    name="voting"
                    defaultChecked={data.event.voting_open}
                  />
                  Audience voting enabled during performances
                </label>
                <button disabled={busy}>Apply event settings</button>
              </form>
            </section>
          )}
          {backstage && (
            <details>
              <summary>Add performer / team</summary>
              <form
                onSubmit={(ev) => {
                  ev.preventDefault();
                  const f = new FormData(ev.currentTarget);
                  void run("event_add", Object.fromEntries(f));
                }}
              >
                <label>
                  Stage name
                  <input name="name" required maxLength={100} />
                </label>
                <label>
                  Category
                  <input name="category" required maxLength={60} />
                </label>
                <label>
                  Host introduction
                  <textarea name="bio" maxLength={500} />
                </label>
                <label>
                  Team members (semicolon separated)
                  <input name="members" />
                </label>
                <button disabled={busy}>Add performer</button>
              </form>
            </details>
          )}
          <h2>Performance queue</h2>
          {data.performances.map((p: any) => (
            <section className="card" key={p.id}>
              <div className="eyebrow">
                #{p.position} / {p.category}
              </div>
              <h2>{p.name}</h2>
              <p>{p.bio}</p>
              <span className="badge">{p.state}</span><PerformerTools p={p} judges={data.judges} admin={admin} backstage={backstage} busy={busy} run={run}/>{["host","controller","event_admin","super_admin"].includes(data.role)&&<HostPrompt p={p}/>}
              <p>
                Self score {p.self_locked ? "sealed" : "not submitted"} · Judges
                submitted:{" "}
                {
                  data.submissions.filter((s: any) => s.performance_id === p.id)
                    .length
                }{" "}
                / {p.panel.length}
              </p>
              {p.members.length > 0 && <p>Team: {p.members.join(" · ")}</p>}
              {backstage &&
                !p.self_locked &&
                ["CHECKED_IN", "BACKSTAGE"].includes(p.state) && (
                  <form
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      const f = new FormData(ev.currentTarget);
                      void run("event_self", {
                        id: p.id,
                        score: Number(f.get("score")),
                      });
                    }}
                  >
                    <label>
                      Participant’s self score (locked permanently)
                      <input
                        name="score"
                        type="number"
                        min={1}
                        max={10}
                        step={1}
                        required
                      />
                    </label>
                    <button disabled={busy}>Seal self score</button>
                  </form>
                )}
              {next[p.state] &&
                ((backstage &&
                  ["CHECKED_IN", "BACKSTAGE", "READY"].includes(
                    next[p.state],
                  )) ||
                  (controller &&
                    !["CHECKED_IN", "BACKSTAGE", "READY"].includes(
                      next[p.state],
                    ))) && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      run("event_transition", {
                        id: p.id,
                        state: next[p.state],
                      })
                    }
                  >
                    Move to {next[p.state]}
                  </button>
                )}
              {data.role === "judge" &&
                p.state === "JUDGING" &&
                p.panel.includes(data.user_id) &&
                (data.mine.some((s: any) => s.performance_id === p.id) ? (
                  <p className="notice">Your scores are locked.</p>
                ) : (
                  <form
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      const f = new FormData(ev.currentTarget);
                      void run("event_score", {
                        id: p.id,
                        ...Object.fromEntries(
                          ["creativity", "entertainment", "originality"].map(
                            (k) => [k, Number(f.get(k))],
                          ),
                        ),
                        remarks: f.get("remarks"),
                      });
                    }}
                  >
                    {["creativity", "entertainment", "originality"].map((k) => (
                      <label key={k}>
                        {k}
                        <input
                          type="number"
                          name={k}
                          min={1}
                          max={10}
                          step={1}
                          required
                        />
                      </label>
                    ))}
                    <label>
                      Remarks
                      <textarea name="remarks" maxLength={1000} />
                    </label>
                    <p>Each parameter has equal weight. Submission is final.</p>
                    <button disabled={busy}>Lock individual scores</button>
                  </form>
                ))}
              {admin && !["VOID", "REVEAL", "COMPLETED"].includes(p.state) && (
                <details>
                  <summary>Recovery operation</summary>
                  <form
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      const f = new FormData(ev.currentTarget);
                      void run("event_recover", {
                        id: p.id,
                        state: f.get("state"),
                        reason: f.get("reason"),
                      });
                    }}
                  >
                    <label>
                      Action
                      <select name="state">
                        {[
                          "ABSENT",
                          "SKIPPED",
                          "VOID",
                          "READY",
                          "CHECKED_IN",
                        ].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Reason
                      <input name="reason" maxLength={500} required />
                    </label>
                    <button disabled={busy} className="danger">
                      Record recovery
                    </button>
                  </form>
                </details>
              )}
            </section>
          ))}
        </>
      )}
    </main>
  );
}
