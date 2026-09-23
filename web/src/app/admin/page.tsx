"use client";
import { StaffUpdates } from "@/components/StaffUpdates";
import { useEffect, useState } from "react";
import { action } from "@/lib/browser";
import { detectMapping, fields } from "@/lib/imports.mjs";
import { Login, Logout } from "@/components/Common";
export default function Admin() {
  const [overview, setOverview] = useState<any>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [source, setSource] = useState<any>(null),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [batch, setBatch] = useState<any>(null),
    [selected, setSelected] = useState<string[]>([]),
    [rows, setRows] = useState<number[]>([]),
    [reason, setReason] = useState("");
  async function reload() {
    setOverview(await action("overview"));
  }
  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function loaded(result: any, name: string) {
    setSource({ ...result, name });
    setMapping(detectMapping(result.headers));
    setBatch(null);
    setRows([]);
  }
  async function bulk(op: string) {
    await run(async () => {
      await action(op, { ids: selected, reason });
      setSelected([]);
      setReason("");
      setMessage("Changes recorded in the audit ledger.");
      await reload();
    });
  }
  async function exportData(kind: string) {
    await run(async () => {
      const { csv } = await action("export", { kind });
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `fgl-${kind}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
  const registrations = overview?.registrations || [];
  return (
    <main>
      <StaffUpdates eventId={overview?.event_id} onUpdate={reload} />
      <div className="row spread">
        <div>
          <div className="eyebrow">Event administration</div>
          <h1>Audience control.</h1>
        </div>
        <Logout />
      </div>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="notice">
          {message}
        </div>
      )}
      {!overview ? (
        <Login />
      ) : (
        <>
          <div className="grid">
            {[
              ["Registrations", registrations.length],
              [
                "Payment verified",
                registrations.filter(
                  (r: any) => r.payment_status === "VERIFIED",
                ).length,
              ],
              [
                "Passes issued",
                registrations.filter((r: any) => r.ticket_id).length,
              ],
              [
                "Checked in",
                registrations.filter((r: any) => r.ticket_status === "REDEEMED")
                  .length,
              ],
            ].map(([label, value]) => (
              <section className="card" key={String(label)}>
                <div className="eyebrow">{label}</div>
                <strong className="stat">{value}</strong>
              </section>
            ))}
          </div>
          <section className="card">
            <h2>Import registrations</h2>
            <p>
              Upload existing Google Form responses. Review rows first;
              importing never verifies payment or issues a pass.
            </p>
            <label>
              CSV or XLSX
              <input
                type="file"
                accept=".csv,.xlsx"
                disabled={busy}
                onChange={(ev) => {
                  const file = ev.target.files?.[0];
                  if (!file) return;
                  void run(async () => {
                    if (file.size > 1_000_000)
                      throw new Error("Maximum file size is 1 MB");
                    const kind = file.name.endsWith(".csv") ? "csv" : "xlsx";
                    let content;
                    if (kind === "csv") content = await file.text();
                    else {
                      const b = new Uint8Array(await file.arrayBuffer());
                      let binary = "";
                      for (const byte of b) binary += String.fromCharCode(byte);
                      content = btoa(binary);
                    }
                    loaded(
                      await action("parse_file", { kind, content }),
                      file.name,
                    );
                  });
                }}
              />
            </label>
            <details>
              <summary>Sync a private Google Sheet</summary>
              <form
                onSubmit={(ev) => {
                  ev.preventDefault();
                  const f = new FormData(ev.currentTarget);
                  void run(async () => {
                    loaded(
                      await action("sheet_sync", {
                        sheet_id: f.get("sheet"),
                        range: f.get("range"),
                      }),
                      "Google Sheet",
                    );
                  });
                }}
              >
                <label>
                  Spreadsheet ID
                  <input name="sheet" required />
                </label>
                <label>
                  Range
                  <input
                    name="range"
                    defaultValue="'Form Responses 1'!A1:Z2001"
                    required
                  />
                </label>
                <button disabled={busy}>Fetch rows for preview</button>
              </form>
              <p className="muted">
                Requires a server-configured, read-only Google Sheets OAuth
                token. Sync does not auto-approve rows.
              </p>
            </details>
            {source && (
              <>
                <h3>Map columns</h3>
                <label>
                  Reuse an earlier mapping
                  <select
                    defaultValue=""
                    onChange={(ev) => {
                      const b = overview.batches.find(
                        (b: any) => b.id === ev.target.value,
                      );
                      if (b) setMapping(b.mapping);
                    }}
                  >
                    <option value="">Choose saved mapping</option>
                    {overview.batches.map((b: any) => (
                      <option key={b.id} value={b.id}>
                        {b.source} ·{" "}
                        {new Date(b.created_at).toLocaleDateString()}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid">
                  {fields.map((field) => (
                    <label key={field}>
                      {field}
                      <select
                        value={mapping[field] || ""}
                        onChange={(ev) => {
                          setMapping({ ...mapping, [field]: ev.target.value });
                          setBatch(null);
                        }}
                      >
                        <option value="">Not mapped</option>
                        {source.headers.map((h: string) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const b = await action("preview", {
                        rows: source.rows,
                        mapping,
                        source: source.name,
                      });
                      setBatch(b);
                      setRows([]);
                    })
                  }
                >
                  Validate & preview
                </button>
              </>
            )}
            {batch && (
              <>
                <h3>Review {batch.rows.length} rows</h3>
                <div className="row">
                  {[
                    "PAYMENT REVIEW REQUIRED",
                    "DUPLICATE",
                    "INVALID",
                    "MISSING DATA",
                  ].map((status) => (
                    <span className="badge" key={status}>
                      {status}:{" "}
                      {
                        batch.rows.filter((r: any) => r.status === status)
                          .length
                      }
                    </span>
                  ))}
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={
                      rows.length > 0 &&
                      rows.length ===
                        batch.rows.filter(
                          (r: any) => r.status === "PAYMENT REVIEW REQUIRED",
                        ).length
                    }
                    onChange={(ev) =>
                      setRows(
                        ev.target.checked
                          ? batch.rows
                              .filter(
                                (r: any) =>
                                  r.status === "PAYMENT REVIEW REQUIRED",
                              )
                              .map((r: any) => r.row)
                          : [],
                      )
                    }
                  />
                  Select all validated rows after review
                </label>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Select</th>
                        <th>Name / email</th>
                        <th>Roll</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batch.rows.map((r: any) => (
                        <tr key={r.row}>
                          <td>
                            <input
                              aria-label={`Select row ${r.row}`}
                              type="checkbox"
                              disabled={r.status !== "PAYMENT REVIEW REQUIRED"}
                              checked={rows.includes(r.row)}
                              onChange={(ev) =>
                                setRows(
                                  ev.target.checked
                                    ? [...rows, r.row]
                                    : rows.filter((n) => n !== r.row),
                                )
                              }
                            />
                          </td>
                          <td>
                            {r.data.name}
                            <br />
                            {r.data.email}
                          </td>
                          <td>{r.data.roll_number}</td>
                          <td>
                            {r.status}
                            <br />
                            <small>{r.issues.join("; ")}</small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  disabled={busy || !rows.length}
                  onClick={() =>
                    run(async () => {
                      const r = await action("import", {
                        batch_id: batch.id,
                        rows,
                      });
                      setMessage(
                        `${r.imported} registrations imported. Payment verification is still required.`,
                      );
                      setBatch(null);
                      setSource(null);
                      await reload();
                    })
                  }
                >
                  Approve import of {rows.length} rows
                </button>
              </>
            )}
          </section>
          <section className="card">
            <h2>Registrations & payments</h2>
            <div className="row">
              <button
                className="secondary"
                onClick={() => exportData("attendees")}
              >
                Export attendees
              </button>
              <button
                className="secondary"
                onClick={() => exportData("checkins")}
              >
                Export check-ins
              </button>
              <button className="secondary" onClick={() => exportData("audit")}>
                Export audit ledger
              </button>
            </div>
            <label>
              Reason / verification reference
              <textarea
                value={reason}
                onChange={(ev) => setReason(ev.target.value)}
                maxLength={500}
                placeholder="Record what you verified; do not include payment secrets."
              />
            </label>
            <div className="row">
              {[
                ["payment", "Verify payment"],
                ["approve", "Approve registration"],
                ["issue", "Generate passes"],
                ["block", "Block"],
                ["restore", "Restore blocked"],
                ["revoke", "Revoke pass"],
                ["reject", "Reject"],
              ].map(([op, label]) => (
                <button
                  className="secondary"
                  key={op}
                  disabled={busy || !selected.length || !reason.trim()}
                  onClick={() => bulk(op)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>Attendee</th>
                    <th>Payment</th>
                    <th>Registration / ticket</th>
                  </tr>
                </thead>
                <tbody>
                  {registrations.map((r: any) => (
                    <tr key={r.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.name}`}
                          checked={selected.includes(r.id)}
                          onChange={(ev) =>
                            setSelected(
                              ev.target.checked
                                ? [...selected, r.id]
                                : selected.filter((id) => id !== r.id),
                            )
                          }
                        />
                      </td>
                      <td>
                        {r.name}
                        <br />
                        <small>
                          {r.email}
                          <br />
                          {r.roll_number}
                        </small>
                      </td>
                      <td>
                        {r.payment_status}
                        <br />
                        <small>{r.reference || "No reference supplied"}</small>
                        {r.proof && /^https:\/\//.test(r.proof) && (
                          <p>
                            <a
                              href={r.proof}
                              target="_blank"
                              rel="noreferrer noopener"
                            >
                              View proof
                            </a>
                          </p>
                        )}
                      </td>
                      <td>
                        {r.status}
                        <br />
                        {r.ticket_status}
                        {r.ticket_id && (
                          <details>
                            <summary>Ticket ID</summary>
                            <small className="receipt">{r.ticket_id}</small>
                          </details>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="card">
            <h2>Gate control</h2>
            <form
              onSubmit={(ev) => {
                ev.preventDefault();
                const f = new FormData(ev.currentTarget);
                void run(async () => {
                  await action("gate_add", {
                    label: f.get("label"),
                    staff_id: f.get("staff"),
                  });
                  await reload();
                });
              }}
            >
              <div className="grid">
                <label>
                  Gate label
                  <input
                    name="label"
                    placeholder="Gate 1"
                    required
                    maxLength={80}
                  />
                </label>
                <label>
                  Assigned staff Auth UUID
                  <input name="staff" required />
                </label>
              </div>
              <button disabled={busy}>Add gate device</button>
            </form>
            {overview.gates.map((g: any) => (
              <p key={g.id}>
                {g.label} · {g.active ? "ACTIVE" : "DISABLED"}{" "}
                <button
                  className="secondary"
                  disabled={busy || !g.active}
                  onClick={() =>
                    run(async () => {
                      await action("gate_disable", { id: g.id });
                      await reload();
                    })
                  }
                >
                  Disable
                </button>
              </p>
            ))}
            <details>
              <summary>Administrator entry override</summary>
              <p>
                For QR unavailable with institute ID verified. This still
                requires an approved, paid, active ticket and cannot admit a
                redeemed pass twice.
              </p>
              <form
                onSubmit={(ev) => {
                  ev.preventDefault();
                  const f = new FormData(ev.currentTarget);
                  void run(async () => {
                    const r = await action("override", {
                      ticket_id: f.get("ticket"),
                      device_id: f.get("gate"),
                      reason: f.get("reason"),
                      identity_confirmed: f.get("identity") === "on",
                    });
                    setMessage(r.reason);
                    await reload();
                  });
                }}
              >
                <label>
                  Ticket UUID
                  <input name="ticket" required />
                </label>
                <label>
                  Gate
                  <select name="gate" required>
                    {overview.gates
                      .filter((g: any) => g.active)
                      .map((g: any) => (
                        <option key={g.id} value={g.id}>
                          {g.label}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Detailed reason
                  <input
                    name="reason"
                    minLength={10}
                    maxLength={500}
                    required
                  />
                </label>
                <label>
                  <input name="identity" type="checkbox" required />I verified
                  institute identity
                </label>
                <button className="danger" disabled={busy}>
                  Record override and confirm entry
                </button>
              </form>
            </details>
            <details>
              <summary>Staff roles — super administrator</summary>
              <form
                onSubmit={(ev) => {
                  ev.preventDefault();
                  const f = new FormData(ev.currentTarget);
                  void run(async () => {
                    await action("staff_assign", {
                      user_id: f.get("id"),
                      role: f.get("role"),
                      active: f.get("active") === "on",
                    });
                    setMessage("Staff access updated and audited.");
                  });
                }}
              >
                <label>
                  Supabase Auth UUID
                  <input name="id" required />
                </label>
                <label>
                  Role
                  <select name="role">
                    {[
                      "event_admin",
                      "gate",
                      "judge",
                      "controller",
                      "backstage",
                      "host",
                    ].map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <input type="checkbox" name="active" defaultChecked />
                  Enabled
                </label>
                <button disabled={busy}>Save role</button>
              </form>
            </details>
          </section>
          <section className="card">
            <h2>Recent gate activity</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Result</th>
                    <th>Gate device</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.attempts.map((a: any) => (
                    <tr key={a.id}>
                      <td>{new Date(a.created_at).toLocaleTimeString()}</td>
                      <td>{a.reason}</td>
                      <td className="receipt">{a.device_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => run(reload)}
            >
              Refresh overview
            </button>
          </section>
        </>
      )}
    </main>
  );
}
