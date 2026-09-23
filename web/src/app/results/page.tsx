"use client";
import { Live, useLive } from "@/components/Common";
export default function Results() {
  const { live, error } = useLive();
  return (
    <main>
      <div className="eyebrow">Official revealed results</div>
      <h1>Freshers Got Latent</h1>
      <p>
        {live?.event?.phase === "ENDED"
          ? "Final results"
          : "Provisional — only revealed performances are included."}
      </p>
      <button onClick={() => window.print()}>Print / save PDF</button>
      {error && <p role="alert">{error}</p>}
      <Live live={live} />
      {live?.results?.some((r: any) => r.match) && (
        <section className="card">
          <h2>Latent matches</h2>
          {live.results
            .filter((r: any) => r.match)
            .map((r: any) => (
              <p key={r.id}>
                {r.name} · Self score {r.self_score} · Average{" "}
                {Number(r.average).toFixed(2)}
              </p>
            ))}
        </section>
      )}
      {live?.audience?.length > 0 && (
        <section className="card">
          <h2>Audience choice</h2>
          {[...live.audience]
            .sort((a, b) => b.average - a.average)
            .map((r: any) => (
              <p key={r.performance_id}>
                {
                  live.performances.find((p: any) => p.id === r.performance_id)
                    ?.name
                }{" "}
                · {Number(r.average).toFixed(2)} / 5 · {r.votes} votes
              </p>
            ))}
        </section>
      )}
    </main>
  );
}
