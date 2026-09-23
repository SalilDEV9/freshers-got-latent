import { createPublicKey } from "node:crypto";
export async function GET() {
  const configured = JSON.parse(process.env.FGL_VERIFY_KEYS_JSON || "{}");
  const keys = Object.fromEntries(
    Object.entries(configured).map(([id, pem]) => [
      id,
      createPublicKey(String(pem)).export({ type: "spki", format: "pem" }),
    ]),
  );
  return Response.json(
    { keys, event_id: process.env.FGL_EVENT_ID },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
