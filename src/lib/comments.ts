import type { Event } from 'nostr-tools';
import { KIND, MUTED_PARENT_PLACEHOLDER } from './constants';
import { type MuteState, isMutedEvent } from './mute';
import { firstTag } from './nostr/verify';

export type ThreadNode = {
  event: Event | null;
  placeholder: string | null;
  children: ThreadNode[];
};

export function commentParentId(event: Event): string | null {
  return firstTag(event, 'e') ?? null;
}

export function commentRootAddress(event: Event): string | null {
  return firstTag(event, 'A') ?? firstTag(event, 'a') ?? null;
}

export function commentTargetsAddress(event: Event, address: string): boolean {
  return event.tags.some((t) => (t[0] === 'A' || t[0] === 'a') && t[1] === address);
}

export function nestComments(comments: Event[], mute?: MuteState): ThreadNode[] {
  const visible = comments.filter(
    (c) => c.kind === KIND.COMMENT && !(mute && isMutedEvent(c, mute))
  );
  const visibleIds = new Set(visible.map((c) => c.id));
  const allById = new Map(comments.map((c) => [c.id, c]));
  const nodes = new Map<string, ThreadNode>();
  const placeholders = new Map<string, ThreadNode>();

  function nodeFor(event: Event): ThreadNode {
    let node = nodes.get(event.id);
    if (!node) {
      node = { event, placeholder: null, children: [] };
      nodes.set(event.id, node);
    }
    return node;
  }

  const roots: ThreadNode[] = [];
  const seenRoot = new Set<ThreadNode>();

  for (const comment of visible) {
    const node = nodeFor(comment);
    const parentId = commentParentId(comment);
    if (!parentId) {
      if (!seenRoot.has(node)) {
        seenRoot.add(node);
        roots.push(node);
      }
      continue;
    }
    const parent = allById.get(parentId);
    if (parent && visibleIds.has(parent.id)) {
      nodeFor(parent).children.push(node);
      continue;
    }
    let placeholder = placeholders.get(parentId);
    if (!placeholder) {
      placeholder = { event: null, placeholder: MUTED_PARENT_PLACEHOLDER, children: [] };
      placeholders.set(parentId, placeholder);
      roots.push(placeholder);
    }
    placeholder.children.push(node);
  }

  return roots;
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
