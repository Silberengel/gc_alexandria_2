import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { blurbMarkupForKind, cardBlurb } from './card-blurb';
import { looksLikeNativeAsciidoc } from './markup';
import { kindDescription, kindLabelLine } from './kind-label';
import { parseKind0 } from './profile-fields';

export const PREVIEW_TITLE_MAX = 100;
export const PREVIEW_BODY_MAX = 250;

export type EventPreview = {
  /** Display headline — only from a `title` tag, else the kind label. */
  headline: string;
  kindLine: string;
  topics: string[];
  summary?: string;
  body?: string;
  imageUrls: string[];
};

function joinRest(tag: string[]): string {
  return tag.slice(1).join(' ').trim();
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

function looksLikeJsonObject(text: string): boolean {
  const t = text.trim();
  return t.startsWith('{') && t.endsWith('}');
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  if (!looksLikeJsonObject(text)) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function strField(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim() && !looksLikeJsonObject(v)) return v.trim();
  }
  return '';
}

/** Never surface raw JSON blobs as card text. */
export function humanReadableText(text: string): string {
  const t = text.trim();
  if (!t || looksLikeJsonObject(t)) return '';
  return t;
}

/** Plaintext for cards: strip AsciiDoc/Markdown, collapse whitespace, crop. */
export function plainCardText(text: string, kind: number, max: number): string {
  const raw = humanReadableText(text);
  if (!raw) return '';
  const markup = looksLikeNativeAsciidoc(raw) ? 'asciidoc' : blurbMarkupForKind(kind);
  return cardBlurb(raw, { markup, max });
}

/**
 * Structured preview for search / listing cards (unknown kinds and notes).
 * Title is only an explicit `title` tag. Content stays in the body.
 */
export function eventPreview(event: Event): EventPreview {
  const topics: string[] = [];
  const imageUrls: string[] = [];
  let title: string | undefined;
  const summaryParts: string[] = [];
  const descriptionParts: string[] = [];
  const tagContentParts: string[] = [];

  for (const tag of event.tags) {
    const name = tag[0];
    if (name === 't' && tag[1]?.trim()) {
      topics.push(tag[1].trim());
      continue;
    }
    if (name === 'title') {
      const j = joinRest(tag);
      if (j) title = title ? `${title} ${j}` : j;
      continue;
    }
    if (name === 'summary') {
      const j = joinRest(tag);
      if (j) summaryParts.push(j);
      continue;
    }
    if (name === 'description') {
      const j = joinRest(tag);
      if (j) descriptionParts.push(j);
      continue;
    }
    if ((name === 'image' || name === 'thumb' || name === 'banner') && tag[1] && isHttpUrl(tag[1])) {
      const u = tag[1].trim();
      if (!imageUrls.includes(u)) imageUrls.push(u);
      continue;
    }
    if (name === 'content') {
      const j = humanReadableText(joinRest(tag));
      if (j) tagContentParts.push(j);
    }
  }

  let summary = summaryParts.join(' ').trim() || descriptionParts.join(' ').trim() || undefined;
  const tagContent = tagContentParts.join(' ').trim();
  let rawBody = humanReadableText(event.content);
  const json = parseJsonObject(event.content);
  let profileName = '';

  if (event.kind === KIND.METADATA || json) {
    if (event.kind === KIND.METADATA) {
      const fields = parseKind0(event);
      if (!summary && fields.about) summary = fields.about;
      profileName = fields.title;
      if (fields.picture && isHttpUrl(fields.picture) && !imageUrls.includes(fields.picture)) {
        imageUrls.unshift(fields.picture);
      }
      rawBody = '';
    } else if (json) {
      if (!summary) {
        summary =
          strField(json, 'summary', 'description', 'about', 'content', 'text') || undefined;
      }
      profileName = strField(json, 'name', 'display_name', 'displayName');
      const pic = strField(json, 'picture', 'image', 'thumb', 'banner');
      if (pic && isHttpUrl(pic) && !imageUrls.includes(pic)) imageUrls.unshift(pic);
      rawBody = '';
    }
  }

  const headline = title
    ? plainCardText(title, event.kind, PREVIEW_TITLE_MAX)
    : kindDescription(event.kind);

  const kindLine = kindLabelLine(event.kind);
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

  let body: string | undefined;
  const candidates = [
    tagContent,
    rawBody,
    summary ?? '',
    profileName && !title ? profileName : ''
  ].filter(Boolean);
  for (const c of candidates) {
    const plain = plainCardText(c, event.kind, PREVIEW_BODY_MAX);
    if (!plain) continue;
    if (norm(plain) === norm(headline)) continue;
    body = plain;
    break;
  }

  const summaryPlain = summary ? plainCardText(summary, event.kind, PREVIEW_BODY_MAX) : '';
  const outSummary =
    summaryPlain &&
    norm(summaryPlain) !== norm(headline) &&
    norm(summaryPlain) !== norm(body ?? '')
      ? summaryPlain
      : undefined;

  return {
    headline,
    kindLine,
    topics: [...new Set(topics)].slice(0, 8),
    summary: outSummary,
    body,
    imageUrls: imageUrls.slice(0, 4)
  };
}
