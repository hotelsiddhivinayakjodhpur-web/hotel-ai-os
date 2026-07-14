/**
 * Reusable booking-report parser — Stayflexi Master Report (CSV) and
 * unifiedBookingReport (XLSX). Normalizes rows to a common shape keyed on
 * Booking Id, so the daily append pipeline and the historical import share one
 * parser (no duplication).
 *
 * `parseBookingBuffer(filename, buf)` is the single entry point: it auto-detects
 * CSV vs XLSX (by magic bytes / extension), extracts the rows, and returns the
 * SAME NormalizedBooking[] for both formats. XLSX is read with a small
 * dependency-free reader built on Node's `zlib` (an .xlsx is a ZIP of XML) — no
 * external library, no second parser. This module owns FIELD normalization,
 * report-type detection, and row extraction.
 *
 * Never fabricates values — missing/NA cells become null.
 */
import zlib from "node:zlib";
export interface NormalizedBooking {
  bookingId: string;
  roomNo: string | null;
  otaBookingId: string | null;
  bookingDate: string | null; // YYYY-MM-DD
  source: string | null;
  segment: string | null;
  status: string | null;
  guest: string | null;
  adults: number | null;
  children: number | null;
  rooms: number | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  roomNights: number | null;
  roomTypes: string | null;
  ratePlans: string | null;
  taxAmount: number | null;
  totalAmount: number | null;
  paymentMade: number | null;
  balanceDue: number | null;
  roomRevenue: number | null;
  otaCommission: number | null;
  customerPhone: string | null;
  customerEmail: string | null;
  customerCity: string | null;
  customerState: string | null;
  customerCountry: string | null;
}

export type BookingReportType = "MASTER_CSV" | "UNIFIED_XLSX" | "UNKNOWN";

/** Detect the report type from the header row's columns. */
export function detectReportType(headers: string[]): BookingReportType {
  const h = headers.map((x) => (x ?? "").toString().trim().toLowerCase());
  if (h.includes("cumulative room revenue (inr)") || h.includes("customer phone")) return "UNIFIED_XLSX";
  if (h.includes("booking id") && h.includes("total amount") && h.includes("balance due")) return "MASTER_CSV";
  return "UNKNOWN";
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/,/g, "").trim();
  if (s === "" || s === "NA" || s === "None") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "3,2" (per-room) → 5; "2.0" → 2. */
export function intSum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "" || s === "NA" || s === "None") return null;
  if (s.includes(",")) {
    const parts = s.split(",").map((x) => Number(x.trim())).filter((x) => Number.isFinite(x));
    return parts.length ? parts.reduce((a, b) => a + Math.trunc(b), 0) : null;
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** "DD/MM/YYYY" → "YYYY-MM-DD". */
export function dateDMY(v: unknown): string | null {
  if (!v) return null;
  const m = String(v).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** "Jul 13 2026" (single/double space) → "YYYY-MM-DD". */
export function dateMon(v: unknown): string | null {
  if (!v) return null;
  const m = String(v).replace(/\s+/g, " ").trim().match(/^([A-Za-z]{3}) (\d{1,2}) (\d{4})/);
  if (!m) return null;
  const mm = MONTHS[m[1]!.toLowerCase()];
  return mm ? `${m[3]}-${String(mm).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}` : null;
}

/** Parse a Master Report CSV row (skips the trailing Total row). */
export function parseMasterCsvRow(r: string[]): NormalizedBooking | null {
  const bid = (r[0] ?? "").trim();
  if (!/^\d+$/.test(bid)) return null;
  return {
    bookingId: bid, roomNo: r[1] || null, otaBookingId: null, bookingDate: dateMon(r[2]),
    source: r[3] || null, segment: null, status: r[4] || null, guest: r[5] || null,
    adults: intSum(r[6]), children: null, rooms: intSum(r[7]),
    checkInDate: dateMon(r[8]), checkOutDate: dateMon(r[9]), roomNights: null,
    roomTypes: (r[10] ?? "").trim() || null, ratePlans: (r[11] ?? "").trim() || null,
    taxAmount: null, totalAmount: num(r[12]), paymentMade: num(r[13]), balanceDue: num(r[14]),
    roomRevenue: null, otaCommission: null, customerPhone: null, customerEmail: null,
    customerCity: null, customerState: null, customerCountry: null,
  };
}

/** Parse a unifiedBookingReport XLSX row (values already extracted, in column order). */
export function parseUnifiedRow(r: (string | number | null)[]): NormalizedBooking | null {
  const bid = r[0] == null ? "" : String(r[0]).trim();
  if (!/^\d+$/.test(bid)) return null;
  const str = (v: unknown) => (v == null ? null : String(v).trim() || null);
  return {
    bookingId: bid, roomNo: str(r[1]), otaBookingId: str(r[2]), bookingDate: dateDMY(r[3]),
    source: str(r[5]), segment: str(r[6]), status: str(r[7]), guest: str(r[8]),
    adults: intSum(r[9]), children: intSum(r[10]), rooms: intSum(r[11]),
    checkInDate: dateDMY(r[12]), checkOutDate: dateDMY(r[14]), roomNights: intSum(r[17]),
    roomTypes: str(r[18]), ratePlans: str(r[19]), taxAmount: num(r[20]), totalAmount: num(r[22]),
    otaCommission: num(r[23]), paymentMade: num(r[24]), balanceDue: num(r[25]), roomRevenue: num(r[26]),
    customerEmail: str(r[29]), customerPhone: str(r[33]), customerCity: str(r[36]),
    customerState: str(r[38]), customerCountry: str(r[39]),
  };
}

// --------------------------------------------------------------------------
// Row extraction — CSV tokeniser + dependency-free XLSX reader (zlib only).
// --------------------------------------------------------------------------

/** Minimal RFC-4180 CSV tokeniser (handles quoted commas and "" escapes). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Read the entries of a ZIP archive (stored + deflate) using the central directory. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a valid XLSX (no ZIP end-of-central-directory).");
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const name = buf.toString("utf8", ptr + 46, ptr + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    if (method === 0) files.set(name, Buffer.from(comp));
    else if (method === 8) files.set(name, zlib.inflateRawSync(comp));
    else throw new Error(`Unsupported ZIP compression method ${method}.`);
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function xmlDecode(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const tre = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let t: RegExpExecArray | null;
    let s = "";
    while ((t = tre.exec(m[1]!))) s += t[1];
    out.push(xmlDecode(s));
  }
  return out;
}

/** "AB12" → zero-based column index (0). */
function colIndex(ref: string): number {
  const m = ref.match(/^([A-Z]+)/);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]!) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Extract a sheet's cells into a dense row/column matrix (null for gaps). */
function sheetMatrix(xml: string, sst: string[]): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [];
  const rre = /<row[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm: RegExpExecArray | null;
  while ((rm = rre.exec(xml))) {
    const body = rm[1];
    if (!body) { rows.push([]); continue; }
    const cells: (string | number | null)[] = [];
    const cre = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cre.exec(body))) {
      const attrs = cm[1]!;
      const inner = cm[2] ?? "";
      const refM = attrs.match(/r="([A-Z]+\d+)"/);
      const ci = refM ? colIndex(refM[1]!) : cells.length;
      const tM = attrs.match(/t="([^"]+)"/);
      const t = tM ? tM[1] : "n";
      let val: string | number | null = null;
      if (t === "inlineStr") {
        const im = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        val = im ? xmlDecode(im[1]!) : null;
      } else {
        const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
        const raw = vm ? vm[1]! : null;
        if (raw == null) val = null;
        else if (t === "s") val = sst[parseInt(raw, 10)] ?? null;
        else if (t === "str" || t === "b") val = xmlDecode(raw);
        else { const n = Number(raw); val = Number.isFinite(n) ? n : xmlDecode(raw); }
      }
      cells[ci] = val;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = null;
    rows.push(cells);
  }
  return rows;
}

