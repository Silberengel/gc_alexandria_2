import { tagValueType } from '@silberengel/kind-compose-catalog';
import type { FieldDef } from '@silberengel/kind-compose-catalog';

const UNIX_TAG_HINTS = new Set([
  'expiration',
  'published_at',
  'since',
  'until',
  'start',
  'end',
  'starts',
  'ends'
]);

/** Parse a wire value that is already unix seconds (optionally with decimals). */
export function parseUnixSeconds(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/** Format unix seconds for `<input type="datetime-local">` in the local zone. */
export function unixToDatetimeLocal(unix: number): string {
  const d = new Date(unix * 1000);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Parse `YYYY-MM-DDTHH:mm` (datetime-local) as local time → unix seconds.
 */
export function datetimeLocalToUnix(isoLocal: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(isoLocal.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6] ?? '0');
  const date = new Date(y, mo - 1, d, h, mi, s, 0);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d ||
    date.getHours() !== h ||
    date.getMinutes() !== mi
  ) {
    return null;
  }
  return Math.floor(date.getTime() / 1000);
}

/** True when this compose field stores a unix timestamp (seconds). */
export function isUnixTimestampField(field: FieldDef, kind: number): boolean {
  // NIP-52 date-based calendar uses ISO calendar days (YYYY-MM-DD), not unix.
  if (kind === 31922) {
    const tag = field.tag ?? field.produces?.[0] ?? field.id;
    if (tag === 'start' || tag === 'end' || field.id === 'start' || field.id === 'end') {
      return false;
    }
  }
  if (field.valueType === 'unix_timestamp') return true;
  if (field.valueType && field.valueType !== 'unix_timestamp') return false;
  const tag = field.tag ?? field.produces?.[0] ?? field.id;
  if (tagValueType(tag, kind) === 'unix_timestamp') return true;
  if (UNIX_TAG_HINTS.has(tag) || UNIX_TAG_HINTS.has(field.id)) return true;
  if (/\bunix\b/i.test(field.label) || /\bunix timestamp\b/i.test(field.help ?? '')) {
    return true;
  }
  return false;
}

/** NIP-52 date-based calendar `start` / `end` ISO days. */
export function isIsoDateField(field: FieldDef, kind: number): boolean {
  if (kind !== 31922) return false;
  const tag = field.tag ?? field.produces?.[0] ?? field.id;
  return tag === 'start' || tag === 'end' || field.id === 'start' || field.id === 'end';
}
