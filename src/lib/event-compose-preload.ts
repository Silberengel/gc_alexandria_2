import type { Event } from 'nostr-tools';
import {
  composerFieldSpecs,
  highlightSourceRef,
  isCatalogued,
  readNip54Pointer
} from '@silberengel/kind-compose-catalog';
import { directoryMembersRawFromTags } from './compose-directory-members';
import { mutedRawFromTags } from './compose-mute-list';
import { authorsRawFromTags } from './compose-people-list';
import { formatAuthors, type AuthorEntry } from './compose-publication-authors';
import type { ComposeDraftState } from './compose-drafts';
import { COMPOSE_PICKER_EXCLUDED } from './compose-presets';
import { KIND } from './constants';
import {
  CONTENT_WARNING_DEFAULT_LABEL,
  CONTENT_WARNING_TAG,
  contentWarningLabel,
  isContentWarningTagName
} from './content-warning';
import { markupFromTags } from './markup';
import {
  ensureMinPollOptionRows,
  isPollTagName,
  pollComposeFieldsFromEvent
} from './poll';

const ALWAYS_SKIP = new Set([
  'client',
  'published_at',
  'imeta',
  't', // owned by hashtags UI
  'm', // owned by markup picker / draft.markup
  CONTENT_WARNING_TAG, // owned by content-warning UI
  'option',
  'polltype',
  'endsAt',
  'relay'
]);

/** Thread / pointer tags dropped when cloning a regular note (imwald clone parity). */
const KIND1_SKIP = new Set(['e', 'E', 'p', 'P', 'a', 'A', 'q']);

function tagValue(event: Event, name: string): string {
  return event.tags.find((t) => t[0] === name)?.[1]?.trim() ?? '';
}

function tagValues(event: Event, name: string): string[] {
  return event.tags
    .filter((t) => t[0] === name)
    .map((t) => (t[1] ?? '').trim())
    .filter(Boolean);
}

function publicationAuthorField(event: Event): string {
  const entries: AuthorEntry[] = event.tags
    .filter((t) => t[0] === 'author')
    .map((t) => ({
      name: (t[1] ?? '').trim(),
      role: (t[2] ?? '').trim() || null
    }))
    .filter((e) => e.name);
  return formatAuthors(entries);
}

function publicationLanguageField(event: Event): string {
  return tagValue(event, 'L') || tagValue(event, 'l');
}

function publicationIdentifiersField(event: Event): string {
  return tagValues(event, 'i').join('\n');
}

function publicationSectionsField(event: Event): string {
  // Prefer a-tag addresses; fall back to e ids (imwald section rows).
  const rows: string[] = [];
  for (const t of event.tags) {
    if (t[0] === 'a' && t[1]) rows.push(t[1].trim());
    else if (t[0] === 'e' && t[1] && t[3] !== 'root' && t[3] !== 'reply') {
      /* keep bare e only when no a-tags yet — publications usually use a */
    }
  }
  if (rows.length) return rows.join('\n');
  return event.tags
    .filter((t) => t[0] === 'e' && t[1])
    .map((t) => t[1]!.trim())
    .filter(Boolean)
    .join('\n');
}

/** Reverse of catalog `spec_k_tags` emit (`k` / `k name`). */
function specKindsField(event: Event): string {
  return event.tags
    .filter((t) => t[0] === 'k' && t[1])
    .map((t) => {
      const kindNum = t[1]!.trim();
      const name = (t[2] ?? '').trim();
      return name ? `${kindNum} ${name}` : kindNum;
    })
    .filter(Boolean)
    .join('\n');
}