/** Read the first worksheet of an .xlsx buffer into a row/column matrix. */
export function extractXlsxMatrix(buf: Buffer): (string | number | null)[][] {
  const files = unzip(buf);
  const sst = sharedStrings(files.get("xl/sharedStrings.xml")?.toString("utf8"));
  const sheetName = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheetName) throw new Error("XLSX has no worksheet.");
  return sheetMatrix(files.get(sheetName)!.toString("utf8"), sst);
}

export interface ParsedBookingFile {
  type: BookingReportType;
  format: "CSV" | "XLSX";
  bookings: NormalizedBooking[];
  dataRows: number; // non-empty rows considered (header excluded)
  summaryRows: number; // data rows that yielded no booking (e.g. a Total row)
  error?: string;
}

/**
 * Single entry point — auto-detects CSV vs XLSX and returns the SAME
 * NormalizedBooking[] for both. Detection, field mapping, validation-friendly
 * counts, and dedup key (Booking Id) are all shared; callers never branch on
 * file type.
 */
export function parseBookingBuffer(filename: string, buf: Buffer): ParsedBookingFile {
  const isZip = buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b; // "PK" magic
  const isXlsx = isZip || /\.xlsx?$/i.test(filename);

  if (isXlsx) {
    let matrix: (string | number | null)[][];
    try {
      matrix = extractXlsxMatrix(buf);
    } catch (e) {
      return { type: "UNKNOWN", format: "XLSX", bookings: [], dataRows: 0, summaryRows: 0, error: e instanceof Error ? e.message : String(e) };
    }
    if (matrix.length < 2) {
      return { type: "UNKNOWN", format: "XLSX", bookings: [], dataRows: Math.max(0, matrix.length - 1), summaryRows: 0, error: "Empty or header-only worksheet." };
    }
    const headers = (matrix[0] ?? []).map((x) => (x == null ? "" : String(x)));
    const type = detectReportType(headers);
    const rows = matrix.slice(1).filter((r) => r.some((c) => c != null && String(c).trim() !== ""));
    const bookings: NormalizedBooking[] = [];
    for (const r of rows) {
      const b = type === "UNIFIED_XLSX" ? parseUnifiedRow(r) : type === "MASTER_CSV" ? parseMasterCsvRow(r.map((x) => (x == null ? "" : String(x)))) : null;
      if (b) bookings.push(b);
    }
    return { type, format: "XLSX", bookings, dataRows: rows.length, summaryRows: rows.length - bookings.length };
  }

  // CSV path
  const text = buf.toString("utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { type: "UNKNOWN", format: "CSV", bookings: [], dataRows: Math.max(0, lines.length - 1), summaryRows: 0, error: "Empty or header-only CSV." };
  }
  const headers = splitCsvLine(lines[0]!);
  const type = detectReportType(headers);
  const bookings: NormalizedBooking[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!);
    const b = type === "MASTER_CSV" ? parseMasterCsvRow(cells) : type === "UNIFIED_XLSX" ? parseUnifiedRow(cells) : null;
    if (b) bookings.push(b);
  }
  const dataRows = lines.length - 1;
  return { type, format: "CSV", bookings, dataRows, summaryRows: dataRows - bookings.length };
}
