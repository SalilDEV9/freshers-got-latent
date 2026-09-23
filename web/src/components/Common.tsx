"use client";
import { useEffect, useState } from "react";
import { browserAuth } from "@/lib/browser";
export function Login() {
  const [error, setError] = useState("");
  return (
    <>
      <button
        onClick={async () => {
          try {
            const { error } = await browserAuth().auth.signInWithOAuth({
              provider: "google",
              options: {
                redirectTo: location.origin + "/auth/callback",
                queryParams: { prompt: "select_account" },
              },
            });
            if (error) throw error;
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        Continue with Google
      </button>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
    </>
  );
}
export function Logout() {
  return (
    <button
      className="secondary"
      onClick={async () => {
        await browserAuth().auth.signOut();
        location.href = "/";
      }}
    >
      Sign out
    </button>
  );
}
export function useLive() {
  const [live, setLive] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        if (!document.hidden) {
          const r = await fetch("/api/live");
          if (!r.ok) throw new Error("Live updates unavailable. Retrying.");
          const v = await r.json();
          if (!stopped) {
            setLive(v);
            setError("");
          }
        }
      } catch (e: any) {
        if (!stopped) setError(e.message);
      } finally {
        if (!stopped) timer = setTimeout(refresh, 4000 + Math.random() * 1000);
      }
    }
    refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  return { live, error };
}
export function Live({ live }: { live: any }) {
  if (!live) return <p className="muted">Loading live event…</p>;
  const now = live.performances?.find((p: any) =>
    ["ON_STAGE", "PERFORMING", "JUDGING", "REVEAL"].includes(p.state),
  );
  const next = live.performances?.find((p: any) => p.state === "READY");
  return (
    <>
      <div className="grid">
        <section className="card">
          <div className="eyebrow">Live now</div>
          <h2>{now?.name || "The stage is getting ready"}</h2>
          <p>
            {now
              ? `${now.category} · Performance ${now.position}`
              : "Watch this space for the first act."}
          </p>
          <span className="badge">
            {now?.state || live.event?.phase || "OFFLINE"}
          </span>
        </section>
        <section className="card">
          <div className="eyebrow">Up next</div>
          <h2>{next?.name || "To be announced"}</h2>
          <p>{next?.category}</p>
        </section>
      </div>
      {live.event?.announcement && (
        <div className="notice">{live.event.announcement}</div>
      )}
      {live.results?.length > 0 && (
        <section className="card">
          <h2>Revealed results</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Act</th>
                  <th>Judge average</th>
                  <th>Self score</th>
                  <th>Latent match</th>
                </tr>
              </thead>
              <tbody>
                {live.results.map((r: any) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{Number(r.average).toFixed(2)}</td>
                    <td>{r.self_score}</td>
                    <td>{r.match ? "MATCH" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
