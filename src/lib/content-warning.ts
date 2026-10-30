/**
 * NIP-36 content warnings — imwald / Jumble parity.
 * Tag name: `content-warning` with an optional human label.
 */
import type { Event } from 'nostr-tools';

export const CONTENT_WARNING_TAG = 'content-warning';
export const CONTENT_WARNING_DEFAULT_LABEL = 'NSFW';
export const CONTENT_WARNING_MAX_LABEL_LENGTH = 80;

export const CONTENT_WARNING_PRESETS = [
  CONTENT_WARNING_DEFAULT_LABEL,
  'Violence',
  'Trigger warning',
  'Sensitive content',
  'Spoilers'
] as const;

export type ContentWarningPreset = (typeof CONTENT_WARNING_PRESETS)[number];

export function isContentWarningTagName(name: string | undefined | null): boolean {
  return (name ?? '').trim().toLowerCase() === CONTENT_WARNING_TAG;
}

/** Label on the event, or null when there is no content warning. */
export function contentWarningLabel(event: Pick<Event, 'tags'>): string | null {
  for (const tag of event.tags) {
    if (!isContentWarningTagName(tag[0])) continue;
    const label = (tag[1] ?? '').trim();
    return label || CONTENT_WARNING_DEFAULT_LABEL;
  }
  if (
    event.tags.some(
      (t) =>
        (t[0] ?? '').trim().toLowerCase() === 't' &&
        (t[1] ?? '').trim().toLowerCase() === 'nsfw'
    )
  ) {
    return CONTENT_WARNING_DEFAULT_LABEL;
  }
  return null;
}

export function isContentWarned(event: Pick<Event, 'tags'>): boolean {
  return contentWarningLabel(event) != null;
}

export function normalizeContentWarningLabel(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return CONTENT_WARNING_DEFAULT_LABEL;
  return trimmed.slice(0, CONTENT_WARNING_MAX_LABEL_LENGTH);
}

export function buildContentWarningTag(label?: string | null): string[] {
  return [CONTENT_WARNING_TAG, normalizeContentWarningLabel(label)];
}

/** Drop existing content-warning rows, then append when enabled. */
export function appendContentWarningTag(
  tags: string[][],
  enabled: boolean,
  label?: string | null
): string[][] {
  const out = tags.filter((t) => !isContentWarningTagName(t[0]));
  if (enabled) out.push(buildContentWarningTag(label));
  return out;
}

/** Display heading for a gate UI (imwald parity). */
export function contentWarningHeading(label: string): string {
  if (label.trim().toLowerCase() === CONTENT_WARNING_DEFAULT_LABEL.toLowerCase()) {
    return '🔞 NSFW 🔞';
  }
  return label.trim() || CONTENT_WARNING_DEFAULT_LABEL;
}
