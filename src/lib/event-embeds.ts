import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { splitNostrRefs } from './nostr-refs';
import { fetchByAddress, fetchById } from './nostr/fetch';

const HEX_ID = /^[0-9a-f]{64}$/i;

export type EmbedPointer = { kind: 'id'; id: string } | { kind: 'addr'; addr: string };

function pointerKey(p: EmbedPointer): string {
  return p.kind === 'id' ? `id:${p.id}` : `a:${p.addr}`;
}

function addPointer(out: EmbedPointer[], seen: Set<string>, p: EmbedPointer): void {
  const key = pointerKey(p);
  if (seen.has(key)) return;
  seen.add(key);
  out.push(p);
}

/** `q` tags, plus kind 1 `a`/`A` shares — same pointers the one-line embed card uses. */
export function embedPointersFromTags(event: Event): EmbedPointer[] {
  const out: EmbedPointer[] = [];
  const seen = new Set<string>();
  for (const t of event.tags) {
    const name = t[0];
    const v = t[1]?.trim();
    if (!v) continue;
    if (name === 'q') {
      if (HEX_ID.test(v)) addPointer(out, seen, { kind: 'id', id: v.toLowerCase() });
      else addPointer(out, seen, { kind: 'addr', addr: v });
    }
    if (event.kind === KIND.TEXT_NOTE && (name === 'a' || name === 'A')) {
      addPointer(out, seen, { kind: 'addr', addr: v });
    }
  }
  return out;
}

export function embedPointersFromContent(event: Event): EmbedPointer[] {
  const out: EmbedPointer[] = [];
  const seen = new Set<string>();
  for (const part of splitNostrRefs(event.content ?? '')) {
    if (part.type !== 'ref') continue;
    if (part.kind === 'naddr' && part.naddr) {
      addPointer(out, seen, {
        kind: 'addr',
        addr: `${part.naddr.kind}:${part.naddr.pubkey}:${part.naddr.identifier}`
      });
    } else if ((part.kind === 'nevent' || part.kind === 'note') && part.id) {
      addPointer(out, seen, { kind: 'id', id: part.id.toLowerCase() });
    }
  }
  return out;
}

export async function resolveEmbedPointer(pointer: EmbedPointer): Promise<Event | null> {
  if (pointer.kind === 'id') return fetchById(pointer.id);
  return fetchByAddress(pointer.addr);
}
