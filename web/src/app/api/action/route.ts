import { identity } from "@/lib/auth";
import { handle, staff } from "@/lib/entry";
import { db, eventId } from "@/lib/db";
import { parseCSV } from "@/lib/imports.mjs";
import { checkWorkbookArchive } from "@/lib/xlsx-limits.mjs";
import { eventAction } from "@/lib/event";
export const runtime = "nodejs";
export const maxDuration = 30;
const reply = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== process.env.APP_ORIGIN)
      return reply({ error: "Origin rejected" }, 403);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return reply({ error: "JSON required" }, 415);
    // Streaming limit prevents an unbounded JSON body, even without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: "Body required" }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 3_000_000) {
        await reader.cancel();
        return reply({ error: "Request too large" }, 413);
      }
      chunks.push(value);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const actor = await identity();
    if (data.action === "parse_file") {
      await staff(db(), eventId(), actor, ["event_admin", "super_admin"]);
      if (data.kind === "csv") return reply(parseCSV(data.content));
      if (data.kind !== "xlsx") throw new Error("Use CSV or XLSX");
      const { default: ExcelJS } = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      // Strict input cap; ExcelJS still needs resource limits at the hosting layer.
      const file = Buffer.from(data.content, "base64");
      if (file.length > 1_000_000) throw new Error("XLSX maximum is 1 MB");
      checkWorkbookArchive(file);
      await workbook.xlsx.load(file as any);
      const sheet = workbook.worksheets[0];
      if (!sheet || sheet.rowCount > 2001 || sheet.columnCount > 50)
        throw new Error("Maximum 2,000 rows and 50 columns");
      const cell = (v: any) => {
        if (v == null) return "";
        if (typeof v === "string" || typeof v === "number") return String(v);
        throw new Error(
          "Use plain values: formulas, links and rich cells are not accepted",
        );
      };
      const headers = Array.from({ length: sheet.columnCount }, (_, i) =>
        cell(sheet.getRow(1).getCell(i + 1).value).trim(),
      );
      if (headers.some((h) => !h) || new Set(headers).size !== headers.length)
        throw new Error("Headers must be unique and nonempty");
      const rows = [];
      for (let i = 2; i <= sheet.rowCount; i++)
        rows.push(
          Object.fromEntries(
            headers.map((h, j) => [
              h,
              cell(sheet.getRow(i).getCell(j + 1).value),
            ]),
          ),
        );
      return reply({ headers, rows });
    }
    if (data.action === "sheet_sync") {
      await staff(db(), eventId(), actor, ["event_admin", "super_admin"]);
      if (
        !/^[A-Za-z0-9_-]{20,100}$/.test(data.sheet_id) ||
        typeof data.range !== "string" ||
        data.range.length > 100
      )
        throw new Error("Invalid sheet ID or range");
      if (!process.env.GOOGLE_SHEETS_ACCESS_TOKEN)
        throw new Error(
          "Google Sheets read-only OAuth token is not configured",
        );
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${data.sheet_id}/values/${encodeURIComponent(data.range)}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.GOOGLE_SHEETS_ACCESS_TOKEN}`,
          },
          signal: AbortSignal.timeout(10000),
          cache: "no-store",
        },
      );
      if (!res.ok)
        throw new Error("Sheet access failed; check sharing and OAuth token");
      const { values = [] } = await res.json();
      if (values.length < 2 || values.length > 2001)
        throw new Error("Sheet must contain 1–2,000 attendee rows");
      const headers = values[0].map(String);
      if (
        headers.length > 50 ||
        new Set(headers).size !== headers.length ||
        headers.some((h: string) => !h.trim())
      )
        throw new Error("Invalid headers");
      return reply({
        headers,
        rows: values
          .slice(1)
          .map((row: any[]) =>
            Object.fromEntries(
              headers.map((h: string, i: number) => [h, String(row[i] ?? "")]),
            ),
          ),
      });
    }
    const result = data.action?.startsWith("event_")
      ? await eventAction(data.action, data, actor)
      : await handle(data.action, data, actor);
    return reply(result, result?.error ? 429 : 200);
  } catch (error: any) {
    if (error?.code === "23505")
      return reply(
        {
          error:
            "Duplicate record. Reload; this operation may already be completed.",
        },
        409,
      );
    if (error?.code)
      return reply(
        {
          error: "Database operation failed. No partial change was committed.",
        },
        400,
      );
    const message = error instanceof Error ? error.message : "Request failed";
    // Only known application errors; infrastructure messages must not disclose credentials.
    if (
      /password|connect|ECONN|ENOTFOUND|fetch failed|Invalid URL/i.test(message)
    )
      return reply(
        { error: "Service configuration or connection unavailable" },
        503,
      );
    return reply({ error: message }, message === "Forbidden" ? 403 : 400);
  }
}
