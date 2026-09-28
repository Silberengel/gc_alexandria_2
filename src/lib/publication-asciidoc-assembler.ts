import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { coverFullImageUrl } from './cover';
import { coverPlaceholderUrl, coverTitle } from './cover-fallback';
import {
  editionMetadata,
  formatAuthorLabel,
  type EditionMetadata,
  type PublicationIdentifier
} from './publication-metadata';
import { eventAddress, firstTag } from './nostr/verify';

const MAX_NEST_DEPTH = 8;
const TITLE_PAGE_COVER_WIDTH = 250;

export type AssembledPublicationAsciidoc = {
  content: string;
  title: string;
  author: string;
  image: string;
};

export type PublicationSectionRef =
  | {
      type: 'a';
      coordinate: string;
      kind: number;
      pubkey: string;
      identifier: string;
      relay?: string;
    }
  | { type: 'e'; eventId: string; relay?: string };

function escapeInline(value: string): string {
  return value.replace(/\n/g, ' ');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtmlAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function sanitizeLanguageCode(value: string | undefined): string | undefined {
  const first = value?.split(',')[0]?.trim();
  if (!first) return undefined;
  return /^[a-z]{2,3}(-[a-z0-9]+)*$/i.test(first) ? first : undefined;
}

function isHttpCover(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

type TitlePageRow = { label: string; value: string; href?: string };

function titlePageRows(metadata: EditionMetadata): TitlePageRow[] {
  const rows: TitlePageRow[] = [];
  if (metadata.version?.trim()) rows.push({ label: 'Edition', value: metadata.version.trim() });
  const type = metadata.type?.trim();
  if (type && type.toLowerCase() !== 'book') rows.push({ label: 'Type', value: type });
  const language = sanitizeLanguageCode(metadata.language);
  if (language) rows.push({ label: 'Language', value: language });
  if (metadata.releaseDate?.trim()) {
    rows.push({ label: 'Released', value: metadata.releaseDate.trim() });
  }
  const source = metadata.source?.trim();
  if (source) rows.push({ label: 'Source', value: source, href: source });
  for (const identifier of metadata.identifiers) {
    rows.push(...identifierRows(identifier));
  }
  if (metadata.subjects.length > 0) {
    rows.push({ label: 'Keywords', value: metadata.subjects.join(', ') });
  }
  return rows;
}

function identifierRows(identifier: PublicationIdentifier): TitlePageRow[] {
  if (identifier.scheme === 'openlibrary') {
    return [{ label: 'Open Library', value: identifier.id, href: identifier.url }];
  }
  if (identifier.scheme === 'isbn') {
    return [{ label: 'ISBN', value: identifier.id }];
  }
  if (identifier.scheme === 'wikidata') {
    return [{ label: 'Wikidata', value: identifier.id, href: identifier.url }];
  }
  if (identifier.scheme === 'goodreads') {
    return [{ label: 'Goodreads', value: identifier.id, href: identifier.url }];
  }
  return [{ label: 'Identifier', value: identifier.value, href: identifier.url }];
}

/**
 * Cover for export: original / Gutenberg plate when present, otherwise the generated
 * fantasy placeholder (same SVG the UI uses).
 */
export function exportCoverImageUrl(event: Event): string {
  return coverFullImageUrl(event)?.trim() || coverPlaceholderUrl(event);
}

function buildTitlePage(title: string, author: string, image: string, metadata: EditionMetadata): string[] {
  const rows = titlePageRows(metadata);
  const parts: string[] = [];
  const httpCover = image && isHttpCover(image) ? image : '';
  const anyCover = image.trim();

  parts.push('ifdef::backend-epub3[]');
  if (httpCover) {
    parts.push(`image::${httpCover}[Cover,${TITLE_PAGE_COVER_WIDTH}]`, '');
  } else if (anyCover) {
    // Data-URI / generated covers: HTML img avoids AsciiDoc attribute parsing issues.
    parts.push('++++');
    parts.push(
      `<div style="text-align:center;margin:0 0 1em;"><img src="${escapeHtmlAttr(anyCover)}" alt="Cover" style="max-width:${TITLE_PAGE_COVER_WIDTH}px;width:100%;height:auto;"/></div>`
    );
    parts.push('++++', '');
  }
  parts.push('++++');
  parts.push('<div style="text-align: center; margin: 1.5em 1em;">');
  parts.push(
    `<div style="font-size: 1.8em; font-weight: bold; line-height: 1.25;">${escapeHtml(title)}</div>`
  );
  if (author) {
    parts.push(
      `<div style="font-style: italic; font-size: 1.1em; margin-top: 0.5em;">by ${escapeHtml(author)}</div>`
    );
  }
  if (rows.length > 0) {
    parts.push(
      '<hr style="width: 35%; max-width: 12em; border: 0; border-top: 1px solid #999; margin: 1.5em auto;"/>'
    );
    parts.push('<div style="font-size: 0.95em; line-height: 1.7;">');
    parts.push(
      rows
        .map((row) => {
          const value = row.href
            ? `<a href="${escapeHtmlAttr(row.href)}">${escapeHtml(row.value)}</a>`
            : escapeHtml(row.value);
          return `<span style="color: #555;">${escapeHtml(row.label)}:</span> ${value}`;
        })
        .join('<br/>\n')
    );
    parts.push('</div>');
  }
  parts.push('</div>');
  parts.push('++++');
  parts.push('endif::[]');
  parts.push('');

  parts.push('ifndef::backend-epub3[]');
  if (httpCover) {
    parts.push(`image::${httpCover}[Cover,${TITLE_PAGE_COVER_WIDTH},align=center]`, '');
  } else if (anyCover) {
    parts.push('++++');
    parts.push(
      `<div style="text-align:center;margin:0 0 1em;"><img src="${escapeHtmlAttr(anyCover)}" alt="Cover" style="max-width:${TITLE_PAGE_COVER_WIDTH}px;width:100%;height:auto;"/></div>`
    );
    parts.push('++++', '');
  }
  for (const row of rows) {
    parts.push(`${escapeInline(row.label)}:: ${escapeInline(row.value)}`);
  }
  if (rows.length > 0) parts.push('');
  parts.push('endif::[]');
  parts.push('');

  return parts;
}

function heading(level: number, title: string): string {
  const marks = '='.repeat(Math.max(2, Math.min(6, level)));
  return `${marks} ${escapeInline(title)}\n\n`;
}

function authorFromMetadata(metadata: EditionMetadata, pubkey: string): string {
  if (metadata.authors.length > 0) {
    return metadata.authors.map(formatAuthorLabel).join('; ');
  }
  return pubkey;
}

/** Ordered lowercase `a` / `e` section refs (NKBIP-01). Uppercase `A` / `E` are originals. */
export function orderedPublicationRefsFromIndex(event: Event): PublicationSectionRef[] {
  const refs: PublicationSectionRef[] = [];
  for (const tag of event.tags) {
    const rawName = (tag[0] || '').trim();
    if (rawName === 'a' && tag[1]) {
      const coordinate = tag[1].trim();
      const parts = coordinate.split(':');
      if (parts.length < 3) continue;
      const kind = Number(parts[0]);
      if (!Number.isInteger(kind)) continue;
      refs.push({
        type: 'a',
        coordinate,
        kind,
        pubkey: parts[1]!,
        identifier: parts.slice(2).join(':'),
        relay: tag[2]
      });
    } else if (rawName === 'e' && tag[1]) {
      refs.push({ type: 'e', eventId: tag[1].trim(), relay: tag[2] });
    }
  }
  return refs;
}

function resolveRefEvent(
  ref: PublicationSectionRef,
  fetched: Map<string, Event>,
  eventsByAddress: Map<string, Event>
): Event | undefined {
  if (ref.type === 'a') {
    return eventsByAddress.get(ref.coordinate) ?? fetched.get(ref.coordinate);
  }
  return fetched.get(ref.eventId);
}

function appendIndexBody(
  index: Event,
  eventsByAddress: Map<string, Event>,
  fetched: Map<string, Event>,
  headingLevel: number,
  parts: string[]
): void {
  if (headingLevel > MAX_NEST_DEPTH + 1) return;

  for (const ref of orderedPublicationRefsFromIndex(index)) {
    if (ref.type === 'a') {
      if (ref.kind === KIND.PUBLICATION) {
        const child = eventsByAddress.get(ref.coordinate) ?? resolveRefEvent(ref, fetched, eventsByAddress);
        if (!child) continue;

        const sectionTitle = coverTitle(child);
        if (sectionTitle) parts.push(heading(headingLevel, sectionTitle));

        const indexContent = child.content.trim();
        if (indexContent) parts.push(`${indexContent}\n\n`);

        appendIndexBody(child, eventsByAddress, fetched, headingLevel + 1, parts);
      } else if (
        ref.kind === KIND.SECTION ||
        ref.kind === KIND.WIKI ||
        ref.kind === KIND.SPEC ||
        ref.kind === KIND.LONG_FORM
      ) {
        const article = resolveRefEvent(ref, fetched, eventsByAddress);
        if (!article) continue;

        let sectionTitle = firstTag(article, 'title')?.trim() || ref.identifier || '';
        if (!sectionTitle) sectionTitle = ref.coordinate.split(':').slice(2).join(':');
        if (sectionTitle) parts.push(heading(headingLevel, sectionTitle));

        const body = article.content.trim();
        if (body) parts.push(`${body}\n\n`);
      }
    } else {
      const article = resolveRefEvent(ref, fetched, eventsByAddress);
      if (!article) continue;
      const sectionTitle = firstTag(article, 'title')?.trim() || 'Section';
      parts.push(heading(headingLevel, sectionTitle));
      const body = article.content.trim();
      if (body) parts.push(`${body}\n\n`);
    }
  }
}

/** Build a single AsciiDoc book document from a publication index + nested events. */
export function assemblePublicationAsciidoc(
  rootIndex: Event,
  fetched: Map<string, Event>,
  eventsByAddress: Map<string, Event>
): AssembledPublicationAsciidoc {
  const metadata = editionMetadata(rootIndex);
  const title = metadata.titles[0]?.trim() || coverTitle(rootIndex) || 'Publication';
  const author = authorFromMetadata(metadata, rootIndex.pubkey);
  const image = exportCoverImageUrl(rootIndex);
  const version = metadata.version?.trim() || firstTag(rootIndex, 'V')?.trim() || 'first edition';

  const header: string[] = [`= ${escapeInline(title)}`];
  if (author) header.push(escapeInline(author));
  header.push(':doctype: book');
  header.push(':allow-uri-read:');
  header.push(':toc:');
  header.push(':toclevels: 2');
  header.push(':stem:');
  header.push(':page-break-mode: auto');
  header.push(':sectnums!:');
  header.push(':imagesdir:');
  header.push(':image-width: 1000px');
  header.push(':max-width: 1000px');
  if (author) header.push(`:author: ${escapeInline(author)}`);
  header.push(`:version: ${escapeInline(version)}`);
  header.push(`:revnumber: ${escapeInline(version)}`);
  if (metadata.releaseDate?.trim()) {
    header.push(`:revdate: ${escapeInline(metadata.releaseDate.trim())}`);
  }
  if (metadata.source?.trim()) {
    header.push(`:source: ${escapeInline(metadata.source.trim())}`);
  }
  if (metadata.type?.trim()) {
    header.push(`:publication-type: ${escapeInline(metadata.type.trim())}`);
  }
  const language = sanitizeLanguageCode(metadata.language);
  if (language) {
    header.push(`:lang: ${escapeInline(language)}`);
  }
  if (metadata.subjects.length > 0) {
    header.push(`:keywords: ${escapeInline(metadata.subjects.join(', '))}`);
  }
  const isbn = metadata.identifiers.find((id) => id.scheme === 'isbn');
  if (isbn) {
    header.push(`:isbn: ${escapeInline(isbn.id)}`);
    header.push(`:identifier: urn:isbn:${escapeInline(isbn.id)}`);
  } else {
    const openlibrary = metadata.identifiers.find((id) => id.scheme === 'openlibrary');
    if (openlibrary) {
      header.push(`:identifier: openlibrary:${escapeInline(openlibrary.id)}`);
    } else if (metadata.identifiers[0]) {
      header.push(`:identifier: ${escapeInline(metadata.identifiers[0].value)}`);
    }
  }
  for (const identifier of metadata.identifiers) {
    if (identifier.scheme === 'openlibrary') {
      header.push(`:openlibrary: ${escapeInline(identifier.id)}`);
    } else if (identifier.scheme === 'wikidata') {
      header.push(`:wikidata: ${escapeInline(identifier.id)}`);
    } else if (identifier.scheme === 'goodreads') {
      header.push(`:goodreads: ${escapeInline(identifier.id)}`);
    }
  }
  // asciidoctor-epub3 / PDF front cover — only remote URLs (data URIs break attribute parsing).
  if (image && isHttpCover(image)) {
    header.push(`:front-cover-image: image:${image}[]`);
  }

  const bodyParts: string[] = [];
  bodyParts.push(...buildTitlePage(title, author, image, metadata));
  if (metadata.summary?.trim()) {
    bodyParts.push('[abstract]', '____', metadata.summary.trim(), '____', '');
  }

  appendIndexBody(rootIndex, eventsByAddress, fetched, 2, bodyParts);

  const content = `${header.join('\n')}\n\n${bodyParts.join('\n')}`.trimEnd() + '\n';

  return { content, title, author, image };
}

/** Register events into id + address maps for assembly. */
export function indexPublicationEvents(target: Map<string, Event>, events: Iterable<Event>): void {
  for (const event of events) {
    if (event.id) target.set(event.id, event);
    const addr = eventAddress(event);
    if (addr) target.set(addr, event);
  }
}
