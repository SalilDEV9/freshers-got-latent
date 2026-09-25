"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./display.module.css";

type LiveData = {
  event?: {
    title?: string;
    phase?: string;
    announcement?: string;
  };
  performances?: any[];
  results?: any[];
  audience?: any[];
};

export default function DisplayPage() {
  const [live, setLive] = useState<LiveData | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    async function refresh() {
      try {
        const response = await fetch("/api/live", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Live feed unavailable");
        }

        const data = await response.json();

        if (!stopped) {
          setLive(data);
          setError("");
        }
      } catch {
        if (!stopped) {
          setError("Reconnecting to live event...");
        }
      } finally {
        if (!stopped) {
          timer = setTimeout(refresh, 2500);
        }
      }
    }

    refresh();

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 250);

    return () => clearInterval(timer);
  }, []);

  const performances = live?.performances || [];
  const results = live?.results || [];

  const active = useMemo(
    () =>
      performances.find((p: any) =>
        ["ON_STAGE", "PERFORMING", "JUDGING", "REVEAL"].includes(p.state),
      ),
    [performances],
  );

  const next = useMemo(
    () => performances.find((p: any) => p.state === "READY"),
    [performances],
  );

  const activeResult = active
    ? results.find((r: any) => r.id === active.id)
    : null;

  function remainingSeconds() {
    if (!active?.timer_end) return null;

    const end = new Date(active.timer_end).getTime();

    return Math.max(0, Math.ceil((end - now) / 1000));
  }

  function clock(seconds: number | null) {
    if (seconds === null) return "";

    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;

    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  const seconds = remainingSeconds();

  if (!live) {
    return (
      <main className={styles.display}>
        <section className={styles.center}>
          <div className={styles.kicker}>MINDQUEST PRESENTS</div>
          <h1>FRESHERS GOT LATENT</h1>
          <p>{error || "Connecting to the stage..."}</p>
        </section>
      </main>
    );
  }

  if (live.event?.phase === "ENDED") {
    return (
      <main className={styles.display}>
        <div className={styles.kicker}>FRESHERS GOT LATENT</div>

        <h1 className={styles.heading}>FINAL RESULTS</h1>

        <section className={styles.leaderboard}>
          {results.length === 0 ? (
            <div className={styles.center}>
              <h2>Results will appear shortly.</h2>
            </div>
          ) : (
            results.slice(0, 10).map((r: any) => (
              <div className={styles.resultRow} key={r.id}>
                <span className={styles.rank}>#{r.judge_rank}</span>

                <span className={styles.resultName}>{r.name}</span>

                <span className={styles.resultScore}>
                  {Number(r.average).toFixed(2)}
                </span>

                {r.match && (
                  <span className={styles.match}>LATENT MATCH</span>
                )}
              </div>
            ))
          )}
        </section>

        {live.audience && live.audience.length > 0 && (
          <section className={styles.audienceChoice}>
            <div className={styles.kicker}>AUDIENCE CHOICE</div>

            {[...live.audience]
              .sort((a: any, b: any) => b.average - a.average)
              .slice(0, 3)
              .map((a: any, index: number) => {
                const performer = performances.find(
                  (p: any) => p.id === a.performance_id,
                );

                return (
                  <div key={a.performance_id}>
                    #{index + 1} {performer?.name || "Performer"} ·{" "}
                    {Number(a.average).toFixed(2)} / 5
                  </div>
                );
              })}
          </section>
        )}
      </main>
    );
  }

  if (live.event?.phase === "PAUSED") {
    return (
      <main className={styles.display}>
        <section className={styles.center}>
          <div className={styles.kicker}>FRESHERS GOT LATENT</div>

          <h1>SHOW PAUSED</h1>

          <p>We will resume shortly.</p>

          {live.event?.announcement && (
            <p className={styles.announcement}>
              {live.event.announcement}
            </p>
          )}
        </section>
      </main>
    );
  }

  if (!active && next) {
    return (
      <main className={styles.display}>
        <section className={styles.center}>
          <div className={styles.kicker}>UP NEXT</div>

          <h1>{next.name}</h1>

          <p className={styles.category}>{next.category}</p>

          <p>Get ready for the next act.</p>
        </section>
      </main>
    );
  }

  if (!active) {
    return (
      <main className={styles.display}>
        <section className={styles.center}>
          <div className={styles.kicker}>MINDQUEST PRESENTS</div>

          <h1>FRESHERS GOT LATENT</h1>

          <p>
            {live.event?.phase === "DRAFT"
              ? "THE STAGE IS SET"
              : "The next act will begin shortly."}
          </p>

          {live.event?.announcement && (
            <p className={styles.announcement}>
              {live.event.announcement}
            </p>
          )}
        </section>
      </main>
    );
  }

  if (active.state === "ON_STAGE") {
    return (
      <main className={styles.display}>
        <section className={styles.center}>
          <div className={styles.kicker}>NOW ON STAGE</div>

          <h1>{active.name}</h1>

          <p className={styles.category}>{active.category}</p>

          <div className={styles.position}>
            PERFORMANCE #{active.position}
          </div>

          {next && (
            <div className={styles.next}>
              UP NEXT · {next.name}
            </div>
          )}
        </section>
      </main>
    );
  }

  if (active.state === "PERFORMING") {
    return (
      <main className={styles.display}>
        <section className={styles.center}>
          <div className={styles.liveBadge}>● LIVE</div>

          <h1>{active.name}</h1>

          <p className={styles.category}>{active.category}</p>

          {seconds !== null && (
            <div className={styles.timer}>{clock(seconds)}</div>
          )}

          {next && (
            <div className={styles.next}>
              UP NEXT · {next.name}
            </div>
          )}
        </section>
      </main>
    );
  }

  if (active.state === "JUDGING") {
    return (
      <main className={styles.display}>
        <section className={styles.center}>
          <div className={styles.kicker}>JUDGING</div>

          <h1>{active.name}</h1>

          <div className={styles.scoring}>
            JUDGES ARE SCORING
            <span className={styles.dots}>...</span>
          </div>

          {next && (
            <div className={styles.next}>
              UP NEXT · {next.name}
            </div>
          )}
        </section>
      </main>
    );
  }

  if (active.state === "REVEAL") {
    return (
      <main className={styles.display}>
        <section className={`${styles.center} ${styles.reveal}`}>
          <div className={styles.kicker}>RESULT</div>

          <h1>{active.name}</h1>

          {activeResult ? (
            <>
              <div className={styles.scoreGrid}>
                <div>
                  <span>SELF SCORE</span>
                  <strong>
                    {Number(activeResult.self_score).toFixed(2)}
                  </strong>
                </div>

                <div>
                  <span>JUDGES' SCORE</span>
                  <strong>
                    {Number(activeResult.average).toFixed(2)}
                  </strong>
                </div>
              </div>

              {activeResult.match ? (
                <div className={styles.bigMatch}>
                  ✓ LATENT MATCH
                </div>
              ) : (
                <div className={styles.difference}>
                  DIFFERENCE ·{" "}
                  {Number(activeResult.difference).toFixed(2)}
                </div>
              )}
            </>
          ) : (
            <p>Calculating result...</p>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className={styles.display}>
      <section className={styles.center}>
        <div className={styles.kicker}>FRESHERS GOT LATENT</div>
        <h1>The next act begins shortly.</h1>
      </section>
    </main>
  );
}