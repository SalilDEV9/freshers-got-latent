// Bound ZIP expansion before ExcelJS parses an XLSX. Reject ZIP64 and encrypted files.
export function checkWorkbookArchive(b) {
  if (b.length > 1_000_000 || b.length < 22)
    throw new Error("Invalid XLSX size");
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--)
    if (b.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0 || b.readUInt16LE(end + 4) || b.readUInt16LE(end + 6))
    throw new Error("Unsupported XLSX archive");
  const count = b.readUInt16LE(end + 10),
    directorySize = b.readUInt32LE(end + 12);
  let offset = b.readUInt32LE(end + 16),
    total = 0;
  if (count > 200 || count === 65535 || offset + directorySize > end)
    throw new Error("Workbook archive limits exceeded");
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || b.readUInt32LE(offset) !== 0x02014b50)
      throw new Error("Invalid workbook archive directory");
    const flags = b.readUInt16LE(offset + 8),
      size = b.readUInt32LE(offset + 24),
      packed = b.readUInt32LE(offset + 20);
    total += size;
    if (
      flags & 1 ||
      size === 0xffffffff ||
      total > 8_000_000 ||
      size > Math.max(100_000, packed * 100)
    )
      throw new Error("Workbook expansion limits exceeded");
    offset +=
      46 +
      b.readUInt16LE(offset + 28) +
      b.readUInt16LE(offset + 30) +
      b.readUInt16LE(offset + 32);
    if (offset > end) throw new Error("Invalid workbook archive");
  }
}
