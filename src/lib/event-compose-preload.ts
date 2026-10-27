import type { Event } from 'nostr-tools';
import { composerFieldSpecs, isCatalogued } from '@silberengel/kind-compose-catalog';
import { formatAuthors, type AuthorEntry } from './compose-publication-authors';
import type { ComposeDraftState } from './compose-drafts';
import { COMPOSE_PICKER_EXCLUDED } from './compose-presets';

const ALWAYS_SKIP = new Set([
  'client',
  'published_at',
  'imeta',
  't' // owned by hashtags UI
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
        for (const name of field.produces ?? []) consumed.add(name);
        continue;
      }
      if (field.emit === 'publication_author') {
        const v = publicationAuthorField(event);
        if (v) values[field.id] = v;
        for (const name of field.produces ?? ['author', 'N']) consumed.add(name);
        continue;
      }
      if (field.emit === 'publication_language') {
        const v = publicationLanguageField(event);
        if (v) values[field.id] = v;
        for (const name of field.produces ?? ['l', 'L']) consumed.add(name);
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
        for (const name of field.produces ?? ['a', 'e']) consumed.add(name);
        continue;
      }
      for (const name of field.produces ?? []) consumed.add(name);
    }
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
      return true;
    })
    .map((t) => [...t]);

  return {
    kind: event.kind,
    content: event.content ?? '',
    values,
    hashtags,
    imetaTags,
    freeformTags,
    updatedAt: Date.now()
  };
}

const COPY_EXCLUDED = new Set<number>([
  ...COMPOSE_PICKER_EXCLUDED,
  1010,
  818,
  819,
  30817,
  30818,
  30819
]);

/** Kinds we offer “Copy this event” for (compose-capable, not pure actions). */
export function canCopyEventToCompose(kind: number): boolean {
  if (COPY_EXCLUDED.has(kind)) return false;
  return isCatalogued(kind) || kind === 0 || kind === 1;
}

/** Wiki / spec articles can be forked (others) or replaced (own). */
export function canForkWikiEvent(kind: number): boolean {
  return kind === 30817 || kind === 30818;
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
  const pk = (viewerPubkey ?? '').trim().toLowerCase();
  if (!pk || !/^[0-9a-f]{64}$/.test(pk)) return false;
  return event.pubkey.toLowerCase() === pk;
}

/** Own kind-1 notes get “Edit this event” → NIP-41 kind 1010. */
export function canEditAsShortNote(event: Event, viewerPubkey: string | null | undefined): boolean {
  if (event.kind !== 1) return false;
  const pk = (viewerPubkey ?? '').trim().toLowerCase();
  if (!pk || !/^[0-9a-f]{64}$/.test(pk)) return false;
  return event.pubkey.toLowerCase() === pk;
}
