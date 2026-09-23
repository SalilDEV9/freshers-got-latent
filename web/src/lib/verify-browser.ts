function bytes(s: string) {
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
}
export async function verifyInBrowser(raw: string) {
  if (raw.length > 1200) throw new Error("Invalid QR format");
  const [prefix, body, signature, ...rest] = raw.split(".");
  if (prefix !== "FGL1" || rest.length || !body || !signature)
    throw new Error("Invalid QR format");
  const payload = JSON.parse(new TextDecoder().decode(bytes(body)));
  const response = await fetch("/api/keys");
  if (!response.ok) throw new Error("Verification keys unavailable");
  const { keys, event_id } = await response.json();
  if (
    payload.v !== 1 ||
    payload.event_id !== event_id ||
    !Object.hasOwn(keys, payload.key_id)
  )
    throw new Error("Wrong event or unknown signing key");
  const pem = keys[payload.key_id].replace(/-----[^-]+-----|\s/g, "");
  const key = await crypto.subtle.importKey(
    "spki",
    bytes(pem),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  if (
    !(await crypto.subtle.verify(
      "Ed25519",
      key,
      bytes(signature),
      new TextEncoder().encode(body),
    ))
  )
    throw new Error("Invalid QR signature");
}
