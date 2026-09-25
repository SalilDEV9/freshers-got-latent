"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./display.module.css";

type LiveData = {
  event?: {
    title?: string;
    phase?: string;
    announcement?: string;
    voting_open?: boolean;
  };
  performances?: any[];
  results?: any[];
  audience?: any[];
};

const activeStates = ["ON_STAGE", "PERFORMING", "JUDGING", "REVEAL"];

export default function DisplayPage() {
  const [live, setLive] = useState<LiveData | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [lineupPage, setLineupPage] = useState(0);

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
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setLineupPage((page) => page + 1);
    }, 6500);

    return () => clearInterval(timer);
  }, []);

  const performances = live?.performances || [];
  const results = live?.results || [];

  const active = useMemo(
    () =>
      performances.find((p: any) =>
        activeStates.includes(p.state),
      ),
    [performances],
  );

  const ready = useMemo(
    () =>
      performances
        .filter((p: any) => p.state === "READY")
        .sort((a: any, b: any) => a.position - b.position),
    [performances],
  );

  const upcoming = useMemo(
    () =>
      performances
        .filter((p: any) =>
          ["REGISTERED", "CHECKED_IN", "BACKSTAGE", "READY"].includes(
            p.state,
          ),
        )
        .sort((a: any, b: any) => a.position - b.position),
    [performances],
  );

  const activeResult = active
    ? results.find((r: any) => r.id === active.id)
    : null;

  const completedCount = performances.filter((p: any) =>
    ["COMPLETED", "VOID"].includes(p.state),
  ).length;

  const totalCount = performances.length || 1;

  const activeIndex = active?.position || ready[0]?.position || 1;

  function remainingSeconds() {
    if (!active?.timer_end) return null;

    return Math.max(
      0,
      Math.ceil(
        (new Date(active.timer_end).getTime() - now) / 1000,
      ),
    );
  }

  function clock(seconds: number | null) {
    if (seconds === null) return "";

    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;

    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  const seconds = remainingSeconds();

  const lineupChunks = useMemo(() => {
    const size = 5;
    const chunks = [];

    for (let i = 0; i < performances.length; i += size) {
      chunks.push(performances.slice(i, i + size));
    }

    return chunks;
  }, [performances]);

  const currentLineup =
    lineupChunks.length > 0
      ? lineupChunks[lineupPage % lineupChunks.length]
      : [];

  function Progress() {
    const percentage = Math.min(
      100,
      Math.max(0, (completedCount / totalCount) * 100),
    );

    return (
      <div className={styles.progressBlock}>
        <div className={styles.progressTop}>
          <span>
            ACT {Math.min(activeIndex, totalCount)} OF {totalCount}
          </span>
          <span>{completedCount} COMPLETED</span>
        </div>

        <div className={styles.progressTrack}>
          <div
            className={styles.progressFill}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    );
  }

  function Upcoming() {
    const list = upcoming
      .filter((p: any) => p.id !== active?.id)
      .slice(0, 3);

    if (!list.length) return null;

    return (
      <div className={styles.upcoming}>
        <div className={styles.upcomingTitle}>COMING UP</div>

        {list.map((p: any, index: number) => (
          <div className={styles.upcomingRow} key={p.id}>
            <span>{index + 1}</span>
            <strong>{p.name}</strong>
            <small>{p.category}</small>
          </div>
        ))}
      </div>
    );
  }

  function Announcement() {
    if (!live?.event?.announcement) return null;

    return (
      <div className={styles.ticker}>
        <span>ANNOUNCEMENT</span>
        <strong>{live.event.announcement}</strong>
      </div>
    );
  }

  function VotingBanner() {
    if (
      !live?.event?.voting_open ||
      !active ||
      !["PERFORMING", "JUDGING"].includes(active.state)
    ) {
      return null;
    }

    return (
      <div className={styles.votingBanner}>
        AUDIENCE VOTING IS OPEN
      </div>
    );
  }

  if (!live) {
    return (
      <main className={styles.display}>
        <section className={styles.center}>
          <div className={styles.kicker}>
            MINDQUEST PRESENTS
          </div>

          <h1>FRESHERS GOT LATENT</h1>

          <p>{error || "Connecting to the stage..."}</p>
        </section>
      </main>
    );
  }

  if (live.event?.phase === "ENDED") {
    const ranked = [...results].sort(
      (a: any, b: any) =>
        Number(a.judge_rank || 999) -
        Number(b.judge_rank || 999),
    );

    return (
      <main className={styles.display}>
        <div className={styles.kicker}>
          FRESHERS GOT LATENT
        </div>

        <h1 className={styles.heading}>FINAL RESULTS</h1>

        {ranked.length >= 3 && (
          <section className={styles.podium}>
            <div className={styles.podiumItem}>
              <span>#2</span>
              <strong>{ranked[1]?.name}</strong>
              <small>
                {Number(ranked[1]?.average).toFixed(2)}
              </small>
            </div>

            <div
              className={`${styles.podiumItem} ${styles.first}`}
            >
              <span>#1</span>
              <strong>{ranked[0]?.name}</strong>
              <small>
                {Number(ranked[0]?.average).toFixed(2)}
              </small>
            </div>

            <div className={styles.podiumItem}>
              <span>#3</span>
              <strong>{ranked[2]?.name}</strong>
              <small>
                {Number(ranked[2]?.average).toFixed(2)}
              </small>
            </div>
          </section>
        )}

        <section className={styles.leaderboard}>
          {ranked.slice(0, 10).map((r: any) => (
            <div className={styles.resultRow} key={r.id}>
              <span className={styles.rank}>
                #{r.judge_rank}
              </span>

              <span className={styles.resultName}>
                {r.name}
              </span>

              <span className={styles.resultScore}>
                {Number(r.average).toFixed(2)}
              </span>

              {r.match && (
                <span className={styles.match}>
                  LATENT MATCH
                </span>
              )}
            </div>
          ))}
        </section>

        {live.audience && live.audience.length > 0 && (
          <section className={styles.audienceChoice}>
            <div className={styles.kicker}>
              AUDIENCE CHOICE
            </div>

            {[...live.audience]
              .sort(
                (a: any, b: any) =>
                  b.average - a.average,
              )
              .slice(0, 3)
              .map((a: any, index: number) => {
                const performer = performances.find(
                  (p: any) =>
                    p.id === a.performance_id,
                );

                return (
                  <div key={a.performance_id}>
                    #{index + 1}{" "}
                    {performer?.name || "Performer"} ·{" "}
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
          <div className={styles.kicker}>
            FRESHERS GOT LATENT
          </div>

          <h1>INTERMISSION</h1>

          <p>We will be right back.</p>

          <Announcement />
        </section>
      </main>
    );
  }

  if (live.event?.phase === "DRAFT") {
    return (
      <main className={styles.display}>
        <section className={styles.lineupScreen}>
          <div className={styles.kicker}>
            MINDQUEST PRESENTS
          </div>

          <h1 className={styles.lineupHeading}>
            TONIGHT&apos;S LINEUP
          </h1>

          <div className={styles.lineupList}>
            {currentLineup.map((p: any) => (
              <div
                className={styles.lineupRow}
                key={p.id}
              >
                <span>
                  {String(p.position).padStart(2, "0")}
                </span>

                <strong>{p.name}</strong>

                <small>{p.category}</small>

                {p.members?.length > 0 && (
                  <em>
                    + {p.members.length} team member
                    {p.members.length > 1 ? "s" : ""}
                  </em>
                )}
              </div>
            ))}
          </div>

          <div className={styles.stageSet}>
            THE STAGE IS SET
          </div>

          <Announcement />
        </section>
      </main>
    );
  }

  if (!active && ready.length > 0) {
    const next = ready[0];

    return (
      <main className={styles.display}>
        <section className={styles.center}>
          <div className={styles.kicker}>UP NEXT</div>

          <h1>{next.name}</h1>

          <p className={styles.category}>
            {next.category}
          </p>

          <Progress />

          <Upcoming />

          <Announcement />
        </section>
      </main>
    );
  }

  if (!active) {
    return (
      <main className={styles.display}>
        <section className={styles.center}>
          <div className={styles.kicker}>
            FRESHERS GOT LATENT
          </div>

          <h1>THE NEXT ACT IS GETTING READY</h1>

          <Progress />

          <Upcoming />

          <Announcement />
        </section>
      </main>
    );
  }

  if (active.state === "ON_STAGE") {
    return (
      <main className={styles.display}>
        <section className={styles.center}>
          <div className={styles.kicker}>
            NOW ON STAGE
          </div>

          <h1>{active.name}</h1>

          <p className={styles.category}>
            {active.category}
          </p>

          <Progress />

          <Upcoming />

          <Announcement />
        </section>
      </main>
    );
  }

  if (active.state === "PERFORMING") {
    return (
      <main className={styles.display}>
        <section className={styles.center}>
          <div className={styles.liveBadge}>
            ● LIVE
          </div>

          <h1>{active.name}</h1>

          <p className={styles.category}>
            {active.category}
          </p>

          {seconds !== null && (
            <div className={styles.timer}>
              {clock(seconds)}
            </div>
          )}

          <Progress />

          <Upcoming />

          <VotingBanner />

          <Announcement />
        </section>
      </main>
    );
  }

  if (active.state === "JUDGING") {
    return (
      <main className={styles.display}>
        <section className={styles.center}>
          <div className={styles.kicker}>
            JUDGING
          </div>

          <h1>{active.name}</h1>

          <div className={styles.scoring}>
            JUDGES ARE SCORING
            <span className={styles.dots}>...</span>
          </div>

          <Progress />

          <Upcoming />

          <VotingBanner />

          <Announcement />
        </section>
      </main>
    );
  }

  if (active.state === "REVEAL") {
    return (
      <main className={styles.display}>
        <section
          className={`${styles.center} ${styles.reveal}`}
        >
          <div className={styles.kicker}>RESULT</div>

          <h1>{active.name}</h1>

          {activeResult ? (
            <>
              <div className={styles.scoreGrid}>
                <div>
                  <span>SELF SCORE</span>

                  <strong>
                    {Number(
                      activeResult.self_score,
                    ).toFixed(2)}
                  </strong>
                </div>

                <div>
                  <span>JUDGES&apos; SCORE</span>

                  <strong>
                    {Number(
                      activeResult.average,
                    ).toFixed(2)}
                  </strong>
                </div>
              </div>

              {activeResult.match ? (
                <div className={styles.bigMatch}>
                  ★ LATENT MATCH ★
                </div>
              ) : (
                <div className={styles.difference}>
                  DIFFERENCE ·{" "}
                  {Number(
                    activeResult.difference,
                  ).toFixed(2)}
                </div>
              )}
            </>
          ) : (
            <p>Calculating result...</p>
          )}

          <Progress />

          <Upcoming />

          <Announcement />
        </section>
      </main>
    );
  }

  return null;
}