import type { Event } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { buildComposePartial } from './compose-build';
import { KIND } from './constants';
import { eventAddress } from './nostr/verify';
import { isWikiOrSpecKind } from './wiki-fork';

/** Build a replaceable deference event targeting `preferred` (same kind + d). */
export function wikiDeferPublishDraft(preferred: Event): {
  kind: number;
  content: string;
  tags: string[][];
} | null {
  if (!isWikiOrSpecKind(preferred.kind)) return null;
  const d = preferred.tags.find((t) => t[0] === 'd')?.[1]?.trim();
  if (!d) return null;
  const coordinate = eventAddress(preferred);
  let naddr: string;
  try {
    naddr = nip19.naddrEncode({
      kind: preferred.kind,
      pubkey: preferred.pubkey.toLowerCase(),
      identifier: d
    });
  } catch {
    return null;
  }
  return buildComposePartial({
    kind: preferred.kind,
    content: `Read nostr:${naddr} instead.`,
    values: {
      d,
      title: preferred.tags.find((t) => t[0] === 'title')?.[1]?.trim() ?? '',
      defer_a: coordinate,
      defer_e: preferred.id.toLowerCase()
    }
  });
}

export function canDeferToWikiEvent(
  event: Event,
  viewerPubkey: string | null | undefined
): boolean {
  if (!isWikiOrSpecKind(event.kind)) return false;
  const pk = (viewerPubkey ?? '').trim().toLowerCase();
  if (!pk || !/^[0-9a-f]{64}$/.test(pk)) return false;
  return event.pubkey.toLowerCase() !== pk;
}
