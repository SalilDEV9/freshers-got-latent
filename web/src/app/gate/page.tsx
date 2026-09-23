"use client";
import { useEffect, useRef, useState } from "react";
import { verifyInBrowser } from "@/lib/verify-browser";
import { action } from "@/lib/browser";
import { Login, Logout } from "@/components/Common";
export default function Gate() {
  const [gates, setGates] = useState<any[]>([]),
    [device, setDevice] = useState(""),
    [qr, setQr] = useState(""),
    [result, setResult] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [camera, setCamera] = useState(false);
  const video = useRef<HTMLVideoElement>(null),
    stop = useRef<(() => void) | null>(null),
    locked = useRef(false);
  useEffect(() => {
    action("gates")
      .then((g) => {
        setGates(g);
        setDevice(g[0]?.id || "");
      })
      .catch((e) => setError(e.message));
    return () => stop.current?.();
  }, []);
  async function scan(raw: string) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setResult(null);
    setConfirmed(false);
    setError("");
    stop.current?.();
    setCamera(false);
    setQr(raw);
    try {
      try {
        await verifyInBrowser(raw);
      } catch {
        /* Server independently verifies and records the rejected attempt; browser compatibility cannot authorize entry. */
      }
      setResult(await action("scan", { qr: raw, device_id: device }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
      locked.current = false;
    }
  }
  async function start() {
    setError("");
    setCamera(true);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader();
      const controls = await reader.decodeFromVideoDevice(
        undefined,
        video.current!,
        (result) => {
          if (result && !locked.current) {
            stop.current?.();
            void scan(result.getText());
          }
        },
      );
      stop.current = () => controls.stop();
    } catch (e: any) {
      setError(
        "Camera unavailable. Allow camera access over HTTPS, or paste the QR payload below.",
      );
      setCamera(false);
    }
  }
  return (
    <main>
      <div className="row spread">
        <div>
          <div className="eyebrow">Authorized staff only</div>
          <h1>Gate control.</h1>
        </div>
        <Logout />
      </div>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      {!gates.length ? (
        <section className="card">
          <p>
            Sign in with your assigned staff account. An administrator must
            assign an active gate device.
          </p>
          <Login />
        </section>
      ) : (
        <>
          <label>
            Assigned gate
            <select
              value={device}
              onChange={(e) => {
                stop.current?.();
                setCamera(false);
                setDevice(e.target.value);
                setResult(null);
                setConfirmed(false);
              }}
            >
              {gates.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid">
            <section className="card">
              <video ref={video} hidden={!camera} playsInline muted />
              <div className="row">
                <button disabled={busy || camera} onClick={start}>
                  Start camera
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    stop.current?.();
                    setCamera(false);
                  }}
                >
                  Stop
                </button>
              </div>
              <details>
                <summary>Paste QR payload</summary>
                <label>
                  Signed QR text
                  <textarea
                    value={qr}
                    onChange={(e) => {
                      setQr(e.target.value);
                      setResult(null);
                      setConfirmed(false);
                    }}
                    maxLength={1200}
                  />
                </label>
                <button disabled={busy || !qr} onClick={() => scan(qr)}>
                  Verify pass
                </button>
              </details>
            </section>
            <section className="card" aria-live="polite">
              {!result ? (
                <>
                  <h2>Ready to scan</h2>
                  <p>
                    Verify the institute ID before confirming entry. A scan
                    alone does not admit an attendee.
                  </p>
                </>
              ) : (
                <>
                  <span className="badge">{result.reason}</span>
                  <h2>
                    {result.name ||
                      (result.allowed ? "Entry granted" : "Entry denied")}
                  </h2>
                  <p>{result.roll_number}</p>
                  {result.first_entry && (
                    <p>
                      First entry:{" "}
                      {new Date(result.first_entry).toLocaleString()}
                      <br />
                      Gate: {result.gate_id}
                    </p>
                  )}
                  {result.valid && (
                    <>
                      <label>
                        <input
                          type="checkbox"
                          checked={confirmed}
                          onChange={(e) => setConfirmed(e.target.checked)}
                        />
                        I compared the attendee’s name and roll number with
                        their institute ID.
                      </label>
                      <button
                        disabled={!confirmed || busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            setResult(
                              await action("redeem", {
                                qr,
                                device_id: device,
                                identity_confirmed: confirmed,
                              }),
                            );
                            setQr("");
                          } catch (e: any) {
                            setError(e.message);
                            setResult(null);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Confirm entry
                      </button>
                    </>
                  )}
                  {result.allowed && (
                    <p>Check-in is recorded. This pass cannot be used again.</p>
                  )}
                </>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
