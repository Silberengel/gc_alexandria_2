import type { Event } from 'nostr-tools';
import { KIND, MISSING_PARENT_PLACEHOLDER, MUTED_PARENT_PLACEHOLDER } from './constants';
import { type MuteState, isMutedEvent } from './mute';
import { fetchByIds } from './nostr/fetch';
import { relayPool } from './nostr/pool';
import { documentStack, socialStack } from './nostr/selector';
import { eventAddress, firstTag } from './nostr/verify';

export type ThreadNode = {
  event: Event | null;
  placeholder: string | null;
  /** Parent event id when this node is a muted/missing-parent placeholder. */
  missingParentId?: string;
  children: ThreadNode[];
};

/** Stable keyed-each id for a thread node (placeholders share the same label text). */
export function threadNodeKey(node: ThreadNode): string {
  if (node.event?.id) return node.event.id.toLowerCase();
  if (node.missingParentId) return `ph:${node.missingParentId}`;
  return `ph:${node.placeholder ?? 'unknown'}`;
}

/** Kind 1111 NIP-22 comments and kind 1 NIP-10 notes that participate in a thread. */
export function isThreadEvent(event: Event): boolean {
  return event.kind === KIND.COMMENT || event.kind === KIND.TEXT_NOTE;
}

/**
 * Parent event id for threading.
 * NIP-22: lowercase `e` is the parent.
 * NIP-10: prefer the `reply` marker, else the last `e` tag.
 */
export function commentParentId(event: Event): string | null {
  const eTags = event.tags.filter((t) => t[0] === 'e' && t[1]);
  if (!eTags.length) return null;
  if (event.kind === KIND.TEXT_NOTE) {
    const marked = eTags.find((t) => t[3] === 'reply') ?? eTags[eTags.length - 1];
    return marked?.[1]?.toLowerCase() ?? null;
  }
  return eTags[0]?.[1]?.toLowerCase() ?? null;
}

export function commentRootAddress(event: Event): string | null {
  return firstTag(event, 'A') ?? firstTag(event, 'a') ?? null;
}

export function commentTargetsAddress(event: Event, address: string): boolean {
  return event.tags.some((t) => (t[0] === 'A' || t[0] === 'a') && t[1] === address);
}

/** Parent ids referenced by thread events that are not yet in `have`. */
export function missingCommentParentIds(
  events: Event[],
  have: ReadonlySet<string>,
  rootEventIds: Iterable<string> = []
): string[] {
  const roots = new Set(
    [...rootEventIds].map((id) => id.toLowerCase()).filter((id) => /^[0-9a-f]{64}$/.test(id))
  );
  const missing = new Set<string>();
  for (const event of events) {
    if (!isThreadEvent(event)) continue;
    const parentId = commentParentId(event);
    if (!parentId || roots.has(parentId) || have.has(parentId)) continue;
    missing.add(parentId);
  }
  return [...missing];
}

export function nestComments(
  comments: Event[],
  mute?: MuteState,
  /** Event ids of the work/section — kind 1 replies to these are roots, not orphans. */
  rootEventIds: Iterable<string> = []
): ThreadNode[] {
  const rootIds = new Set(
    [...rootEventIds].map((id) => id.toLowerCase()).filter((id) => /^[0-9a-f]{64}$/.test(id))
  );
  const visible = comments.filter(
    (c) => isThreadEvent(c) && !(mute && isMutedEvent(c, mute))
  );
  const visibleIds = new Set(visible.map((c) => c.id.toLowerCase()));
  const allById = new Map(comments.map((c) => [c.id.toLowerCase(), c]));
  const nodes = new Map<string, ThreadNode>();
  const placeholders = new Map<string, ThreadNode>();

  function nodeFor(event: Event): ThreadNode {
    const id = event.id.toLowerCase();
    let node = nodes.get(id);
    if (!node) {
      node = { event, placeholder: null, children: [] };
      nodes.set(id, node);
    }
    return node;
  }

  function attachUnderPlaceholder(parentId: string, node: ThreadNode, label: string): void {
    let placeholder = placeholders.get(parentId);
    if (!placeholder) {
      placeholder = {
        event: null,
        placeholder: label,
        missingParentId: parentId,
        children: []
      };
      placeholders.set(parentId, placeholder);
      roots.push(placeholder);
    }
    placeholder.children.push(node);
  }

  const roots: ThreadNode[] = [];
  const seenRoot = new Set<ThreadNode>();

  for (const comment of visible) {
    const node = nodeFor(comment);
    const parentId = commentParentId(comment);
    if (!parentId || rootIds.has(parentId)) {
      if (!seenRoot.has(node)) {
        seenRoot.add(node);
        roots.push(node);
      }
      continue;
    }
    const parent = allById.get(parentId);
    if (parent && visibleIds.has(parent.id.toLowerCase())) {
      nodeFor(parent).children.push(node);
      continue;
    }
    if (parent && mute && isMutedEvent(parent, mute)) {
      attachUnderPlaceholder(parentId, node, MUTED_PARENT_PLACEHOLDER);
      continue;
    }
    // Parent still missing after relay recovery — keep a stub, do not promote to root.
    attachUnderPlaceholder(parentId, node, MISSING_PARENT_PLACEHOLDER);
  }

  return roots;
}

/** Continue any kind 1 with kind 1; everything else gets NIP-22. */
export function shouldReplyWithKind1(replyTo: Event): boolean {
  return replyTo.kind === KIND.TEXT_NOTE;
}