/** Reverse of relay_list / relay_list_rw / bare relays textarea. */
function relayListField(event: Event): string {
  return event.tags
    .filter((t) => {
      const name = t[0] ?? '';
      return name === 'r' || name === 'relay' || name === 'server';
    })
    .map((t) => t.slice(1).join(' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Reverse of server_list (BUD-03 Blossom) — one URL per line. */
function serverListField(event: Event): string {
  return event.tags
    .filter((t) => t[0] === 'server' && t[1]?.trim())
    .map((t) => t[1]!.trim())
    .filter(Boolean)
    .join('\n');
}

/** Reverse of payto_list (`type authority` or payto URI). */
function paytoListField(event: Event): string {
  return event.tags
    .filter((t) => t[0] === 'payto' && t[1])
    .map((t) => t.slice(1).join(' ').trim())
    .filter(Boolean)
    .join('\n');
}

function pointerListLines(event: Event, name: 'e' | 'a'): string[] {
  const lines: string[] = [];
  for (const t of event.tags) {
    if (t[0] !== name || !t[1]?.trim()) continue;
    const value = t[1].trim();
    const relay = (t[2] ?? '').trim();
    lines.push(relay ? `${value}|${relay}` : value);
  }
  return lines;
}

/** Reverse of e_list (one id per line, optional `|relay`). */
function eListField(event: Event): string {
  return pointerListLines(event, 'e').join('\n');
}

/** Reverse of a_list (one coordinate per line, optional `|relay`). */
function aListField(event: Event): string {
  return pointerListLines(event, 'a').join('\n');
}

/**
 * Reverse of bookmark_list. Catalog emit currently builds `e` only; still surface
 * `a` coordinates so Clone/Replace does not drop article bookmarks from the form.
 */
function bookmarkListField(event: Event): string {
  return [...pointerListLines(event, 'e'), ...pointerListLines(event, 'a')].join('\n');
}

/** Reverse of highlight_source (HTTP / e / a). */
function highlightSourceField(event: Event): string {
  const ref = highlightSourceRef(event);
  if (!ref) return '';
  if (ref.type === 'http') return ref.url;
  if (ref.type === 'event') return ref.eventId;
  return ref.coordinate;
}

/** Reverse of web_comment_scope (NIP-22/73 `I` / `i`). */
function webCommentUrlField(event: Event): string {
  return tagValue(event, 'I') || tagValue(event, 'i');
}

function applyNip54PointerFields(event: Event, values: Record<string, string>): void {
  for (const marker of ['fork', 'defer'] as const) {
    const ref = readNip54Pointer(event, marker);
    if (!ref) continue;
    if (ref.coordinate) values[`${marker}_a`] = ref.coordinate;
    if (ref.eventId) values[`${marker}_e`] = ref.eventId;
  }
}

function isNip54ForkDeferTag(tag: string[]): boolean {
  const name = tag[0] ?? '';
  if (name !== 'a' && name !== 'e') return false;
  const marker = (tag[3] ?? '').trim();
  return marker === 'fork' || marker === 'defer';
}

function consumeProduces(
  consumed: Set<string>,
  field: { produces?: string[] },
  fallback: string[] = []
): void {
  for (const name of field.produces ?? fallback) consumed.add(name);
}

/**
 * Map an existing event into compose draft fields for Copy / clone.
 * Does not copy id, sig, pubkey, or created_at — those are minted on publish.
 * Strips `client` (republish adds Alexandria) and `published_at`.
 */
export function eventToComposeDraft(event: Event): ComposeDraftState {
  const values: Record<string, string> = {};
  const consumed = new Set<string>(ALWAYS_SKIP);

  if (isCatalogued(event.kind)) {
    for (const field of composerFieldSpecs(event.kind)) {
      if (field.tag) {
        const v = tagValue(event, field.tag);
        if (v) values[field.id] = v;
        consumed.add(field.tag);
        consumeProduces(consumed, field);
        continue;
      }
      if (field.emit === 'publication_author') {
        const v = publicationAuthorField(event);
        if (v) values[field.id] = v;
        consumeProduces(consumed, field, ['author', 'N']);
        continue;
      }
      if (field.emit === 'publication_language') {
        const v = publicationLanguageField(event);
        if (v) values[field.id] = v;
        consumeProduces(consumed, field, ['l', 'L']);
        continue;
      }
      if (field.emit === 'publication_identifiers' || field.id === 'publication_identifiers') {
        const v = publicationIdentifiersField(event);
        if (v) values[field.id] = v;
        consumed.add('i');
        continue;
      }
      if (
        field.emit === 'publication_sections' ||
        field.id === 'sections' ||
        field.id === 'publication_sections'
      ) {
        const v = publicationSectionsField(event);
        if (v) values[field.id] = v;
        consumeProduces(consumed, field, ['a', 'e']);
        continue;
      }
      if (field.emit === 'spec_k_tags' || field.id === 'spec_kinds') {
        const v = specKindsField(event);
        if (v) values[field.id] = v;
        consumed.add('k');
        continue;
      }
      if (
        field.emit === 'relay_list' ||
        field.emit === 'relay_list_rw' ||
        field.id === 'relays'
      ) {
        const v = relayListField(event);
        if (v) values[field.id] = v;
        consumeProduces(consumed, field, ['r', 'relay', 'server']);
        continue;
      }
      if (field.emit === 'server_list' || field.id === 'servers') {
        const v = serverListField(event);
        if (v) values[field.id] = v;
        consumeProduces(consumed, field, ['server']);
        continue;
      }
      if (field.emit === 'payto_list' || field.id === 'payto') {
        const v = paytoListField(event);
        if (v) values[field.id] = v;
        consumeProduces(consumed, field, ['payto']);
        continue;
      }
      if (field.emit === 'e_list') {
        const v = eListField(event);
        if (v) values[field.id] = v;
        consumeProduces(consumed, field, ['e']);
        continue;
      }
      if (field.emit === 'a_list') {
        const v = aListField(event);
        if (v) values[field.id] = v;
        consumeProduces(consumed, field, ['a']);
        continue;
      }
      if (field.emit === 'bookmark_list') {
        const v = bookmarkListField(event);
        if (v) values[field.id] = v;
        consumeProduces(consumed, field, ['e', 'a', 't', 'r']);
        continue;
      }
      if (field.emit === 'p_list' || field.id === 'authors') {
        const v = authorsRawFromTags(event.tags);
        if (v) values[field.id] = v;
        consumed.add('p');
        continue;
      }
      if (field.emit === 'mute_list' || field.id === 'muted') {
        // Public tags only here — Compose hydrates private rows via loadComposePrivateContent.
        const v = mutedRawFromTags(event.tags, []);
        if (v) values[field.id] = v;
        consumeProduces(consumed, field, ['p', 'e', 'word', 't']);
        continue;
      }
      if (field.emit === 'directory_members' || field.id === 'members') {
        const v = directoryMembersRawFromTags(event.tags);
        if (v) values[field.id] = v;
        consumeProduces(consumed, field, ['a', 'e']);
        continue;
      }
      if (field.emit === 'highlight_source' || field.id === 'highlight_source') {
        const v = highlightSourceField(event);
        if (v) {
          values[field.id] = v;
          // Only own source pointers when we mapped one — leave unrelated tags freeform.
          consumeProduces(consumed, field, ['e', 'a', 'r']);
        }
        continue;
      }
      if (field.emit === 'web_comment_scope' || field.id === 'web_url') {
        const v = webCommentUrlField(event);
        if (v) {
          values[field.id] = v;
          // Web-scoped comments only — do not strip event-comment K/k/E/e.
          consumed.add('I');
          consumed.add('i');
        }
        continue;
      }
      // Unknown emit without a tag: do not consume produces (would hide tags from freeform).
    }
  }

  // members is catalog `widget: custom` (hidden from composerFieldSpecs) — still preload it.
  if (event.kind === KIND.DIRECTORY && !values.members) {
    const v = directoryMembersRawFromTags(event.tags);
    if (v) values.members = v;
    consumed.add('a');
    consumed.add('e');
  }

  if (event.kind === KIND.WIKI || event.kind === KIND.SPEC) {
    applyNip54PointerFields(event, values);
  }

  if (event.kind === 1) {
    for (const name of KIND1_SKIP) consumed.add(name);
  }

  const hashtags = tagValues(event, 't');
  const imetaTags = event.tags.filter((t) => t[0] === 'imeta').map((t) => [...t]);
  const freeformTags = event.tags
    .filter((t) => {
      const name = t[0] ?? '';
      if (!name || consumed.has(name)) return false;
      if (ALWAYS_SKIP.has(name)) return false;
      if (isContentWarningTagName(name)) return false;
      if (isPollTagName(name)) return false;
      // Fork/defer a|e already mapped into catalog fields.
      if (isNip54ForkDeferTag(t)) return false;
      return true;
    })
    .map((t) => [...t]);

  const warning = contentWarningLabel(event);
  const poll = pollComposeFieldsFromEvent(event);
  const taggedMarkup = markupFromTags(event.tags);
  const markup =
    taggedMarkup === 'djot' || taggedMarkup === 'asciidoc' ? taggedMarkup : undefined;

  return {
    kind: event.kind,
    content: event.content ?? '',
    values,
    hashtags,
    imetaTags,
    freeformTags,
    ...(markup ? { markup } : {}),
    contentWarningEnabled: warning != null,
    contentWarningLabel: warning ?? CONTENT_WARNING_DEFAULT_LABEL,
    pollOptions: ensureMinPollOptionRows(poll.options),
    pollMultipleChoice: poll.multipleChoice,
    pollEndsHours: poll.endsHours,
    updatedAt: Date.now()
  };
}

const COPY_EXCLUDED = new Set<number>([
  ...COMPOSE_PICKER_EXCLUDED,
  1010,
  818,
  819,
  30045, // directories: Replace from the menu, not generic Clone
  30817,
  30818,
  30819
]);

/** Kinds we offer “Clone this event” for (compose-capable, not pure actions). */
export function canCopyEventToCompose(kind: number): boolean {
  if (COPY_EXCLUDED.has(kind)) return false;
  return isCatalogued(kind) || kind === 0 || kind === 1;
}

/** Wiki / spec articles can be forked (others) or replaced (own). */
export function canForkWikiEvent(kind: number): boolean {
  return kind === 30817 || kind === 30818;
}

function isViewerPubkey(
  event: Event,
  viewerPubkey: string | null | undefined
): boolean {
  const pk = (viewerPubkey ?? '').trim().toLowerCase();
  if (!pk || !/^[0-9a-f]{64}$/.test(pk)) return false;
  return event.pubkey.toLowerCase() === pk;
}

/**
 * Own wiki/spec → compose Replace (same kind + pubkey + d).
 * Fork is only for someone else's article.
 */
export function canReplaceOwnWikiEvent(
  event: Event,
  viewerPubkey: string | null | undefined
): boolean {
  if (!canForkWikiEvent(event.kind)) return false;
  return isViewerPubkey(event, viewerPubkey);
}

/**
 * Own NKBIP-04 directories (30045) → compose Replace.
 * Kept out of the kind picker; offered only from the event menu.
 */
export function canReplaceOwnDirectoryEvent(
  event: Event,
  viewerPubkey: string | null | undefined
): boolean {
  if (event.kind !== 30045) return false;
  return isViewerPubkey(event, viewerPubkey);
}

/** Own kind-1 notes get “Edit this event” → NIP-41 kind 1010. */
export function canEditAsShortNote(event: Event, viewerPubkey: string | null | undefined): boolean {
  if (event.kind !== 1) return false;
  const pk = (viewerPubkey ?? '').trim().toLowerCase();
  if (!pk || !/^[0-9a-f]{64}$/.test(pk)) return false;
  return event.pubkey.toLowerCase() === pk;
}
