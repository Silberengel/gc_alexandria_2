/** NIP-05 verification against `/.well-known/nostr.json` (simplified jumble parity). */

export type VerifyNip05Result = {
  isVerified: boolean;
  nip05Name: string;
  nip05Domain: string;
};

const HEX64 = /^[0-9a-f]{64}$/i;

function normalizeHex(pubkey: string): string | null {
  const t = pubkey.trim().toLowerCase();
  return HEX64.test(t) ? t : null;
}

/**
 * Split `local@domain` on the first `@` only.
 */
export function splitNip05Identifier(nip05Str: string): { name: string; domain: string } | null {
  const s = nip05Str.trim();
  const at = s.indexOf('@');
  if (at <= 0 || at >= s.length - 1) return null;
  const name = s.slice(0, at).trim();
  const domain = s
    .slice(at + 1)
    .trim()
    .replace(/\.$/, '')
    .toLowerCase();
  if (!name || !domain) return null;
  return { name, domain };
}

export function getWellKnownNip05Url(domain: string, name?: string): string {
  const url = new URL('/.well-known/nostr.json', `https://${domain}`);
  if (name) url.searchParams.set('name', name);
  return url.toString();
}

function pubkeyFromNamesValue(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let t = v.trim();
  if (t.startsWith('0x') || t.startsWith('0X')) t = t.slice(2).trim();
  if (HEX64.test(t)) return t.toLowerCase();
  return null;
}

function getNamesEntry(names: Record<string, unknown>, nip05Name: string): unknown {
  if (nip05Name in names) return names[nip05Name];
  const want = nip05Name.toLowerCase();
  for (const [k, v] of Object.entries(names)) {
    if (k.toLowerCase() === want) return v;
  }
  return undefined;
}

/**
 * Pure check: does well-known JSON map `nip05Name` to `userHex`?
 * Also accepts inverted `hex → username` rows.
 */
export function verifyNip05AgainstWellKnown(
  json: Record<string, unknown> | null,
  nip05Name: string,
  userHex: string
): boolean {
  if (!json) return false;
  const names = json.names;
  if (!names || typeof names !== 'object' || Array.isArray(names)) return false;
  const map = names as Record<string, unknown>;
  const user = userHex.toLowerCase();

  const direct = getNamesEntry(map, nip05Name);
  const directHex = pubkeyFromNamesValue(direct);
  if (directHex && directHex === user) return true;

  // Inverted: hex/npub key → local name
  for (const [key, value] of Object.entries(map)) {
    const hexKey = pubkeyFromNamesValue(key);
    if (hexKey && hexKey === user) {
      const label = typeof value === 'string' ? value.trim() : '';
      if (label && label.toLowerCase() === nip05Name.toLowerCase()) return true;
    }
    const hexVal = pubkeyFromNamesValue(value);
    if (hexVal === user && key.toLowerCase() === nip05Name.toLowerCase()) return true;
  }
  return false;
}

const cache = new Map<string, VerifyNip05Result>();
const inflight = new Map<string, Promise<VerifyNip05Result>>();

async function fetchWellKnown(
  domain: string,
  name?: string
): Promise<Record<string, unknown> | null> {
  const url = getWellKnownNip05Url(domain, name);
  try {
    const res = await fetch(url, {
      credentials: 'omit',
      mode: 'cors',
      signal: AbortSignal.timeout(12_000)
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function verifyOnce(nip05: string, pubkey: string): Promise<VerifyNip05Result> {
  const split = splitNip05Identifier(nip05);
  const userHex = normalizeHex(pubkey);
  const base: VerifyNip05Result = {
    isVerified: false,
    nip05Name: split?.name ?? '',
    nip05Domain: split?.domain ?? ''
  };
  if (!split || !userHex) return base;

  const full = await fetchWellKnown(split.domain);
  if (verifyNip05AgainstWellKnown(full, split.name, userHex)) {
    return { ...base, isVerified: true };
  }
  // Dynamic hosts only list the user when `?name=` is set.
  const scoped = await fetchWellKnown(split.domain, split.name);
  if (verifyNip05AgainstWellKnown(scoped, split.name, userHex)) {
    return { ...base, isVerified: true };
  }
  return base;
}

/** Verify NIP-05; caches successful results. */
export async function verifyNip05(nip05: string, pubkey: string): Promise<VerifyNip05Result> {
  const key = `${nip05.trim().toLowerCase()}|${pubkey.trim().toLowerCase()}`;
  const hit = cache.get(key);
  if (hit?.isVerified) return hit;

  let pending = inflight.get(key);
  if (!pending) {
    pending = verifyOnce(nip05, pubkey).then((result) => {
      inflight.delete(key);
      if (result.isVerified) cache.set(key, result);
      return result;
    });
    inflight.set(key, pending);
  }
  return pending;
}
