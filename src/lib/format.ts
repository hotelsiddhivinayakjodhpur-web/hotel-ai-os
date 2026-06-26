/**
 * Shared formatting helpers. Centralised so every dashboard renders numbers,
 * currency, percentages and dates consistently (and so "—" is the single
 * canonical empty marker instead of ad-hoc null checks everywhere).
 */
export const EMPTY = "—";

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return EMPTY;
  return Math.round(n).toLocaleString("en-IN");
}

export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return EMPTY;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function fmtPct(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return EMPTY;
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function fmtPctValue(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EMPTY;
  return `${value.toFixed(digits)}%`;
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (!seconds || Number.isNaN(seconds)) return EMPTY;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** GA4 returns dates as "YYYYMMDD"; turn that into a real ISO date string. */
export function ga4DateToIso(yyyymmdd: string): string {
  if (/^\d{8}$/.test(yyyymmdd)) {
    return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
  }
  return yyyymmdd;
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

/** Strip the origin from a full URL so tables show just the path. */
export function stripOrigin(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, "") || "/";
}
