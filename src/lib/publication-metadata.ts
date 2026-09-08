import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { coverImageUrl } from './cover';
import { humanizeTag } from './cover-fallback';
import { indexSlug } from './dtag';
import { firstTag, tagValue } from './nostr/verify';

export type PublicationAuthor = {
  name: string;
  role?: string;
  /** Search slug for /search?author= */
  slug: string;
};

export type IdentifierScheme =
  | 'openlibrary'
  | 'isbn'
  | 'wikidata'
  | 'overdrive'
  | 'wikipedia'
  | 'gutenberg'
  | 'goodreads'
  | 'other';

export type PublicationIdentifier = {
  value: string;
  scheme: IdentifierScheme;
  id: string;
  label: string;
  url?: string;
};

/** Chip for source URL or an `i` identifier on the edition header. */
export type ProvenanceChip = {
  label: string;
  /** External URL when the chip should leave the site. */
  href?: string;
  /** Raw identifier for /search?identifier= (preferred over href when set). */
  search?: string;
  /** ISBN digits to copy instead of navigating. */
  copyText?: string;
};

export type EditionMetadata = {
  titles: string[];
  authors: PublicationAuthor[];
  subjects: string[];
  summary?: string;
  image?: string;
  source?: string;
  type?: string;
  version?: string;
  releaseDate?: string;
  language?: string;
  /** Imprint string from `published_by` (not the Nostr signer). */
  publishedBy?: string;
  identifiers: PublicationIdentifier[];
  sectionCount: number;
  provenance: ProvenanceChip[];
};

function titleCaseWords(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function formatPublicationType(type: string): string {
  return titleCaseWords(type);
}

export function formatAuthorLabel(author: PublicationAuthor): string {
  const role = author.role?.trim().toLowerCase();
  if (!role || role === 'author') return author.name;
  return `${author.name} (${author.role!.trim()})`;
}

export function resolveIdentifierUrl(value: string): string | undefined {
  const trimmed = value.trim();
  const colon = trimmed.indexOf(':');
  if (colon <= 0) return undefined;
  const scheme = trimmed.slice(0, colon).toLowerCase();
  const id = trimmed.slice(colon + 1).trim();
  if (!id) return undefined;

  switch (scheme) {
    case 'openlibrary':
      return id.startsWith('OL') ? `https://openlibrary.org/works/${id}` : `https://openlibrary.org/${id}`;
    case 'isbn':
      return undefined;
    case 'wikidata':
      return `https://www.wikidata.org/wiki/${id}`;
    case 'overdrive':
      return `https://share.libbyapp.com/title/${encodeURIComponent(id)}`;
    case 'gutenberg': {
      const ebookId = id.replace(/[^\d]/g, '');
      return ebookId ? `https://www.gutenberg.org/ebooks/${ebookId}` : undefined;
    }
    case 'goodreads': {
      const bookId = id.replace(/[^\d]/g, '');
      return bookId ? `https://www.goodreads.com/book/show/${bookId}` : undefined;
    }
    case 'wikipedia': {
      const m = /^([a-z]{2,3}):(.+)$/i.exec(id);
      if (!m) return undefined;
      const lang = m[1]!.toLowerCase();
      const page = m[2]!.trim().replace(/ /g, '_');
      if (!page) return undefined;
      return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page).replace(/%2F/gi, '/')}`;
    }
    default:
      return undefined;
  }
}

export function parsePublicationIdentifier(raw: string, urlHint?: string): PublicationIdentifier | null {
  const value = raw.trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value) || /^www\./i.test(value)) {
    const href = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    let label = href;
    try {
      label = new URL(href).hostname.replace(/^www\./, '');
    } catch {
      /* keep href */
    }
    return { value, scheme: 'other', id: value, label, url: href };
  }

  const colon = value.indexOf(':');
  const schemeRaw = colon > 0 ? value.slice(0, colon).toLowerCase() : 'other';
  const id = colon > 0 ? value.slice(colon + 1).trim() : value;
  if (!id) return null;

  const known: IdentifierScheme[] = [
    'openlibrary',
    'isbn',
    'wikidata',
    'overdrive',
    'wikipedia',
    'gutenberg',
    'goodreads'
  ];
  const scheme: IdentifierScheme = (known as string[]).includes(schemeRaw)
    ? (schemeRaw as IdentifierScheme)
    : 'other';

  let label = value;
  if (scheme === 'openlibrary') label = 'Open Library';
  else if (scheme === 'isbn') label = `ISBN ${id}`;
  else if (scheme === 'wikidata') label = 'Wikidata';
  else if (scheme === 'overdrive') label = 'Borrow in Libby';
  else if (scheme === 'gutenberg') label = `Gutenberg #${id.replace(/[^\d]/g, '')}`;
  else if (scheme === 'goodreads') label = 'Goodreads';
  else if (scheme === 'wikipedia') {
    const m = /^([a-z]{2,3}):(.+)$/i.exec(id);
    if (m) label = `Wikipedia (${m[1]!.toLowerCase()}): ${m[2]!.replace(/_/g, ' ')}`;
  }

  let url = resolveIdentifierUrl(value);
  if (scheme !== 'isbn' && urlHint && /^https?:\/\//i.test(urlHint)) url = urlHint;

  return { value, scheme, id, label, url };
}

function normalizeProvenanceKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    const withScheme = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : /^\/\//.test(trimmed)
        ? `https:${trimmed}`
        : `https://${trimmed}`;
    const u = new URL(withScheme);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    let path = u.pathname.replace(/ /g, '_').replace(/\/+$/, '') || '/';
    try {
      path = decodeURIComponent(path);
    } catch {
      /* keep */
    }
    return `https://${host}${path}`.toLowerCase();
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, '');
  }
}

