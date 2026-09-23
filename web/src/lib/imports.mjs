export const fields = [
  "name",
  "email",
  "phone",
  "roll_number",
  "payment_reference",
  "payment_proof",
];
const aliases = {
  name: ["name", "full name", "student name"],
  email: ["email", "email address"],
  phone: ["phone", "phone number", "mobile number"],
  roll_number: ["roll number", "roll no", "roll no."],
  payment_reference: [
    "payment utr",
    "utr",
    "payment reference",
    "transaction id",
  ],
  payment_proof: ["payment screenshot", "payment proof"],
};
export function detectMapping(headers) {
  return Object.fromEntries(
    fields.map((f) => [
      f,
      headers.find((h) => aliases[f].includes(h.trim().toLowerCase())) || "",
    ]),
  );
}
export function parseCSV(text) {
  if (text.length > 2_000_000) throw new Error("File too large (2 MB maximum)");
  const rows = [];
  let row = [],
    cell = "",
    quoted = false,
    closed = false;
  text = text.replace(/^\ufeff/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
    } else if (c === '"') {
      if (cell || closed) throw new Error("Malformed CSV quotes");
      quoted = true;
    } else if (c === "," || c === "\n" || c === "\r") {
      row.push(cell);
      cell = "";
      closed = false;
      if (c !== ",") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else {
      if (closed) throw new Error("Unexpected character after quoted cell");
      cell += c;
    }
    if (rows.length > 2000 || row.length > 100 || cell.length > 10000)
      throw new Error("Spreadsheet limits exceeded");
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  row.push(cell);
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2)
    throw new Error("Include headers and at least one attendee");
  const headers = rows.shift().map((h) => h.trim());
  if (new Set(headers).size !== headers.length || headers.some((h) => !h))
    throw new Error("Headers must be unique and nonempty");
  return {
    headers,
    rows: rows.map((r, i) => {
      if (r.length !== headers.length)
        throw new Error(`Row ${i + 2}: wrong number of columns`);
      return Object.fromEntries(headers.map((h, j) => [h, r[j]]));
    }),
  };
}
export function normalize(row, mapping) {
  const out = Object.fromEntries(
    fields.map((f) => [
      f,
      String(row[mapping[f]] ?? "")
        .normalize("NFKC")
        .trim(),
    ]),
  );
  out.name = out.name.replace(/\s+/g, " ");
  out.email = out.email.toLowerCase();
  out.roll_number = out.roll_number.toUpperCase().replace(/\s/g, "");
  out.payment_reference = out.payment_reference.toUpperCase();
  if (out.phone) {
    let n = out.phone.replace(/[\s()+-]/g, "");
    if (/^\d{10}$/.test(n)) n = "91" + n;
    out.phone = "+" + n;
  }
  return out;
}
export function preview(rows, mapping, existing = []) {
  if (rows.length > 2000) throw new Error("Maximum 2,000 rows per batch");
  if (
    !["name", "email", "roll_number"].every(
      (f) => typeof mapping[f] === "string" && mapping[f],
    )
  )
    throw new Error("Map name, email and roll number");
  const items = rows.map((r, i) => ({
    row: i + 2,
    data: normalize(r, mapping),
    issues: [],
    status: "VALID",
  }));
  const counts = {};
  for (const f of ["email", "roll_number", "payment_reference"]) {
    counts[f] = new Map();
    for (const r of [...existing, ...items.map((x) => x.data)])
      if (r[f]) counts[f].set(r[f], (counts[f].get(r[f]) || 0) + 1);
  }
  for (const item of items) {
    const d = item.data;
    if (!d.name || !d.email || !d.roll_number) {
      item.status = "MISSING DATA";
      item.issues.push("Name, email and roll number are required");
    } else if (
      d.name.length > 100 ||
      d.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email) ||
      !/^[A-Z0-9-]{4,30}$/.test(d.roll_number) ||
      (d.phone && !/^\+[1-9]\d{7,14}$/.test(d.phone)) ||
      (d.payment_reference && !/^[A-Z0-9-]{6,64}$/.test(d.payment_reference)) ||
      (d.payment_proof &&
        (!/^https:\/\//.test(d.payment_proof) || d.payment_proof.length > 2000))
    ) {
      item.status = "INVALID";
      item.issues.push(
        "Invalid name, email, roll, phone, reference or HTTPS proof link",
      );
    }
    for (const f of ["email", "roll_number", "payment_reference"])
      if (d[f] && counts[f].get(d[f]) > 1) {
        item.status = "DUPLICATE";
        item.issues.push(`Duplicate ${f}`);
      }
    if (item.status === "VALID") {
      item.status = "PAYMENT REVIEW REQUIRED";
      item.issues.push(
        "Payment must be independently verified by an administrator",
      );
    }
    const sameName = [
      ...existing,
      ...items.filter((x) => x !== item).map((x) => x.data),
    ].some((r) => r.name.toLowerCase() === d.name.toLowerCase());
    if (sameName)
      item.issues.push("Same name as another row: compare strong identifiers");
  }
  return items;
}
export function safeCSV(rows) {
  return rows
    .map((row) =>
      row
        .map((x) => {
          let v = String(x ?? "");
          if (/^[\s]*[=+@-]/.test(v)) v = "'" + v;
          return '"' + v.replaceAll('"', '""') + '"';
        })
        .join(","),
    )
    .join("\r\n");
}
