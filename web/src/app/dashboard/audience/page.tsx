"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { action } from "@/lib/browser";
import { Live, Login, Logout, useLive } from "@/components/Common";

export default function Audience() {
  const [tab, setTab] = useState("HOME");
  const [data, setData] = useState<any>(null);
  const [feedback, setFeedback] = useState<any>(null);
  const [error, setError] = useState("");
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");

  const { live, error: liveError } = useLive();

  async function refresh() {
    const d = await action("dashboard");
    setData(d);

    if (d.ticket?.qr) {
      setQr(
        await QRCode.toDataURL(d.ticket.qr, {
          width: 360,
          margin: 4,
          errorCorrectionLevel: "M",
        }),
      );
    } else {
      setQr("");
    }
  }

  async function loadFeedback() {
    try {
      const result = await action("feedback_get");
      setFeedback(result.feedback || null);
    } catch {
      setFeedback(null);
    }
  }

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    async function load() {
      try {
        await action("link");
      } catch (e: any) {
        if (!stopped) setError(e.message);
      }

      if (stopped) return;

      try {
        await refresh();
        await loadFeedback();
      } catch (e: any) {
        if (!stopped) setError(e.message);
      }

      const poll = async () => {
        if (stopped) return;

        if (!document.hidden) {
          try {
            await refresh();
          } catch {}
        }

        if (!stopped) {
          timer = setTimeout(poll, 10000);
        }
      };

      timer = setTimeout(poll, 10000);
    }

    load();

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  const current = live?.performances?.find((p: any) =>
    ["PERFORMING", "JUDGING"].includes(p.state),
  );

  const r = data?.registration;
  const instagram = process.env.NEXT_PUBLIC_INSTAGRAM_URL;

  return (
    <main>
      <div className="row spread">
        <div>
          <div className="eyebrow">Audience / 2026</div>

          <h1>
            Your event.
            <br />
            Your seat.
          </h1>
        </div>

        <Logout />
      </div>

      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}

      {!r ? (
        <section className="card">
          <h2>Registration required</h2>

          <p>{data?.message || "Checking your approved registration…"}</p>

          <Login />

          {data?.role && (
            <p>
              <a href={data.role === "gate" ? "/gate" : "/control"}>
                Open your staff workspace
              </a>
            </p>
          )}
        </section>
      ) : (
        <>
          <nav aria-label="Audience navigation">
            {["HOME", "PASS", "LIVE", "VOTE", "FEEDBACK", "PROFILE"].map(
              (t) => (
                <button
                  key={t}
                  aria-current={tab === t}
                  onClick={() => {
                    setTab(t);

                    if (t === "FEEDBACK") {
                      loadFeedback();
                    }
                  }}
                >
                  {t}
                </button>
              ),
            )}
          </nav>

          {tab === "HOME" && (
            <>
              <h2>Welcome, {r.name}</h2>

              <div className="grid">
                {[
                  ["Registration", r.status],
                  ["Payment", data.payment?.status],
                  ["Entry pass", data.ticket?.status || "PENDING"],
                ].map(([k, v]) => (
                  <section className="card" key={k}>
                    <div className="eyebrow">{k}</div>
                    <h3>{v}</h3>
                  </section>
                ))}
              </div>

              <Live live={live} />

              {instagram &&
                /^https:\/\/(www\.)?instagram\.com\//.test(instagram) && (
                  <section className="card">
                    <h2>Follow MindQuest</h2>

                    <p>Results, photos, future events and announcements.</p>

                    <a
                      className="button secondary"
                      href={instagram}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open Instagram
                    </a>
                  </section>
                )}
            </>
          )}

          {tab === "PASS" && (
            <section className="card pass">
              <div className="eyebrow">My event pass</div>

              <h2>{r.name}</h2>

              <p className="receipt">{r.roll_number}</p>

              {qr ? (
                <>
                  <img
                    src={qr}
                    alt="Your personal event entry QR code"
                    width={360}
                    height={360}
                  />

                  <span className="badge">ACTIVE</span>

                  <p>
                    Show this pass and your institute ID at the event gate. Do
                    not share your QR.
                  </p>
                </>
              ) : (
                <>
                  <strong>
                    {data.ticket?.status === "REDEEMED"
                      ? "CHECKED IN"
                      : data.ticket?.status || "PASS NOT ISSUED"}
                  </strong>

                  {data.ticket?.redeemed_at && (
                    <p>
                      {new Date(data.ticket.redeemed_at).toLocaleString()} ·{" "}
                      {data.ticket.gate}
                    </p>
                  )}
                </>
              )}

              <small className="receipt">{data.ticket?.id}</small>
            </section>
          )}

          {tab === "LIVE" && <Live live={live} />}

          {tab === "VOTE" && (
            <section className="card">
              <h2>
                {current?.name || "Voting will open during a performance"}
              </h2>

              {r.status !== "CHECKED_IN" ? (
                <p>Check in at the gate to enable voting.</p>
              ) : !current || !live?.event?.voting_open ? (
                <p>Voting is currently closed.</p>
              ) : (
                <form
                  onSubmit={async (ev) => {
                    ev.preventDefault();

                    const f = new FormData(ev.currentTarget);

                    setBusy(true);
                    setMessage("");

                    try {
                      await action("vote", {
                        performance_id: current.id,

                        ...Object.fromEntries(
                          ["creativity", "entertainment", "originality"].map(
                            (k) => [k, Number(f.get(k))],
                          ),
                        ),
                      });

                      setMessage("Your vote is recorded. Thank you.");
                    } catch (e: any) {
                      setMessage(e.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {["creativity", "entertainment", "originality"].map((k) => (
                    <label key={k}>
                      {k.toUpperCase()}

                      <select name={k} defaultValue="" required>
                        <option value="" disabled>
                          Select a rating
                        </option>

                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n} / 5
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}

                  <button disabled={busy}>
                    {busy ? "Submitting..." : "Submit vote"}
                  </button>
                </form>
              )}

              {message && (
                <p role="status" className="notice">
                  {message}
                </p>
              )}
            </section>
          )}

          {tab === "FEEDBACK" && (
            <section className="card">
              <div className="eyebrow">Audience feedback</div>

              <h2>Tell us how the event went.</h2>

              <p>Your feedback helps MindQuest improve future events.</p>

              {!["PASS_ISSUED", "CHECKED_IN"].includes(r.status) ? (
                <div className="notice">
                  Your event pass must be active before submitting feedback.
                </div>
              ) : (
                <form
                  key={
                    feedback?.updated_at ||
                    feedback?.created_at ||
                    "new-feedback"
                  }
                  onSubmit={async (ev) => {
                    ev.preventDefault();

                    const form = new FormData(ev.currentTarget);
                    const hadFeedback = feedback !== null;

                    setBusy(true);
                    setFeedbackMessage("");

                    try {
                      await action("feedback_submit", {
                        rating: Number(form.get("rating")),
                        liked: String(form.get("liked") || ""),
                        improvement: String(form.get("improvement") || ""),
                        comment: String(form.get("comment") || ""),
                        anonymous: form.get("anonymous") === "on",
                      });

                      await loadFeedback();

                      setFeedbackMessage(
                        hadFeedback
                          ? "Feedback updated successfully."
                          : "Feedback submitted successfully. Thank you.",
                      );
                    } catch (e: any) {
                      setFeedbackMessage(e.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <label>
                    Overall event rating

                    <select
                      name="rating"
                      defaultValue={
                        feedback?.rating ? String(feedback.rating) : ""
                      }
                      required
                    >
                      <option value="" disabled>
                        Select a rating
                      </option>

                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n} / 5
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    What did you like most?

                    <textarea
                      name="liked"
                      defaultValue={feedback?.liked || ""}
                      maxLength={1000}
                      rows={4}
                      placeholder="Tell us what you enjoyed about the event."
                    />
                  </label>

                  <label>
                    What can we improve?

                    <textarea
                      name="improvement"
                      defaultValue={feedback?.improvement || ""}
                      maxLength={1000}
                      rows={4}
                      placeholder="Tell us what we can improve next time."
                    />
                  </label>

                  <label>
                    Additional comments

                    <textarea
                      name="comment"
                      defaultValue={feedback?.comment || ""}
                      maxLength={1500}
                      rows={4}
                      placeholder="Anything else you would like to share?"
                    />
                  </label>

                  <label>
                    <input
                      type="checkbox"
                      name="anonymous"
                      defaultChecked={feedback?.anonymous === true}
                    />{" "}
                    Show my feedback anonymously to event administrators
                  </label>

                  <button disabled={busy}>
                    {busy
                      ? "Saving..."
                      : feedback
                        ? "Update feedback"
                        : "Submit feedback"}
                  </button>
                </form>
              )}

              {feedbackMessage && (
                <p role="status" className="notice">
                  {feedbackMessage}
                </p>
              )}

              {feedback && (
                <p>
                  Feedback saved · Last updated{" "}
                  {new Date(
                    feedback.updated_at || feedback.created_at,
                  ).toLocaleString()}
                </p>
              )}
            </section>
          )}

          {tab === "PROFILE" && (
            <section className="card">
              <h2>{r.name}</h2>

              <p>{r.email}</p>

              <p>{r.roll_number}</p>

              <p>
                For registration corrections, contact the event team. Your
                Google account is linked to this registration.
              </p>
            </section>
          )}
        </>
      )}

      {liveError && <p role="status">{liveError}</p>}
    </main>
  );
}