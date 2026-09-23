import { Login } from "@/components/Common";
export default function Home() {
  return (
    <main>
      <section className="hero">
        <div className="eyebrow">MindQuest presents · Freshers 2026</div>
        <h1>
          The spotlight
          <br />
          is yours.
        </h1>
        <p>
          A stage for the unexpected. Your event pass, live performances and
          audience vote, in one place.
        </p>
        <Login />
        <p className="muted">
          Use the Google email from your approved registration.
        </p>
      </section>
      <div className="grid">
        <section className="card">
          <div className="eyebrow">01 / Before you arrive</div>
          <h2>Keep your pass ready.</h2>
          <p>
            Your QR becomes available after registration and payment approval.
            Bring your institute ID to the gate.
          </p>
        </section>
        <section className="card">
          <div className="eyebrow">02 / Inside the event</div>
          <h2>Make your vote count.</h2>
          <p>
            Check in once. Follow the stage live. Rate each performance when
            voting opens.
          </p>
        </section>
      </div>
      <div className="row">
        <a href="/dashboard/audience">Audience dashboard</a>
        <a href="/gate">Gate staff</a>
        <a href="/control">Event crew & judges</a>
        <a href="/admin">Administration</a>
      </div>
    </main>
  );
}
