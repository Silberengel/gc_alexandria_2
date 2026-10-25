/** Display / wire format for kind-30040 `published_on` (imwald parity). */
const DD_MM_YYYY = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

function utcDate(y: number, m0: number, d: number): Date {
  return new Date(Date.UTC(y, m0, d));
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Format a UTC calendar day as `dd.mm.yyyy`. */
export function formatPublishedOn(date: Date): string {
  return `${pad2(date.getUTCDate())}.${pad2(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
}

/** `yyyy-mm-dd` for `<input type="date">`. */
export function toIsoDateValue(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** Parse `yyyy-mm-dd` from a date input into a UTC calendar day. */
export function fromIsoDateValue(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = utcDate(y, mo - 1, d);
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

/**
 * Parse free text: `dd.mm.yyyy`, or a bare year `YYYY` → Jan 1 of that year.
 * Returns null when unparseable.
 */
export function parsePublishedOn(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const dotted = DD_MM_YYYY.exec(trimmed);
  if (dotted) {
    const d = Number(dotted[1]);
    const mo = Number(dotted[2]);
    const y = Number(dotted[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const date = utcDate(y, mo - 1, d);
    if (
      date.getUTCFullYear() !== y ||
      date.getUTCMonth() !== mo - 1 ||
      date.getUTCDate() !== d
    ) {
      return null;
    }
    return date;
  }

  const year = Number(trimmed);
  if (Number.isInteger(year) && year >= 1 && year <= 9999 && String(year) === trimmed) {
    return utcDate(year, 0, 1);
  }

  return null;
}