function hostnameLabel(source: string): string {
  try {
    return new URL(source).hostname.replace(/^www\./, '');
  } catch {
    return source;
  }
}

export function buildProvenanceChips(
  source: string | undefined,
  identifiers: PublicationIdentifier[]
): ProvenanceChip[] {
  const chips: ProvenanceChip[] = [];
  const seen = new Set<string>();

  const pushHref = (href: string, label: string) => {
    const key = normalizeProvenanceKey(href);
    if (!href.trim() || seen.has(key)) return;
    seen.add(key);
    chips.push({ label, href });
  };

  if (source) {
    if (/^https?:\/\//i.test(source) || /^www\./i.test(source)) {
      const href = /^https?:\/\//i.test(source) ? source : `https://${source}`;
      pushHref(href, hostnameLabel(href));
    } else {
      const key = `label:${source.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        chips.push({ label: source, search: source });
      }
    }
  }

  for (const identifier of identifiers) {
    if (identifier.scheme === 'isbn') {
      const isbn = identifier.id.replace(/[^0-9Xx]/g, '') || identifier.id;
      const key = `isbn:${isbn.toLowerCase()}`;
      if (!isbn || seen.has(key)) continue;
      seen.add(key);
      chips.push({
        label: identifier.label,
        search: identifier.value,
        copyText: isbn
      });
      continue;
    }
    if (identifier.url) {
      pushHref(identifier.url, identifier.label);
      continue;
    }
    const key = `id:${identifier.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chips.push({ label: identifier.label, search: identifier.value });
  }

  return chips;
}

/** Thorough bibliographic metadata for kind 30040 / wiki headers (jumble-analog). */
export function editionMetadata(event: Event): EditionMetadata {
  const titles = tagValue(event, 'title');
  const tTitles = tagValue(event, 'T');
  const authors: PublicationAuthor[] = [];
  const authorsFromN: PublicationAuthor[] = [];
  const identifiers: PublicationIdentifier[] = [];
  let sourceS: string | undefined;
  let sourceLegacy: string | undefined;
  let type: string | undefined;
  let version: string | undefined;
  let releaseDate: string | undefined;
  let language: string | undefined;
  let publishedBy: string | undefined;

  for (const tag of event.tags) {
    const raw = (tag[0] || '').trim();
    const name = raw.toLowerCase();
    const value = tag[1]?.trim();
    if (!value) continue;

    if (raw === 'N') {
      authorsFromN.push({ name: humanizeTag(value), slug: value.toLowerCase() });
      continue;
    }
    if (name === 'author') {
      const role = tag[2]?.trim();
      authors.push({
        name: value,
        role: role || undefined,
        slug: indexSlug(value) || value.toLowerCase()
      });
    } else if (raw === 's') {
      if (!sourceS) sourceS = value;
    } else if (name === 'source') {
      if (!sourceLegacy) sourceLegacy = value;
    } else if (name === 'type') {
      type = value;
    } else if (name === 'version') {
      version = value;
    } else if (name === 'release_date' || name === 'published_on') {
      if (!releaseDate) releaseDate = value;
    } else if (raw === 'i') {
      const parsed = parsePublicationIdentifier(value, tag[2]?.trim());
      if (parsed) identifiers.push(parsed);
    } else if (name === 'published_by') {
      if (!publishedBy) publishedBy = value;
    } else if (raw === 'l' && !language) {
      language = value;
    }
  }

  const summaryTag = firstTag(event, 'summary')?.trim();
  // Wiki/spec pages render the full body below the header — never dump raw markup as "summary".
  const summary =
    summaryTag ||
    (event.kind !== KIND.WIKI && event.kind !== KIND.SPEC && event.content.trim()
      ? event.content.trim().slice(0, 480)
      : undefined) ||
    undefined;

  const source = sourceS || sourceLegacy;
  const sectionCount = event.tags.filter((t) => {
    if (t[0] === 'e' && t[1]) return true;
    if (t[0] !== 'a' || !t[1]) return false;
    const parts = t[1].split(':');
    const kind = Number(parts[0]);
    return Number.isInteger(kind) && kind !== 30040;
  }).length;

  return {
    titles: titles.length ? titles : tTitles.map(humanizeTag).filter(Boolean),
    authors: authors.length ? authors : authorsFromN,
    subjects: tagValue(event, 't'),
    summary,
    image: coverImageUrl(event),
    source,
    type,
    version,
    releaseDate,
    language,
    publishedBy,
    identifiers,
    sectionCount,
    provenance: buildProvenanceChips(source, identifiers)
  };
}
