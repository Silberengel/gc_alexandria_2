import type { Event } from 'nostr-tools';
import { KIND } from '../constants';
import { isNewerReplaceable } from './replaceable';
import { ingestTrustedEvent } from './verify';

/**
 * Latest replaceable per person and kind: profiles, contact and mute lists,
 * relay lists (including favorites, blocked, and local), and payment targets.
 * One local map, read synchronously at startup, then refreshed from relays.
 * The event cache does not keep a second copy of these.
 */
const STORAGE_KEY = 'alexandria-identity-v1';
const MAX_EVENTS = 400;

const KINDS = new Set<number>([
  KIND.METADATA,
  KIND.CONTACT_LIST,
  KIND.MUTE,
  KIND.RELAY_LIST,
  KIND.BLOCKED,
  KIND.FAVORITE,
  KIND.PRIVATE_RELAY_LIST,
  KIND.LOCAL,
  KIND.PAYMENT
]);

type Saved = {
  order: string[];
  events: Record<string, Event>;
};

let loaded = false;
let order: string[] = [];
let events: Record<string, Event> = {};
let persisted = true;

function coord(kind: number, pubkey: string): string {
  return `${kind}:${pubkey.toLowerCase()}`;
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Saved;
    if (!parsed || !Array.isArray(parsed.order) || !parsed.events) return;
    order = [];
    events = {};
    for (const key of parsed.order) {
      const event = ingestTrustedEvent(parsed.events[key]);
      if (!event || !KINDS.has(event.kind)) continue;
      const keyNow = coord(event.kind, event.pubkey);
      events[keyNow] = event;
      order.push(keyNow);
    }
  } catch {
    order = [];
    events = {};
  }
}

function scheduleWrite(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ order, events }));
    persisted = true;
  } catch {
    persisted = false;
  }
}

function touch(key: string, event: Event): void {
  const at = order.indexOf(key);
  if (at >= 0) order.splice(at, 1);
  order.push(key);
  events[key] = event;
  while (order.length > MAX_EVENTS) {
    const drop = order.shift();
    if (drop) delete events[drop];
  }
  scheduleWrite();
}

export function isIdentityKind(kind: number): boolean {
  return KINDS.has(kind);
}

/** Remember a replaceable from the startup map. Newer event wins. */
export function rememberIdentityEvent(event: Event): void {
  const trusted = ingestTrustedEvent(event);
  if (!trusted || !KINDS.has(trusted.kind)) return;
  load();
  const key = coord(trusted.kind, trusted.pubkey);
  const current = events[key];
  if (current && current.id === trusted.id && persisted) return;
  if (current && !isNewerReplaceable(trusted, current)) return;
  touch(key, trusted);
}

export function cachedIdentityEvent(kind: number, pubkey: string): Event | null {
  if (!KINDS.has(kind)) return null;
  load();
  return events[coord(kind, pubkey)] ?? null;
}

/** Every stored replaceable of one kind (profiles, contact lists, …). */
export function cachedIdentityEvents(kind: number): Event[] {
  if (!KINDS.has(kind)) return [];
  load();
  const prefix = `${kind}:`;
  const out: Event[] = [];
  for (const key of order) {
    if (!key.startsWith(prefix)) continue;
    const event = events[key];
    if (event && event.kind === kind) out.push(event);
  }
  return out;
}

export function clearIdentityCache(): void {
  loaded = true;
  persisted = true;
  order = [];
  events = {};
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Viewer's cached profile, lists, and payment target, if we have seen them. */
export function cachedViewerIdentity(pubkey: string): Event[] {
  const pk = pubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pk)) return [];
  return [...KINDS]
    .map((kind) => cachedIdentityEvent(kind, pk))
    .filter((event): event is Event => !!event);
}
