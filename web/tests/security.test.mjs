import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { signTicket, verifyTicket, makeNonce } from "../src/lib/tickets.mjs";
import {
  parseCSV,
  preview,
  detectMapping,
  safeCSV,
} from "../src/lib/imports.mjs";
import { checkWorkbookArchive } from "../src/lib/xlsx-limits.mjs";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const pem = privateKey.export({ type: "pkcs8", format: "pem" }),
  keys = { k: publicKey.export({ type: "spki", format: "pem" }) };
const ticket = {
  id: randomUUID(),
  event_id: randomUUID(),
  nonce: makeNonce(),
  key_id: "k",
  issued_at: Math.floor(Date.now() / 1000),
};
test("signed QR round trip contains only opaque claims", () => {
  const qr = signTicket(ticket, pem),
    p = verifyTicket(qr, keys, ticket.event_id);
  assert.equal(p.ticket_id, ticket.id);
  assert.deepEqual(
    Object.keys(p).sort(),
    ["v", "event_id", "ticket_id", "nonce", "issued_at", "key_id"].sort(),
  );
});
test("tampering, wrong event, unknown key and malformed input are rejected", () => {
  const qr = signTicket(ticket, pem);
  assert.throws(() => verifyTicket(qr, keys, randomUUID()));
  assert.throws(() => verifyTicket(qr, {}, ticket.event_id));
  const parts = qr.split(".");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url"));
  payload.ticket_id = randomUUID();
  parts[1] = Buffer.from(JSON.stringify(payload)).toString("base64url");
  assert.throws(() => verifyTicket(parts.join("."), keys, ticket.event_id));
  for (const raw of ["ticket=123", "", null, "FGL1.a.a", "x".repeat(1201)])
    assert.throws(() => verifyTicket(raw, keys, ticket.event_id));
});
test("future issuance and non-Ed25519 keys rejected", () => {
  assert.throws(() =>
    verifyTicket(
      signTicket({ ...ticket, issued_at: ticket.issued_at + 3600 }, pem),
      keys,
      ticket.event_id,
    ),
  );
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  assert.throws(() =>
    signTicket(ticket, rsa.privateKey.export({ type: "pkcs8", format: "pem" })),
  );
});
test("CSV supports quoted commas, escaped quotes, CRLF, BOM", () => {
  const result = parseCSV(
    '\ufeffName,Email,Roll Number\r\n"Kumar, Rahul",R@EXAMPLE.COM,2026bcs01\r\n',
  );
  assert.equal(result.rows[0].Name, "Kumar, Rahul");
  assert.equal(detectMapping(result.headers).roll_number, "Roll Number");
  assert.throws(() => parseCSV("A,A\n1,2"));
  assert.throws(() => parseCSV('A,B\n"broken,2'));
});
test("normalization and all duplicate members are flagged; names alone not rejected", () => {
  const mapping = {
    name: "n",
    email: "e",
    roll_number: "r",
    phone: "p",
    payment_reference: "u",
  };
  const rows = [
    {
      n: " Rahul  Kumar ",
      e: "USER@EXAMPLE.COM",
      r: "2026bcs01",
      p: "9876543210",
      u: "12345678",
    },
    { n: "rahul kumar", e: "user@example.com", r: "2026bcs02", u: "87654321" },
  ];
  const p = preview(rows, mapping);
  assert.equal(p[0].data.phone, "+919876543210");
  assert.equal(p[0].data.roll_number, "2026BCS01");
  assert.ok(p.every((r) => r.status === "DUPLICATE"));
  rows[1].e = "other@example.com";
  const q = preview(rows, mapping);
  assert.ok(q.every((r) => r.status === "PAYMENT REVIEW REQUIRED"));
  assert.ok(q[1].issues.some((x) => x.startsWith("Same name")));
});
test("duplicate UTR against existing database row and invalid email are rejected", () => {
  const m = { name: "n", email: "e", roll_number: "r", payment_reference: "u" };
  assert.equal(
    preview([{ n: "A", e: "a@example.com", r: "ABCD", u: "12345678" }], m, [
      {
        name: "B",
        email: "b@example.com",
        roll_number: "EFGH",
        payment_reference: "12345678",
      },
    ])[0].status,
    "DUPLICATE",
  );
  assert.equal(
    preview([{ n: "A", e: "bad", r: "ABCD" }], m)[0].status,
    "INVALID",
  );
});
test("CSV exports neutralize spreadsheet formulas", () => {
  assert.match(safeCSV([["=cmd()", "+9198", "normal"]]), /"'=cmd\(\)"/);
});
test("invalid workbook rejected before parser", () => {
  assert.throws(() => checkWorkbookArchive(Buffer.from("not a zip")));
});
test("XLSX simple workbook round trip remains compatible with UUID override", async () => {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Registrations");
  sheet.addRow(["Name", "Email", "Roll Number"]);
  sheet.addRow(["Rahul", "rahul@example.com", "2026BCS01"]);
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  checkWorkbookArchive(bytes);
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(bytes);
  assert.equal(loaded.worksheets[0].getRow(2).getCell(1).value, "Rahul");
});
