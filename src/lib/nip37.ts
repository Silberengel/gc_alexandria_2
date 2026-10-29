import type { Event } from 'nostr-tools';
import {
  buildCheckpointTags,
  buildPrivateRelayTagRows,
  draftWrapAddress,
  parsePrivateRelayTags
} from '@silberengel/kind-compose-catalog';
import { KIND, PUBLIC_BROADCAST_RELAYS } from './constants';
import { looksLikeNip44Ciphertext } from './mute';
import { cacheScanByKind } from './nostr/cache';
import { cachedIdentityEvent } from './nostr/identity-cache';
import { pickLatestReplaceable, pruneToLatestReplaceables } from './nostr/replaceable';
import { uniqueRelayUrls } from './nostr/mailboxes';
import { relayPool } from './nostr/pool';
import { writeStack } from './nostr/selector';
import { signUnsigned, consumeSignFailure, publishSigned } from './sign';
import { session } from './stores/session';
import { showPublishResult } from './stores/toast';

const DRAFT_TTL_SEC = 90 * 24 * 60 * 60;
const RELAY_URL = /^wss?:\/\//i;

export type UnsignedDraftEvent = {
  kind: number;
  content: string;
  tags: string[][];
  created_at?: number;
};

export type DecryptedDraftWrap = {
  wrap: Event;
  d: string;
  draftKind: number;
  draft: UnsignedDraftEvent | null;
  deleted: boolean;
  updatedAt: number;
};

export type DecryptedCheckpoint = {
  event: Event;
  created_at: number;
  draft: UnsignedDraftEvent | null;
  content: string;
};

function pubkey(): string | null {
  return session.getPubkey()?.toLowerCase() ?? null;
}

async function encryptToSelf(plaintext: string): Promise<string> {
  const pk = pubkey();
  if (!pk) throw new Error('Sign in before encrypting drafts.');
  const signer = session.getSigner();
  if (!signer?.nip44Encrypt) {
    throw new Error('Your signer does not support NIP-44 encryption.');
  }
  return signer.nip44Encrypt(pk, plaintext);
}

async function decryptFromSelf(ciphertext: string): Promise<string | null> {
  const content = ciphertext?.trim();
  if (!content) return '';
  if (!looksLikeNip44Ciphertext(content) && !content.startsWith('[')) {
    return null;
  }
  if (content.startsWith('[')) return content;

  const pk = pubkey();
  if (!pk) return null;
  const attempts: Array<(pubkey: string, ct: string) => Promise<string>> = [];
  const signer = session.getSigner();
  const bunkerSession = session.getSignerType() === 'bunker';
  if (signer?.nip44Decrypt) {
    attempts.push((p, ct) => signer.nip44Decrypt!(p, ct));
  }
  if (!bunkerSession) {
    const ext = typeof window !== 'undefined' ? window.nostr : undefined;
    if (typeof ext?.nip44?.decrypt === 'function') {
      attempts.push(ext.nip44.decrypt.bind(ext.nip44));
    }
  }
  for (const decrypt of attempts) {
    try {
      const plain = await Promise.race([
        decrypt(pk, content),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500))
      ]);
      if (plain != null) return plain;
    } catch {
      /* try next */
    }
  }
  return null;
}

function parseDraftJson(plain: string): UnsignedDraftEvent | null {
  try {
    const parsed = JSON.parse(plain) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.kind !== 'number') return null;
    return {
      kind: obj.kind,
      content: typeof obj.content === 'string' ? obj.content : '',
      tags: Array.isArray(obj.tags)
        ? (obj.tags.filter(
            (row): row is string[] => Array.isArray(row) && typeof row[0] === 'string'
          ) as string[][])
        : [],
      created_at: typeof obj.created_at === 'number' ? obj.created_at : undefined
    };
  } catch {
    return null;
  }
}

