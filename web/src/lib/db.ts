import "server-only";
import postgres from "postgres";
let client: ReturnType<typeof postgres> | undefined;
export function db() {
  if (!process.env.DATABASE_URL)
    throw new Error("Database configuration missing");
  return (client ??= postgres(process.env.DATABASE_URL, {
    max: 3,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: process.env.NODE_ENV === "production" ? "require" : undefined,
  }));
}
export function eventId() {
  const e = process.env.FGL_EVENT_ID;
  if (!e || !/^[0-9a-f-]{36}$/i.test(e))
    throw new Error("Event configuration missing");
  return e;
}
