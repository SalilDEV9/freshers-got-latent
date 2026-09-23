import {
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
} from "node:crypto";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function ticketPayload(ticket) {
  return {
    v: 1,
    event_id: ticket.event_id,
    ticket_id: ticket.id,
    nonce: ticket.nonce,
    issued_at: Number(ticket.issued_at),
    key_id: ticket.key_id,
  };
}
export function makeNonce() {
  return randomBytes(32).toString("base64url");
}
export function signTicket(ticket, pem) {
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ed25519")
    throw new Error("Ed25519 signing key required");
  const body = Buffer.from(JSON.stringify(ticketPayload(ticket))).toString(
    "base64url",
  );
  return `FGL1.${body}.${sign(null, Buffer.from(body), key).toString("base64url")}`;
}
export function verifyTicket(raw, keys, eventId, now = Date.now()) {
  if (typeof raw !== "string" || raw.length > 1200)
    throw new Error("Invalid QR format");
  const parts = raw.split(".");
  if (
    parts.length !== 3 ||
    parts[0] !== "FGL1" ||
    !parts.slice(1).every((p) => /^[A-Za-z0-9_-]+$/.test(p))
  )
    throw new Error("Invalid QR format");
  const p = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  if (
    !p ||
    Object.keys(p).sort().join(",") !==
      "event_id,issued_at,key_id,nonce,ticket_id,v" ||
    p.v !== 1 ||
    p.event_id !== eventId ||
    !uuid.test(p.ticket_id) ||
    !uuid.test(p.event_id) ||
    typeof p.nonce !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(p.nonce) ||
    !Number.isSafeInteger(p.issued_at) ||
    p.issued_at < 0 ||
    p.issued_at > Math.floor(now / 1000) + 60 ||
    typeof p.key_id !== "string" ||
    !Object.hasOwn(keys, p.key_id)
  )
    throw new Error("Invalid ticket payload");
  const key = createPublicKey(keys[p.key_id]);
  if (
    key.asymmetricKeyType !== "ed25519" ||
    !verify(
      null,
      Buffer.from(parts[1]),
      key,
      Buffer.from(parts[2], "base64url"),
    )
  )
    throw new Error("Invalid ticket signature");
  return p;
}
