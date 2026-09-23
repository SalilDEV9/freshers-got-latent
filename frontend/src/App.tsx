import {
  AccountTools,
  PasswordSettings,
  RegistrationForm,
  RosterImport,
  PerformerTools,
  EventRecovery,
  HostPrompts,
} from "./Management";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronRight,
  ClipboardList,
  Clock3,
  Download,
  Eye,
  LayoutDashboard,
  LockKeyhole,
  Megaphone,
  Mic2,
  Monitor,
  Play,
  Plus,
  Radio,
  Settings2,
  ShieldCheck,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { api } from "./api";
import type { Act, Command, Event, Rules, User } from "./types";

const crew = ["super_admin", "event_admin", "controller", "backstage", "host"];
const admins = ["super_admin", "event_admin"];
const activeStates = ["ON_STAGE", "PERFORMING", "JUDGING", "REVEAL"];
const sequence = [
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
const pretty = (s: string) => s.toLowerCase().replaceAll("_", " ");
const fmt = (n: number) => n.toFixed(2);

function Badge({
  children,
  tone = "",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={"badge " + tone}>{children}</span>;
}
function Empty({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <Mic2 size={30} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Timer({ end, remaining }: { end: number | null; remaining?: number|null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const sec = end ? Math.max(0, Math.ceil(end - now / 1000)) : Math.ceil(remaining||0);
  return (
    <span className={"timer " + (end && sec === 0 ? "expired" : "")}>
      {String(Math.floor(sec / 60)).padStart(2, "0")}
      <span>:</span>
      {String(sec % 60).padStart(2, "0")}
    </span>
  );
}
function ScoreCard({ act }: { act: Act }) {
  const r = act.result;
  if (!r)
    return (
      <div className="sealed">
        <LockKeyhole size={20} />
        <div>
          Scores are sealed<span>Revealed by the stage controller</span>
        </div>
      </div>
    );
  return (
    <div className="reveal">
      <Badge tone={r.match ? "lime" : ""}>
        {r.match ? "IT’S A MATCH" : "NO MATCH"}
      </Badge>
      <div className="score-grid">
        <div>
          <strong>{fmt(r.average)}</strong>
          <span>Judge average</span>
        </div>
        <div>
          <strong>{r.self_score}</strong>
          <span>Self-score</span>
        </div>
        <div>
          <strong>{fmt(r.difference)}</strong>
          <span>Difference</span>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [event, setEvent] = useState<Event | null>(null),
    [user, setUser] = useState<User | null>(null),
    [view, setView] = useState(location.hash.slice(1) || "audience");
  const [connected, setConnected] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [login, setLogin] = useState(false);
  const revision = useRef(-1),
    pending = useRef(false),
    generation = useRef(0);
  const refresh = useCallback(async () => {
    if (pending.current) return;
    const request = ++generation.current;
    try {
      const [e, u] = await Promise.all([
        api<Event>("/event"),
        api<User | null>("/me"),
      ]);
      if (request !== generation.current || pending.current) return;
      revision.current = e.revision;
      setEvent(e);
      setUser(u);
      setConnected(true);
    } catch {
      if (request === generation.current) setConnected(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const interval = setInterval(refresh, 5000);
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`,
      );
      ws.onmessage = (e) => {
        const message = JSON.parse(e.data);
        if (message.revision !== revision.current) void refresh();
      };
      ws.onerror = () => ws?.close();
    } catch {
      /* HTTP polling remains active. */
    }
    return () => {
      clearInterval(interval);
      ws?.close();
    };
  }, [refresh]);
  useEffect(() => {
    const change = () => setView(location.hash.slice(1) || "audience");
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  const command: Command = async (action, payload = {}, participant_id) => {
    if (pending.current) return false;
    pending.current = true;
    generation.current++;
    setBusy(true);
    setError("");
    try {
      const e = await api<Event>("/command", {
        revision: revision.current,
        action,
        payload,
        participant_id,
      });
      generation.current++;
      revision.current = e.revision;
      setEvent(e);
      setNotice("Saved to the event.");
      return true;
    } catch (e) {
      setError((e as Error).message);
      pending.current = false;
      await refresh();
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  async function vote(id: string) {
    if (
      !confirm(
        "Lock your Audience Choice vote? You can vote once for this event.",
      )
    )
      return;
    setBusy(true);
    try {
      await api("/vote", { participant_id: id });
      setNotice("Your vote is locked.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const isCrew = !!user && crew.includes(user.role),
    isAdmin = !!user && admins.includes(user.role),
    isControl = !!user && [...admins, "controller"].includes(user.role);
  const allowed = [
    "audience",
    "results",
    "display",
    ...(user ? ["account"] : []),
    ...(isCrew ? ["overview", "queue"] : []),
    ...(isControl ? ["control"] : []),
    ...(user?.role === "judge" ? ["judge"] : []),
    ...(isAdmin ? ["settings", "audit"] : []),
  ];
  const page = allowed.includes(view) ? view : "audience";
  const nav = [
    { id: "overview", label: "Event overview", icon: LayoutDashboard },
    { id: "queue", label: "Backstage & queue", icon: ClipboardList },
    { id: "control", label: "Stage control", icon: Radio },
    { id: "judge", label: "Judging desk", icon: ShieldCheck },
    { id: "audience", label: "Audience", icon: Users },
    { id: "results", label: "Results", icon: Trophy },
    { id: "display", label: "Stage display", icon: Monitor },
    { id: "settings", label: "Event settings", icon: Settings2 },
    { id: "account", label: "My account", icon: LockKeyhole },
    { id: "audit", label: "Activity log", icon: Activity },
  ].filter((x) => allowed.includes(x.id));
  const act = event?.participants.find((p) => activeStates.includes(p.state));
  if (!event)
    return (
      <div className="loading">
        <span className="wordmark">
          MIND<span>QUEST</span>
        </span>
        <h1>Freshers Got Latent</h1>
        <p>
          {connected ? "Opening the event…" : "Connecting to the event server…"}
        </p>
        <button onClick={refresh}>Retry connection</button>
      </div>
    );
  if (page === "display")
    return (
      <div className="display">
        <a className="exit-display" href="#audience">
          <X size={18} /> Exit display
        </a>
        <div className="display-brand">
          MINDQUEST PRESENTS{" "}
          <Badge tone={connected ? "teal" : ""}>
            {connected ? pretty(event.phase) : "Connection lost"}
          </Badge>
        </div>
        <h1>
          FRESHERS GOT <span>LATENT.</span>
        </h1>
        {event.announcement && (
          <p className="announcement">{event.announcement}</p>
        )}
        {act ? (
          <>
            <div className="display-act">
              <span>
                ACT {String(act.position).padStart(2, "0")} · {act.category}
              </span>
              <h2>{act.name}</h2>
              <Badge>{pretty(act.state)}</Badge>
            </div>
            <ScoreCard act={act} />
            <Timer end={event.timer_end} remaining={event.timer_remaining}/>
          </>
        ) : (
          <p className="display-wait">
            {event.phase === "ENDED"
              ? "That’s a wrap. Thank you, everyone."
              : "The next act is on its way."}
          </p>
        )}
      </div>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="wordmark" href="#audience">
          MIND<span>QUEST</span>
          <small>THE EVENT DESK</small>
        </a>
        <div className="event-label">
          <span className="micro">CURRENT EVENT</span>
          <strong>
            Freshers Got
            <br />
            Latent <span className="lime-text">/ 01</span>
          </strong>
        </div>
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <a
              key={n.id}
              className={page === n.id ? "selected" : ""}
              href={"#" + n.id}
            >
              <n.icon size={18} />
              {n.label}
              {page === n.id && <span className="nav-mark" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="micro">BUILT FOR THE MOMENT</span>
          <p>
            One stage.
            <br />
            Unexpected talent.
          </p>
          <div className="club">
            MQ{" "}
            <span>
              MindQuest Club
              <br />
              <small>IIIT Kottayam</small>
            </span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            FRESHERS GOT LATENT <span className="slash">/</span>{" "}
            <span className="topbar-section">
              {nav.find((n) => n.id === page)?.label}
            </span>
          </span>
          <div>
            <span
              className={"connection " + (connected ? "online" : "offline")}
            >
              <i />
              {connected ? "Connected" : "Reconnecting"}
            </span>
            {user ? (
              <>
                <span className="user-label">
                  {user.name}
                  <small>{pretty(user.role)}</small>
                </span>
                <button
                  className="quiet"
                  onClick={async () => {
                    try {
                      await api("/logout", {});
                      await refresh();
                      location.hash = "audience";
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Sign out
                </button>
              </>
            ) : (
              <button onClick={() => setLogin(true)}>
                Crew sign in <ArrowUpRight size={15} />
              </button>
            )}
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">MINDQUEST / FGL 01</div>
              <h1>
                {
                  (
                    {
                      overview: "The show, at a glance.",
                      queue: "Behind the curtain.",
                      control: "You run the show.",
                      judge: "Your judging desk.",
                      audience: "Take your front-row seat.",
                      results: "The scores are in.",
                      settings: "Set the stage.",
                      audit: "Every action. On record.",
                      account: "Your account.",
                    } as Record<string, string>
                  )[page]
                }
              </h1>
            </div>
            <Badge tone={event.phase === "LIVE" ? "teal" : ""}>
              {event.phase === "LIVE" && <Radio size={13} />}{" "}
              {pretty(event.phase)}
            </Badge>
          </div>
          {!connected && (
            <div className="alert error" role="alert">
              Connection interrupted. Showing the last saved state; changes may
              fail until the connection returns.
            </div>
          )}
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button
                aria-label="Dismiss error"
                className="quiet"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              <Check size={16} />
              {notice}
            </div>
          )}
          {event.announcement && page !== "control" && (
            <div className="announcement">
              <Megaphone size={18} />
              {event.announcement}
            </div>
          )}
          {["overview", "audience", "control", "judge"].includes(page) && (
            <div className="metrics">
              <div>
                <span>Total acts</span>
                <strong>
                  {String(event.participants.length).padStart(2, "0")}
                </strong>
                <small>On the event roster</small>
              </div>
              <div>
                <span>Completed</span>
                <strong>
                  {String(
                    event.participants.filter((p) => p.state === "COMPLETED")
                      .length,
                  ).padStart(2, "0")}
                </strong>
                <small>Performances wrapped</small>
              </div>
              <div>
                <span>
                  {isCrew || user?.role === "judge"
                    ? "Judging panel"
                    : "Audience Choice"}
                </span>
                <strong>
                  {isCrew || user?.role === "judge"
                    ? String(event.judges.length).padStart(2, "0")
                    : event.voting_open
                      ? "OPEN"
                      : "CLOSED"}
                </strong>
                <small>
                  {isCrew || user?.role === "judge"
                    ? "Assigned judges"
                    : "Separate from judge scores"}
                </small>
              </div>
              <div>
                <span>Event status</span>
                <strong className="status-metric">{event.phase}</strong>
                <small>Revision {event.revision}</small>
              </div>
            </div>
          )}
          <fieldset disabled={busy} className="content-fieldset">
            {["overview", "audience", "control", "judge"].includes(page) && (
              <div className="stage-layout">
                <section className="panel stage">
                  <div className="panel-head">
                    <h2>
                      <Mic2 size={18} /> On stage
                    </h2>
                    <span className="micro">
                      {act
                        ? "ACT " + String(act.position).padStart(2, "0")
                        : "STANDBY"}
                    </span>
                  </div>
                  {act ? (
                    <>
                      <div className="act-intro">
                        <div className="act-number">
                          {String(act.position).padStart(2, "0")}
                        </div>
                        <div>
                          <Badge tone="teal">{pretty(act.state)}</Badge>
                          <h2>{act.name}</h2>
                          <p>{act.category}</p>
                        </div>
                      </div>
                      {act.bio && <p className="act-bio">{act.bio}</p>}
                      <ScoreCard act={act} />
                      {isCrew && (
                        <div className="judge-progress">
                          <span>Judge submissions</span>
                          <strong>
                            {act.submitted?.length ?? 0} / {event.judges.length}{" "}
                            locked
                          </strong>
                          <div className="button-group">
                            {event.judges.map((id) => (
                              <Badge
                                key={id}
                                tone={
                                  act.submitted?.includes(String(id))
                                    ? "teal"
                                    : ""
                                }
                              >
                                {event.judge_names?.[String(id)] ||
                                  `Judge ${id}`}{" "}
                                ·{" "}
                                {act.submitted?.includes(String(id))
                                  ? "locked"
                                  : "waiting"}
                              </Badge>
                            ))}
                          </div>
                          <progress
                            value={act.submitted?.length ?? 0}
                            max={event.judges.length || 1}
                          />
                        </div>
                      )}
                      {page === "judge" && user && (
                        <JudgeScore
                          key={act.id}
                          act={act}
                          event={event}
                          user={user}
                          command={command}
                        />
                      )}
                    </>
                  ) : (
                    <Empty
                      title={
                        event.phase === "ENDED"
                          ? "That’s a wrap."
                          : "Ready when you are."
                      }
                    >
                      {isCrew
                        ? "Move a ready act onto the stage to begin."
                        : "The next performance will appear here."}
                    </Empty>
                  )}
                  <div className="stage-footer">
                    <span>
                      <Clock3 size={16} /> Stage timer
                    </span>
                    <Timer end={event.timer_end} remaining={event.timer_remaining}/>
                  </div>
                </section>
                <section className="panel up-next">
                  <div className="panel-head">
                    <h2>Up next</h2>
                    <a
                      href={isCrew ? "#queue" : "#results"}
                      aria-label={
                        isCrew ? "Open backstage queue" : "Open results"
                      }
                    >
                      <ArrowUpRight size={18} />
                    </a>
                  </div>
                  {event.participants
                    .filter(
                      (p) =>
                        !activeStates.includes(p.state) &&
                        ![
                          "COMPLETED",
                          "ABSENT",
                          "SKIPPED",
                          "VOID",
                          "PENDING",
                        ].includes(p.state),
                    )
                    .sort((a, b) => a.position - b.position)
                    .slice(0, 4)
                    .map((p, i) => (
                      <div className="next-act" key={p.id}>
                        <span className="queue-number">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <div>
                          <strong>{p.name}</strong>
                          <small>{p.category}</small>
                        </div>
                        <Badge tone={p.state === "READY" ? "teal" : ""}>
                          {pretty(p.state)}
                        </Badge>
                      </div>
                    ))}
                  {!event.participants.some(
                    (p) =>
                      !activeStates.includes(p.state) &&
                      ![
                        "COMPLETED",
                        "ABSENT",
                        "SKIPPED",
                        "VOID",
                        "PENDING",
                      ].includes(p.state),
                  ) && (
                    <p className="muted pad">No acts waiting in the queue.</p>
                  )}
                  <div className="rule-note">
                    <ShieldCheck size={21} />
                    <h3>The latent rule</h3>
                    <p>
                      Each performer locks a self-score. Judges score
                      independently. The reveal shows how closely they match.
                    </p>
                    <span className="micro">
                      MATCH MODE · {pretty(event.rules.mode)}
                    </span>
                  </div>
                </section>
              </div>
            )}
            {page === "overview" && (
              <section className="panel quick-links">
                <a href="#queue">
                  <ClipboardList />
                  <div>
                    <h3>Manage the queue</h3>
                    <p>Check in performers and prepare the next act.</p>
                  </div>
                  <ChevronRight />
                </a>
                {isControl && (
                  <a href="#control">
                    <Radio />
                    <div>
                      <h3>Open stage control</h3>
                      <p>Run the timer, scoring and reveal.</p>
                    </div>
                    <ChevronRight />
                  </a>
                )}
              </section>
            )}
            {page === "queue" && user && (
              <Queue event={event} user={user} command={command} />
            )}
            {page === "control" && (
              <Control event={event} act={act} command={command} />
            )}
            {page === "audience" && (
              <section className="panel">
                <div className="panel-head">
                  <h2>
                    <Trophy size={18} /> Audience Choice
                  </h2>
                  <Badge tone={event.voting_open ? "lime" : ""}>
                    {event.voting_open ? "Voting open" : "Voting closed"}
                  </Badge>
                </div>
                <div className="pad">
                  <p className="muted">
                    One locked vote per audience account. Your favourite act
                    wins Audience Choice; this does not change the judges’
                    results.
                  </p>
                  {!user && (
                    <button onClick={() => setLogin(true)}>
                      Sign in to vote <ArrowUpRight size={16} />
                    </button>
                  )}
                  {event.my_vote && (
                    <p className="lime-text">
                      <Check size={16} /> Your vote is locked. Thank you.
                    </p>
                  )}
                  <div className="vote-grid">
                    {event.participants
                      .filter((p) => p.state === "COMPLETED")
                      .map((p) => (
                        <div className="vote-card" key={p.id}>
                          <span className="micro">{p.category}</span>
                          <h3>{p.name}</h3>
                          <button
                            disabled={
                              !event.voting_open ||
                              user?.role !== "audience" ||
                              !!event.my_vote
                            }
                            onClick={() => vote(p.id)}
                          >
                            {event.my_vote === p.id
                              ? "Voted"
                              : "Vote for this act"}{" "}
                            <Trophy size={15} />
                          </button>
                        </div>
                      ))}
                  </div>
                  {!event.participants.some((p) => p.state === "COMPLETED") && (
                    <p className="muted">
                      Voting choices appear after performances are completed.
                    </p>
                  )}
                </div>
              </section>
            )}
            {page === "results" && (
              <Results event={event} canExport={isControl} />
            )}
            {page === "account" && (
              <PasswordSettings
                onChanged={async () => {
                  await refresh();
                  setNotice("Password changed. Sign in again.");
                  setLogin(true);
                }}
              />
            )}
            {page === "audience" && (
              <RegistrationForm event={event} user={user} refresh={refresh} />
            )}
            {page === "settings" && (
              <Settings event={event} command={command} user={user!} />
            )}
            {page === "audit" && <Audit revision={event.revision} />}
          </fieldset>
          <footer className="footer">
            <span>MINDQUEST · IIIT KOTTAYAM</span>
            <span>
              FRESHERS GOT LATENT <span className="lime-text">/</span> EVENT
              DESK
            </span>
          </footer>
        </main>
      </div>
      {login && (
        <Login
          onClose={() => setLogin(false)}
          onSuccess={async (u) => {
            setLogin(false);
            await refresh();
            location.hash = crew.includes(u.role)
              ? "overview"
              : u.role === "judge"
                ? "judge"
                : "audience";
          }}
        />
      )}
    </div>
  );
}

function Login({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: (u: User) => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog ref={dialog} onCancel={onClose} className="login-modal">
      <div className="panel-head">
        <h2>Sign in to the event</h2>
        <button className="quiet" onClick={onClose} aria-label="Close sign in">
          <X />
        </button>
      </div>
      <form
        className="pad form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const f = new FormData(e.currentTarget);
          try {
            onSuccess(
              await api<User>("/login", {
                username: f.get("username"),
                password: f.get("password"),
              }),
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="muted">Use the account issued by your event organiser.</p>
        <label>
          Username
          <input name="username" autoComplete="username" required autoFocus />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
          <ArrowUpRight size={16} />
        </button>
      </form>
    </dialog>
  );
}

function JudgeScore({
  act,
  event,
  user,
  command,
}: {
  act: Act;
  event: Event;
  user: User;
  command: Command;
}) {
  const [value, setValue] = useState(String(event.rules.minimum));
  if (!event.judges.includes(user.id))
    return (
      <p className="pad muted">You are not assigned to this event’s panel.</p>
    );
  if (act.my_score)
    return (
      <div className="pad">
        <Badge tone="teal">
          <LockKeyhole size={14} /> Your score: {act.my_score.value} · Locked
        </Badge>
      </div>
    );
  return (
    <form
      className="pad judge-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm(`Lock your score of ${value}? It cannot be changed.`))
          void command("score", { value: Number(value) }, act.id);
      }}
    >
      <label>
        Your score
        <input
          type="number"
          min={event.rules.minimum}
          max={event.rules.maximum}
          step={event.rules.step}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
        />
      </label>
      <p className="muted">
        Score independently. The performer’s self-score stays sealed until the
        reveal.
      </p>
      <button
        className="primary"
        disabled={act.state !== "JUDGING" || event.phase !== "LIVE"}
      >
        <LockKeyhole size={16} /> Lock score
      </button>
      {act.state !== "JUDGING" && (
        <small>Scoring opens when the controller starts judging.</small>
      )}
    </form>
  );
}

function Queue({
  event,
  user,
  command,
}: {
  event: Event;
  user: User;
  command: Command;
}) {
  const [query, setQuery] = useState(""),
    [add, setAdd] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [score, setScore] = useState("");
  const editable = [...admins, "backstage", "controller"].includes(user.role),
    canAdd = [...admins, "backstage"].includes(user.role);
  const p = event.participants.find((x) => x.id === selected);
  const sorted = [...event.participants]
    .sort((a, b) => a.position - b.position)
    .filter((p) =>
      (p.name + " " + p.category).toLowerCase().includes(query.toLowerCase()),
    );
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>
            Performance queue{" "}
            <span className="muted">/ {event.participants.length}</span>
          </h2>
          {canAdd && (
            <button className="primary" onClick={() => setAdd(!add)}>
              <Plus size={16} />
              {add ? "Close form" : "Add performer"}
            </button>
          )}
        </div>
        {add && (
          <form
            className="pad form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              if (
                await command("participant_add", {
                  ...Object.fromEntries(f),
                  members: String(f.get("members") || "")
                    .split(";")
                    .map((x) => x.trim())
                    .filter(Boolean),
                })
              ) {
                form.reset();
                setAdd(false);
              }
            }}
          >
            <label>
              Stage name
              <input name="name" required maxLength={80} />
            </label>
            <label>
              Talent category
              <select name="category">
                <option>Music</option>
                <option>Comedy</option>
                <option>Dance</option>
                <option>Poetry</option>
                <option>Magic</option>
                <option>Other</option>
              </select>
            </label>
            <label className="wide">
              Host introduction
              <textarea
                name="bio"
                maxLength={500}
                placeholder="A short introduction the host can read on stage."
              />
            </label>
            <label className="wide">
              Team members (optional; semicolon separated)
              <input name="members" maxLength={1000} />
            </label>
            <button className="primary">
              Add to roster <Plus size={16} />
            </button>
          </form>
        )}
        <div className="table-toolbar">
          <label className="search">
            Find a performer
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or talent…"
            />
          </label>
          <span className="muted">Select a performer to manage their act.</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Performer</th>
                <th>Talent</th>
                <th>Status</th>
                <th>Self-score</th>
                <th>Queue</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.id}>
                  <td className="mono">
                    {String(p.position).padStart(2, "0")}
                  </td>
                  <td>
                    <button
                      className="table-name"
                      onClick={() => {
                        setSelected(p.id);
                        setScore("");
                      }}
                    >
                      {p.name}
                      <ArrowUpRight size={14} />
                    </button>
                  </td>
                  <td>{p.category}</td>
                  <td>
                    <Badge tone={p.state === "READY" ? "teal" : ""}>
                      {pretty(p.state)}
                    </Badge>
                  </td>
                  <td>
                    {p.self_locked ? (
                      <span className="lock-label">
                        <LockKeyhole size={13} /> Sealed
                      </span>
                    ) : (
                      "Pending"
                    )}
                  </td>
                  <td>
                    <div className="button-group">
                      <button
                        disabled={
                          !editable ||
                          activeStates.includes(p.state) ||
                          [
                            "COMPLETED",
                            "ABSENT",
                            "SKIPPED",
                            "VOID",
                            "PENDING",
                          ].includes(p.state)
                        }
                        aria-label={"Move " + p.name + " up"}
                        onClick={() => command("reorder", { delta: -1 }, p.id)}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        disabled={
                          !editable ||
                          activeStates.includes(p.state) ||
                          [
                            "COMPLETED",
                            "ABSENT",
                            "SKIPPED",
                            "VOID",
                            "PENDING",
                          ].includes(p.state)
                        }
                        aria-label={"Move " + p.name + " down"}
                        onClick={() => command("reorder", { delta: 1 }, p.id)}
                      >
                        <ArrowDown size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!sorted.length && (
          <Empty title="No performers found.">
            Add your first performer or try another search.
          </Empty>
        )}
      </section>
      {canAdd && <RosterImport command={command} />}
      {p && (
        <section className="panel performer-detail">
          <div className="panel-head">
            <h2>{p.name}</h2>
            <button
              className="quiet"
              onClick={() => setSelected(null)}
              aria-label="Close performer details"
            >
              <X size={18} />
            </button>
          </div>
          <div className="pad">
            <Badge>{pretty(p.state)}</Badge>
            <p>{p.bio || "No host introduction added."}</p>
            {p.state === "BACKSTAGE" && !p.self_locked && canAdd && (
              <form
                className="inline-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    confirm(
                      "Seal this self-score? It cannot be edited or viewed until reveal.",
                    )
                  )
                    if (
                      await command(
                        "self_score",
                        { value: Number(score) },
                        p.id,
                      )
                    )
                      setScore("");
                }}
              >
                <label>
                  Performer’s self-score
                  <input
                    type="number"
                    required
                    min={event.rules.minimum}
                    max={event.rules.maximum}
                    step={event.rules.step}
                    value={score}
                    onChange={(e) => setScore(e.target.value)}
                  />
                </label>
                <button className="primary">
                  <LockKeyhole size={15} /> Seal self-score
                </button>
              </form>
            )}
            {editable &&
              sequence.includes(p.state) &&
              sequence.indexOf(p.state) < 3 && (
                <button
                  className="primary"
                  disabled={p.state === "BACKSTAGE" && !p.self_locked}
                  onClick={() =>
                    command(
                      "transition",
                      { state: sequence[sequence.indexOf(p.state) + 1] },
                      p.id,
                    )
                  }
                >
                  Mark {pretty(sequence[sequence.indexOf(p.state) + 1])}
                  <ChevronRight size={16} />
                </button>
              )}
            {editable &&
              !activeStates.includes(p.state) &&
              !["COMPLETED", "ABSENT", "SKIPPED", "VOID", "PENDING"].includes(
                p.state,
              ) && (
                <div className="button-group spaced">
                  <button
                    onClick={() => {
                      if (confirm("Skip this act for the rest of this event?"))
                        void command("transition", { state: "SKIPPED" }, p.id);
                    }}
                  >
                    Skip act
                  </button>
                  <button
                    onClick={() => {
                      if (
                        confirm(
                          "Mark this performer absent for the rest of this event?",
                        )
                      )
                        void command("transition", { state: "ABSENT" }, p.id);
                    }}
                  >
                    Mark absent
                  </button>
                </div>
              )}
            <PerformerTools key={p.id} act={p} user={user} command={command} />
            <HostPrompts category={p.category} />
          </div>
        </section>
      )}
    </>
  );
}

function Control({
  event,
  act,
  command,
}: {
  event: Event;
  act?: Act;
  command: Command;
}) {
  const [announcement, setAnnouncement] = useState(event.announcement),
    [seconds, setSeconds] = useState(90);
  const next = [...event.participants]
    .sort((a, b) => a.position - b.position)
    .find((p) => p.state === "READY");
  const nextState = act ? sequence[sequence.indexOf(act.state) + 1] : null;
  return (
    <div className="control-grid">
      <section className="panel">
        <div className="panel-head">
          <h2>
            <Radio size={18} /> Live controls
          </h2>
        </div>
        <div className="pad form-stack">
          <div className="button-group">
            {event.phase === "DRAFT" && (
              <button
                className="primary"
                onClick={() => {
                  if (
                    confirm(
                      "Go live? Scoring settings and the judging panel will be locked.",
                    )
                  )
                    void command("phase", { phase: "LIVE" });
                }}
              >
                <Play size={16} /> Go live
              </button>
            )}
            {event.phase === "LIVE" && (
              <button onClick={() => command("phase", { phase: "PAUSED" })}>
                Pause event
              </button>
            )}
            {event.phase === "PAUSED" && (
              <button
                className="primary"
                onClick={() => command("phase", { phase: "LIVE" })}
              >
                Resume event
              </button>
            )}
            {["LIVE", "PAUSED"].includes(event.phase) && (
              <button
                className="danger"
                onClick={() => {
                  if (
                    confirm(
                      "End this event permanently and publish Audience Choice totals?",
                    )
                  )
                    void command("phase", { phase: "ENDED" });
                }}
              >
                End event
              </button>
            )}
          </div>
          {act && nextState ? (
            <button
              className="primary big-button"
              disabled={
                event.phase !== "LIVE" ||
                (nextState === "REVEAL" &&
                  act.submitted?.length !== event.judges.length)
              }
              onClick={() => {
                if (
                  nextState !== "REVEAL" ||
                  confirm("Reveal all scores to the audience now?")
                )
                  void command("transition", { state: nextState }, act.id);
              }}
            >
              {nextState === "REVEAL" ? (
                <Eye size={20} />
              ) : (
                <ChevronRight size={20} />
              )}{" "}
              {
                (
                  {
                    PERFORMING: "Start performance",
                    JUDGING: "Open judge scoring",
                    REVEAL: "Reveal the scores",
                    COMPLETED: "Complete this act",
                  } as Record<string, string>
                )[nextState]
              }
            </button>
          ) : (
            <button
              className="primary big-button"
              disabled={!next || event.phase !== "LIVE"}
              onClick={() =>
                next && command("transition", { state: "ON_STAGE" }, next.id)
              }
            >
              <Mic2 size={20} />{" "}
              {next ? "Bring on " + next.name : "No ready performer"}
            </button>
          )}
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void command("timer", { seconds });
            }}
          >
            <label>
              Timer (seconds)
              <input
                type="number"
                value={seconds}
                onChange={(e) => setSeconds(Number(e.target.value))}
                min={1}
                max={3600}
                required
              />
            </label>
            <button disabled={event.phase !== "LIVE"}>Start timer</button>
            <button
              type="button"
              disabled={event.phase !== "LIVE"}
              onClick={() => command("timer", { seconds: 0 })}
            >
              Clear
            </button>
          </form>
          <button
            disabled={event.phase !== "LIVE"}
            onClick={() => command("voting", { open: !event.voting_open })}
          >
            <Trophy size={16} /> {event.voting_open ? "Close" : "Open"} Audience
            Choice voting
          </button>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>
            <Megaphone size={18} /> Announcement
          </h2>
        </div>
        <form
          className="pad form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void command("announcement", { text: announcement });
          }}
        >
          <label>
            Visible to the audience and stage display
            <textarea
              rows={4}
              maxLength={300}
              value={announcement}
              onChange={(e) => setAnnouncement(e.target.value)}
              placeholder="A short update for everyone in the room."
            />
          </label>
          <div className="button-group">
            <button className="primary" disabled={event.phase === "ENDED"}>
              Publish announcement
            </button>
            <button
              type="button"
              disabled={event.phase === "ENDED"}
              onClick={async () => {
                if (await command("announcement", { text: "" }))
                  setAnnouncement("");
              }}
            >
              Clear
            </button>
          </div>
          <a href="#display" className="text-link">
            Open stage display <ArrowUpRight size={16} />
          </a>
        </form>
      </section>
    </div>
  );
}

function Results({ event, canExport }: { event: Event; canExport: boolean }) {
  const ranked = event.participants
    .filter((p) => p.result)
    .sort(
      (a, b) =>
        b.result!.average - a.result!.average || a.position - b.position,
    );
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          <Trophy size={18} /> Judge ranking
        </h2>
        <div className="button-group">
          {canExport && (
            <a className="button" href="/api/export.csv">
              <Download size={15} /> CSV
            </a>
          )}
          {canExport && (
            <a className="button" href="/api/report.pdf">
              <Download size={15} /> Download PDF
            </a>
          )}
          <button onClick={() => window.print()}>
            <Download size={15} /> Print / PDF
          </button>
        </div>
      </div>
      <p className="pad muted">
        Ranked by judge average. Equal averages share a rank. Latent match is a
        separate result; Audience Choice never affects this table.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Performer</th>
              <th>Judge average</th>
              <th>Self-score</th>
              <th>Difference</th>
              <th>Latent match</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((p) => (
              <tr key={p.id}>
                <td className="rank">
                  {ranked.findIndex(
                    (x) => x.result!.average === p.result!.average,
                  ) + 1}
                </td>
                <td>
                  <strong>{p.name}</strong>
                  <small>{p.category}</small>
                </td>
                <td className="mono lime-text">{fmt(p.result!.average)}</td>
                <td className="mono">{p.result!.self_score}</td>
                <td className="mono">{fmt(p.result!.difference)}</td>
                <td>
                  <Badge tone={p.result!.match ? "lime" : ""}>
                    {p.result!.match ? "Match" : "No match"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!ranked.length && (
        <Empty title="The suspense stays on stage.">
          Results appear here only after the controller reveals an act.
        </Empty>
      )}
      {event.audience_results && (
        <div className="pad">
          <h2>Audience Choice · Final votes</h2>
          {event.participants
            .filter((p) => p.state === "COMPLETED")
            .sort(
              (a, b) =>
                (event.audience_results![b.id] || 0) -
                (event.audience_results![a.id] || 0),
            )
            .map((p) => (
              <div className="audience-result" key={p.id}>
                <strong>{p.name}</strong>
                <span>{event.audience_results![p.id] || 0} votes</span>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}

function Settings({
  event,
  command,
  user,
}: {
  event: Event;
  command: Command;
  user: User;
}) {
  const [accounts, setAccounts] = useState<
      (User & { username: string; disabled: boolean })[]
    >([]),
    [error, setError] = useState(""),
    [rules, setRules] = useState<Rules>(event.rules),
    [judges, setJudges] = useState<number[]>(event.judges),
    [notice, setNotice] = useState(""),
    [saving, setSaving] = useState(false);
  const load = useCallback(
    () =>
      api<(User & { username: string; disabled: boolean })[]>("/users")
        .then(setAccounts)
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const locked =
    event.phase !== "DRAFT" || event.participants.some((p) => p.self_locked);
  return (
    <div className="control-grid">
      <section className="panel">
        <div className="panel-head">
          <h2>Scoring & panel</h2>
          <Badge>{locked ? "Locked" : "Draft"}</Badge>
        </div>
        <form
          className="pad form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void command("settings", { rules, judges });
          }}
        >
          <fieldset disabled={locked} className="form-stack">
            <div className="form-grid">
              {(["minimum", "maximum", "step"] as const).map((k) => (
                <label key={k}>
                  {pretty(k)}
                  <input
                    type="number"
                    value={rules[k]}
                    min={k === "step" ? 0.1 : 0}
                    max={100}
                    step={0.1}
                    onChange={(e) =>
                      setRules({ ...rules, [k]: Number(e.target.value) })
                    }
                  />
                </label>
              ))}
            </div>
            <label>
              Matching mode
              <select
                value={rules.mode}
                onChange={(e) => setRules({ ...rules, mode: e.target.value })}
              >
                <option value="exact">Exact average</option>
                <option value="nearest">Nearest integer (half up)</option>
                <option value="quarter">Within ±0.25</option>
                <option value="half">Within ±0.50</option>
              </select>
            </label>
            <div>
              <span className="field-title">Assigned judges</span>
              {accounts
                .filter((u) => u.role === "judge")
                .map((u) => (
                  <label className="checkbox-row" key={u.id}>
                    <input
                      type="checkbox"
                      checked={judges.includes(u.id)}
                      onChange={(e) =>
                        setJudges(
                          e.target.checked
                            ? [...judges, u.id]
                            : judges.filter((j) => j !== u.id),
                        )
                      }
                    />
                    {u.name}
                  </label>
                ))}
              {!accounts.some((u) => u.role === "judge") && (
                <p className="muted">
                  Create judge accounts, then assign the panel here.
                </p>
              )}
            </div>
            <button className="primary">Save rules & panel</button>
          </fieldset>
          <p className="muted">
            Rules lock at the first sealed self-score or when the event goes
            live. Scores default to whole numbers from 1 to 10.
          </p>
        </form>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Issue an account</h2>
        </div>
        <form
          className="pad form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            setError("");
            setNotice("");
            const form = e.currentTarget;
            try {
              await api("/users", Object.fromEntries(new FormData(form)));
              form.reset();
              setNotice("Account created. Share credentials privately.");
              await load();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          <label>
            Display name
            <input name="name" required maxLength={100} />
          </label>
          <label>
            Username
            <input name="username" required maxLength={80} autoComplete="off" />
          </label>
          <label>
            Initial password
            <input
              name="password"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
            />
          </label>
          <label>
            Role
            <select name="role">
              {[
                "judge",
                "controller",
                "backstage",
                "host",
                "audience",
                ...(user.role === "super_admin"
                  ? ["event_admin", "super_admin"]
                  : []),
              ].map((r) => (
                <option key={r} value={r}>
                  {pretty(r)}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="lime-text">
              {notice}
            </p>
          )}
          <button disabled={saving} className="primary">
            <Plus size={16} /> Create account
          </button>
        </form>
      </section>
      <AccountTools accounts={accounts} user={user} refresh={load} />
      <EventRecovery event={event} accounts={accounts} command={command} />
      <section className="panel wide">
        <div className="panel-head">
          <h2>Event accounts</h2>
          <Badge>{accounts.length}</Badge>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td className="mono">{u.username}</td>
                  <td>
                    <Badge>{u.disabled ? "Disabled" : pretty(u.role)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
function Audit({ revision }: { revision: number }) {
  const [rows, setRows] = useState<
      {
        id: number;
        actor: string;
        action: string;
        detail: string;
        created: number;
      }[]
    >([]),
    [error, setError] = useState("");
  useEffect(() => {
    api<typeof rows>("/audit")
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [revision]);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Activity log</h2>
        <span className="micro">LATEST 300 ACTIONS</span>
      </div>
      {error && <p className="error-text pad">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Reference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.created * 1000).toLocaleString()}</td>
                <td>{r.actor}</td>
                <td>{pretty(r.action)}</td>
                <td className="audit-detail">{r.detail || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
