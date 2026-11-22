/**
 * Compose-facing load/seal for NIP-51 private `.content` (mute, contacts, …).
 * Built on {@link decryptPrivateTagsDetailed} / {@link contentForPrivateTags}.
 */
import type { Event } from 'nostr-tools';
import { mutedRawFromTags } from './compose-mute-list';
import { KIND } from './constants';
import {
  contentForPrivateTags,
  decryptPrivateTagsDetailed
} from './private-tags';

export type ComposePrivateContent = {
  /** Decrypted private tag rows (mute Priv, etc.). */
  privateTags: string[][];
  /** Opaque previous `.content` when decrypt failed — must survive republish. */
  previousCipher: string;
  couldDecrypt: boolean;
  /**
   * Contact lists (and similar): form only edits public tags; always pass through
   * previous `.content` on seal when `nextPrivateTags` is empty.
   */
  passthrough: boolean;
};

export function emptyComposePrivateContent(
  overrides: Partial<ComposePrivateContent> = {}
): ComposePrivateContent {
  return {
    privateTags: [],
    previousCipher: '',
    couldDecrypt: true,
    passthrough: false,
    ...overrides
  };
}

/** Kinds whose Compose form needs async private-content hydrate. */
export function needsPrivateContentHydrate(kind: number): boolean {
  return (
    kind === KIND.MUTE ||
    kind === KIND.CONTACT_LIST ||
    kind === KIND.PRIVATE_RELAY_LIST
  );
}

/**
 * Decrypt private tag rows from an event for Compose.
 * On decrypt failure, keeps the ciphertext so seal can preserve it.
 */
export async function loadComposePrivateContent(
  event: Event
): Promise<ComposePrivateContent> {
  const detailed = await decryptPrivateTagsDetailed(event);
  return emptyComposePrivateContent({
    privateTags: detailed.tags,
    previousCipher: detailed.couldDecrypt ? '' : (event.content ?? ''),
    couldDecrypt: detailed.couldDecrypt,
    passthrough: false
  });
}

/**
 * Opaque preserve of `.content` for kinds that only edit public tags in Compose
 * (contact lists).
 */
export function loadComposePrivatePassthrough(event: Event): ComposePrivateContent {
  return emptyComposePrivateContent({
    privateTags: [],
    previousCipher: event.content ?? '',
    couldDecrypt: true,
    passthrough: true
  });
}

/**
 * Encrypt next private tags (or preserve undecryptable / passthrough ciphertext).
 */
export async function sealComposePrivateContent(
  bag: ComposePrivateContent | null | undefined,
  nextPrivateTags: string[][]
): Promise<string> {
  const tags = nextPrivateTags.filter((t) => t[0]);
  if (bag?.passthrough && !tags.length) {
    return bag.previousCipher;
  }
  return contentForPrivateTags({
    privateTags: tags,
    previousContent: bag?.previousCipher ?? '',
    couldDecryptPrevious: bag?.couldDecrypt ?? true,
    allowPlaintextFallback: true
  });
}

/** Merge public + private mute tags into the Compose `muted` field value. */
export function mutedFieldFromEvent(event: Event, privateTags: string[][]): string {
  return mutedRawFromTags(event.tags, privateTags);
}

/** Private tag rows from mute field payload JSON (empty when none). */
export function privateTagsFromMutePayload(privateJson: string): string[][] {
  const trimmed = privateJson.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is string[] => Array.isArray(row) && typeof row[0] === 'string'
    );
  } catch {
    return [];
  }
}
