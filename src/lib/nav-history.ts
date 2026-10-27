import { writable } from 'svelte/store';
import { replace } from 'svelte-spa-router';

const MAX_STACK = 64;

/** Previous SPA locations (path + query, no leading `#`). */
let stack: string[] = [];
/** Last tracked location; seeded on first track. */
let lastSeen = '';
/** When true, the next track is from Return / a quiet rewrite — do not push. */
let skipping = false;

/** Stack depth for optional UI; Return always works (empty → landing). */
export const navHistoryDepth = writable(0);

export function normalizeNavKey(hashOrPath: string): string {
  let s = hashOrPath.replace(/^#/, '').trim();
  if (!s) return '/';
  if (!s.startsWith('/')) s = `/${s}`;
  return s;
}

/** Current hash location as `/path?query` (or `/`). */
export function currentNavKey(): string {
  if (typeof window === 'undefined') return '/';
  return normalizeNavKey(window.location.hash || '/');
}

function publishDepth(): void {
  navHistoryDepth.set(stack.length);
}

/**
 * Next location change is a quiet rewrite (default feed tab, canonical path) —
 * update lastSeen without pushing a history entry.
 */
export function skipNextNavTrack(): void {
  skipping = true;
}

/**
 * Record a navigation. Call whenever path or query changes.
 * Pushes the previous location so Return can walk back.
 */
export function trackNavChange(nextRaw: string): void {
  const next = normalizeNavKey(nextRaw);
  if (skipping) {
    skipping = false;
    lastSeen = next;
    return;
  }
  if (!lastSeen) {
    lastSeen = next;
    return;
  }
  if (next === lastSeen) return;
  stack.push(lastSeen);
  if (stack.length > MAX_STACK) stack.splice(0, stack.length - MAX_STACK);
  lastSeen = next;
  publishDepth();
}

/** Where Return would go without mutating the stack. */
export function peekReturnTarget(): string {
  // Prefer lastSeen (SPA track state) over window.hash — stays correct in
  // tests and when hash lags a quiet rewrite.
  const cur = lastSeen || currentNavKey();
  for (let i = stack.length - 1; i >= 0; i--) {
    const prev = stack[i];
    if (prev && prev !== cur) return prev;
  }
  return '/';
}

/** Pop to the previous location, or landing (`/`) when the stack is empty. */
export function navigateReturn(): void {
  const cur = lastSeen || currentNavKey();
  let target = '/';
  while (stack.length) {
    const prev = stack.pop();
    if (prev && prev !== cur) {
      target = prev;
      break;
    }
  }
  publishDepth();
  let dest = normalizeNavKey(target);
  // replace() is a no-op when already there — do not leave `skipping` stuck
  // or the next real navigation will be dropped from the stack.
  if (dest === cur) {
    skipping = false;
    lastSeen = cur;
    if (cur === '/') return;
    dest = '/';
  }
  skipping = true;
  lastSeen = dest;
  void replace(dest);
}

/** Test helper — reset module state. */
export function resetNavHistoryForTests(): void {
  stack = [];
  lastSeen = '';
  skipping = false;
  publishDepth();
}