export function normalizePrivateRelayUrls(urls: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const url = String(raw ?? '').trim();
    if (!url || !RELAY_URL.test(url)) continue;
    const key = url.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

export async function parsePrivateRelayList(event: Event | null): Promise<string[]> {
  if (!event || event.kind !== KIND.PRIVATE_RELAY_LIST) return [];
  const plain = await decryptFromSelf(event.content ?? '');
  if (plain == null || plain === '') return [];
  try {
    return parsePrivateRelayTags(JSON.parse(plain));
  } catch {
    return [];
  }
}

/** Cached / metadata / network lookup for the viewer's kind 10013. */
export async function fetchPrivateRelayListEvent(): Promise<Event | null> {
  const pk = pubkey();
  if (!pk) return null;
  const cached =
    cachedIdentityEvent(KIND.PRIVATE_RELAY_LIST, pk) ??
    pickLatestReplaceable(session.getMetadata(), KIND.PRIVATE_RELAY_LIST);
  if (cached) return cached;

  const relays = writeStack();
  if (!relays.length) return null;
  const hits = await relayPool.query(
    relays,
    [{ authors: [pk], kinds: [KIND.PRIVATE_RELAY_LIST], limit: 5 }],
    4000,
    4
  );
  const latest = pickLatestReplaceable(hits, KIND.PRIVATE_RELAY_LIST);
  if (latest) session.rememberEvent(latest);
  return latest;
}

export async function privateStorageRelays(): Promise<string[]> {
  const event = await fetchPrivateRelayListEvent();
  return parsePrivateRelayList(event);
}

export async function publishPrivateRelayList(urls: string[]): Promise<Event | null> {
  const pk = pubkey();
  if (!pk) return null;
  const normalized = normalizePrivateRelayUrls(urls);
  if (!normalized.length) {
    throw new Error('Add at least one ws:// or wss:// relay.');
  }
  const rows = buildPrivateRelayTagRows(normalized);
  const content = await encryptToSelf(JSON.stringify(rows));
  const signed = await signUnsigned({
    kind: KIND.PRIVATE_RELAY_LIST,
    content,
    tags: []
  });
  if (!signed) {
    throw new Error(consumeSignFailure() ?? 'Could not sign the private relay list.');
  }
  const wrote = await publishSigned(signed);
  if (!wrote) {
    showPublishResult(false);
    return null;
  }
  showPublishResult(true, 'Draft relay list published.');
  return signed;
}

export function publicFallbackPrivateRelays(): string[] {
  return [...PUBLIC_BROADCAST_RELAYS];
}

export function draftExpirationUnix(nowSec = Math.floor(Date.now() / 1000)): number {
  return nowSec + DRAFT_TTL_SEC;
}

/**
 * Draft-wrap tags. Always includes `d` (even when empty) so Primal-style wraps
 * can be replaced on delete. Catalog helper historically omitted empty d.
 */
export function buildDraftWrapTags(opts: {
  d: string;
  k: number | string;
  expiration?: number | string | null;
}): string[][] {
  const d = String(opts.d ?? '').trim();
  const k = String(opts.k ?? '').trim();
  const tags: string[][] = [['d', d]];
  if (k) tags.push(['k', k]);
  if (opts.expiration != null && String(opts.expiration).trim() !== '') {
    tags.push(['expiration', String(opts.expiration).trim()]);
  }
  return tags;
}

export async function saveDraftWrap(opts: {
  draftEvent: UnsignedDraftEvent;
  d: string;
  /** Also publish a kind-1234 checkpoint (default true). */
  checkpoint?: boolean;
}): Promise<{ wrap: Event; checkpoint: Event | null } | null> {
  const pk = pubkey();
  if (!pk) return null;
  // Empty `d` is valid (Primal publishes that way); Alexandria normally mints a UUID.
  const d = String(opts.d ?? '').trim();
  const relays = await draftPublishRelays();
  if (!relays.length) {
    throw new Error('Publish a private relay list (kind 10013) before saving drafts.');
  }

  const draft: UnsignedDraftEvent = {
    kind: opts.draftEvent.kind,
    content: opts.draftEvent.content ?? '',
    tags: opts.draftEvent.tags ?? [],
    created_at: opts.draftEvent.created_at ?? Math.floor(Date.now() / 1000)
  };
  const ciphertext = await encryptToSelf(JSON.stringify(draft));
  const tags = buildDraftWrapTags({
    d,
    k: draft.kind,
    expiration: draftExpirationUnix()
  });
  const wrap = await signUnsigned({
    kind: KIND.DRAFT_WRAP,
    content: ciphertext,
    tags
  });
  if (!wrap) {
    throw new Error(consumeSignFailure() ?? 'Could not sign the draft wrap.');
  }
  const published = await session.publishToRelays(wrap, relays, { bypassConstrain: true });
  if (!published) {
    throw new Error('No private storage relay accepted the draft wrap.');
  }

  let checkpoint: Event | null = null;
  if (opts.checkpoint !== false) {
    const address = draftWrapAddress(pk, d);
    const cp = await signUnsigned({
      kind: KIND.DRAFT_CHECKPOINT,
      content: ciphertext,
      tags: buildCheckpointTags({ address })
    });
    if (cp) {
      await session.publishToRelays(cp, relays, { bypassConstrain: true });
      checkpoint = cp;
    }
  }
  return { wrap, checkpoint };
}

/** Private storage plus write relays — other clients (e.g. Primal) often land wraps on outboxes. */
async function draftPublishRelays(): Promise<string[]> {
  const privateRelays = await privateStorageRelays();
  return uniqueRelayUrls([...privateRelays, ...writeStack()]);
}

export async function deleteDraftWrap(d: string, draftKind: number): Promise<Event | null> {
  const pk = pubkey();
  if (!pk) return null;
  const relays = await draftPublishRelays();
  if (!relays.length) throw new Error('No private relay list or write relays available.');
  // Keep empty `d` — required to replace Primal-style wraps.
  const tags = buildDraftWrapTags({ d: String(d ?? ''), k: draftKind });
  const wrap = await signUnsigned({
    kind: KIND.DRAFT_WRAP,
    content: '',
    tags
  });
  if (!wrap) {
    throw new Error(consumeSignFailure() ?? 'Could not sign the draft deletion.');
  }
  const published = await session.publishToRelays(wrap, relays, { bypassConstrain: true });
  if (!published) {
    throw new Error('No relay accepted the draft deletion.');
  }
  return wrap;
}

/**
 * Accept kind-31234 wraps, including Primal-style empty `d` identifiers.
 * Only a numeric `k` tag is required.
 */
export async function decryptWrap(event: Event): Promise<DecryptedDraftWrap | null> {
  if (event.kind !== KIND.DRAFT_WRAP) return null;
  const d = event.tags.find((t) => t[0] === 'd')?.[1]?.trim() ?? '';
  const kRaw = event.tags.find((t) => t[0] === 'k')?.[1];
  const draftKind = kRaw != null && kRaw !== '' ? Number(kRaw) : NaN;
  if (!Number.isFinite(draftKind)) return null;
  const deleted = !event.content?.trim();
  let draft: UnsignedDraftEvent | null = null;
  if (!deleted) {
    const plain = await decryptFromSelf(event.content);
    if (plain) draft = parseDraftJson(plain);
  }
  return {
    wrap: event,
    d,
    draftKind,
    draft,
    deleted,
    updatedAt: event.created_at * 1000
  };
}

/** Private storage first, then the viewer's write relays (where other clients often publish). */
async function draftHuntRelays(): Promise<string[]> {
  const privateRelays = await privateStorageRelays();
  return uniqueRelayUrls([...privateRelays, ...writeStack()]);
}

export async function fetchDraftWraps(): Promise<DecryptedDraftWrap[]> {
  const pk = pubkey();
  if (!pk) return [];
  const relays = await draftHuntRelays();
  const fromSession = session.getMetadata().filter((e) => e.kind === KIND.DRAFT_WRAP);
  let fromCache: Event[] = [];
  try {
    fromCache = (await cacheScanByKind(KIND.DRAFT_WRAP, 80)).filter(
      (e) => e.pubkey.toLowerCase() === pk
    );
  } catch {
    /* private mode / quota */
  }
  let fromRelays: Event[] = [];
  if (relays.length) {
    fromRelays = await relayPool.query(
      relays,
      [{ authors: [pk], kinds: [KIND.DRAFT_WRAP], limit: 80 }],
      6000,
      Math.min(Math.max(relays.length, 4), 8),
      undefined,
      // Private-storage URLs are often outside NIP-65; still dial write/search hosts here.
      { bypassConstrain: true, priority: true }
    );
    for (const event of fromRelays) session.rememberEvent(event);
  }
  const latest = pruneToLatestReplaceables([...fromCache, ...fromSession, ...fromRelays]).filter(
    (e) => e.kind === KIND.DRAFT_WRAP && e.pubkey.toLowerCase() === pk
  );
  const out: DecryptedDraftWrap[] = [];
  for (const event of latest) {
    const dec = await decryptWrap(event);
    if (dec && !dec.deleted) out.push(dec);
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export async function fetchCheckpoints(d: string): Promise<DecryptedCheckpoint[]> {
  const pk = pubkey();
  if (!pk) return [];
  const relays = await privateStorageRelays();
  if (!relays.length) return [];
  const address = draftWrapAddress(pk, d.trim());
  const hits = await relayPool.query(
    relays,
    [{ authors: [pk], kinds: [KIND.DRAFT_CHECKPOINT], '#a': [address], limit: 100 }],
    6000,
    Math.min(relays.length, 6),
    undefined,
    { bypassConstrain: true, priority: true }
  );
  const sorted = [...hits]
    .filter((e) => e.kind === KIND.DRAFT_CHECKPOINT)
    .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
  const out: DecryptedCheckpoint[] = [];
  for (const event of sorted) {
    const plain = event.content?.trim() ? await decryptFromSelf(event.content) : null;
    const draft = plain ? parseDraftJson(plain) : null;
    out.push({
      event,
      created_at: event.created_at,
      draft,
      content: draft?.content ?? ''
    });
  }
  return out;
}

export function signerSupportsNip44(): boolean {
  const signer = session.getSigner();
  if (signer?.nip44Encrypt) return true;
  if (session.getSignerType() === 'bunker') return false;
  return typeof window !== 'undefined' && typeof window.nostr?.nip44?.encrypt === 'function';
}