/** NIP-10 e/p tags for a kind 1 reply to another kind 1. */
export function nip10ReplyTags(
  replyTo: Event,
  workEventIds: Iterable<string> = []
): string[][] {
  const work = new Set(
    [...workEventIds].map((id) => id.toLowerCase()).filter((id) => /^[0-9a-f]{64}$/.test(id))
  );
  const eTags = replyTo.tags.filter((t) => t[0] === 'e' && t[1]);
  const markedRoot = eTags.find((t) => t[3] === 'root')?.[1]?.toLowerCase();
  const rootId =
    markedRoot ??
    eTags.find((t) => t[1] && work.has(t[1].toLowerCase()))?.[1]?.toLowerCase() ??
    eTags[0]?.[1]?.toLowerCase() ??
    replyTo.id.toLowerCase();
  const tags: string[][] = [
    ['e', rootId, '', 'root'],
    ['e', replyTo.id.toLowerCase(), '', 'reply']
  ];
  const seenP = new Set<string>();
  for (const t of replyTo.tags) {
    if (t[0] !== 'p' || !t[1]) continue;
    const pk = t[1].toLowerCase();
    if (seenP.has(pk)) continue;
    seenP.add(pk);
    tags.push(t.length > 2 ? ['p', pk, t[2]!] : ['p', pk]);
  }
  const author = replyTo.pubkey.toLowerCase();
  if (!seenP.has(author)) tags.push(['p', author]);
  return tags;
}

export function nip22TagsForTarget(target: Event, replyTo?: Event): string[][] {
  const d = target.tags.find((t) => t[0] === 'd')?.[1] ?? '';
  const addr = `${target.kind}:${target.pubkey}:${d}`;
  const replaceable = target.kind >= 10000;
  const tags: string[][] = [];
  if (replaceable) {
    tags.push(['A', addr], ['K', String(target.kind)], ['P', target.pubkey]);
  } else {
    tags.push(['E', target.id], ['K', String(target.kind)], ['P', target.pubkey]);
  }
  if (replyTo) {
    tags.push(['e', replyTo.id], ['k', String(replyTo.kind)], ['p', replyTo.pubkey]);
  } else if (replaceable) {
    tags.push(['a', addr], ['k', String(target.kind)], ['p', target.pubkey]);
  } else {
    tags.push(['e', target.id], ['k', String(target.kind)], ['p', target.pubkey]);
  }
  return tags;
}

/** Social + document (+ inbox/outbox when signed in) — full scan for missing parents. */
function threadRelayUniverse(): string[] {
  return [...new Set([...socialStack(), ...documentStack()])];
}

/**
 * Pull missing parent events by id from Mercury + a wide relay set.
 * Walks a few hops so reply chains can reassemble.
 */
export async function resolveMissingCommentParents(
  events: Event[],
  rootEventIds: Iterable<string> = [],
  maxHops = 3
): Promise<Event[]> {
  const byId = new Map<string, Event>();
  for (const e of events) {
    if (e?.id) byId.set(e.id.toLowerCase(), e);
  }
  const roots = [...rootEventIds];

  for (let hop = 0; hop < maxHops; hop++) {
    const missing = missingCommentParentIds([...byId.values()], new Set(byId.keys()), roots).slice(
      0,
      24
    );
    if (!missing.length) break;

    const found = await fetchByIds(missing, 8);
    for (const e of found) byId.set(e.id.toLowerCase(), e);

    const still = missing.filter((id) => !byId.has(id));
    if (!still.length) continue;

    const wide = await relayPool.query(
      threadRelayUniverse(),
      [{ ids: still, limit: still.length }],
      6000,
      12
    );
    for (const e of wide) byId.set(e.id.toLowerCase(), e);
  }

  return [...byId.values()];
}

/** Kind 1111 by a/A plus kind 1 / 1111 by e (root and replies), then recover missing parents. */
export async function fetchThreadEvents(target: Event, limit = 40): Promise<Event[]> {
  const a = eventAddress(target);
  // Keep initial filter count and fan-out modest — social relays rate-limit ~12 REQ/min.
  const first = await relayPool.query(
    socialStack(),
    [
      { kinds: [KIND.COMMENT], '#A': [a], limit },
      { kinds: [KIND.COMMENT], '#a': [a], limit },
      { kinds: [KIND.TEXT_NOTE, KIND.COMMENT], '#e': [target.id.toLowerCase()], limit }
    ],
    5000,
    2
  );
  const byId = new Map<string, Event>();
  for (const e of first) {
    if (isThreadEvent(e)) byId.set(e.id.toLowerCase(), e);
  }
  const parentIds = [...byId.keys()].slice(0, 6);
  if (parentIds.length) {
    const nested = await relayPool.query(
      socialStack(),
      [{ kinds: [KIND.TEXT_NOTE, KIND.COMMENT], '#e': parentIds, limit: 30 }],
      4000,
      2
    );
    for (const e of nested) {
      if (isThreadEvent(e)) byId.set(e.id.toLowerCase(), e);
    }
  }

  // Parents often live on a different relay than the reply — scan the full stack by id.
  const recovered = await resolveMissingCommentParents([...byId.values()], [target.id]);
  for (const e of recovered) {
    if (isThreadEvent(e)) byId.set(e.id.toLowerCase(), e);
  }
  return [...byId.values()];
}
