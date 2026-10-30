import { nip19, type Event, type EventTemplate } from 'nostr-tools';
import { buildComposePartial } from './compose-build';
import { validateCompose } from './kind-compose';
import { CITATION_KINDS, isCitationKind, KIND } from './constants';

/** Placement modes from NKBIP-03 `[[citation::mode::nevent]]`. */
export type CitationMode =
  | 'end'
  | 'foot'
  | 'foot-end'
  | 'inline'
  | 'quote'
  | 'prompt-end'
  | 'prompt-inline';

const CITATION_MODES = new Set<string>([
  'end',
  'foot',
  'foot-end',
  'inline',
  'quote',
  'prompt-end',
  'prompt-inline'
]);

export type CitationMeta = {
  kind: number;
  title: string;
  author: string;
  publishedOn: string;
  accessedOn: string;
  url: string;
  pageRange: string;
  chapterTitle: string;
  editor: string;
  publishedBy: string;
  publishedIn: string;
  doi: string;
  version: string;
  location: string;
  geohash: string;
  summary: string;
  llm: string;
  /** kind:pubkey:id coordinate for internal citations. */
  cited: string;
  content: string;
};

export function citationModeFromMacro(raw: string | undefined | null): CitationMode | undefined {
  const mode = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!mode || !CITATION_MODES.has(mode)) return undefined;
  return mode as CitationMode;
}

export function citationModesForKind(kind: number): CitationMode[] {
  if (kind === KIND.CITATION_PROMPT) return ['prompt-end', 'prompt-inline'];
  return ['end', 'foot', 'foot-end', 'inline', 'quote'];
}

export function isCitationModeInline(mode: CitationMode | undefined): boolean {
  return mode === 'inline' || mode === 'prompt-inline';
}

export function isCitationModeQuote(mode: CitationMode | undefined): boolean {
  return mode === 'quote';
}

export function isCitationModeFoot(mode: CitationMode | undefined): boolean {
  return mode === 'foot' || mode === 'foot-end';
}

export function isCitationModeEndOnly(mode: CitationMode | undefined): boolean {
  return mode === 'end' || mode === 'prompt-end';
}

function tagValue(tags: string[][], name: string): string {
  for (const tag of tags) {
    if (tag[0] === name && tag[1]) return tag[1];
  }
  return '';
}

function tagValues(tags: string[][], name: string): string[] {
  for (const tag of tags) {
    if (tag[0] === name) return tag.slice(1).filter(Boolean);
  }
  return [];
}

export function parseCitationMeta(event: Pick<Event, 'kind' | 'tags' | 'content'>): CitationMeta {
  const tags = event.tags ?? [];
  const publishedInParts = tagValues(tags, 'published_in');
  return {
    kind: event.kind,
    title: tagValue(tags, 'title'),
    author: tagValue(tags, 'author'),
    publishedOn: tagValue(tags, 'published_on'),
    accessedOn: tagValue(tags, 'accessed_on'),
    url: tagValue(tags, 'u'),
    pageRange: tagValue(tags, 'page_range'),
    chapterTitle: tagValue(tags, 'chapter_title'),
    editor: tagValue(tags, 'editor'),
    publishedBy: tagValue(tags, 'published_by'),
    publishedIn: publishedInParts.join(', '),
    doi: tagValue(tags, 'doi'),
    version: tagValue(tags, 'version'),
    location: tagValue(tags, 'location'),
    geohash: tagValue(tags, 'g'),
    summary: tagValue(tags, 'summary'),
    llm: tagValue(tags, 'llm'),
    cited: tagValues(tags, 'c').join(' '),
    content: String(event.content ?? '')
  };
}

function yearFromIso(iso: string): string {
  const m = iso.trim().match(/^(\d{4})/);
  return m?.[1] ?? '';
}

/** Short parenthetical cite, e.g. `(Author, 2024)` or `(ChatGPT, 2023)`. */
export function formatCitationInline(meta: CitationMeta): string {
  if (meta.kind === KIND.CITATION_PROMPT) {
    const who = meta.llm || 'LLM';
    const year = yearFromIso(meta.accessedOn) || yearFromIso(meta.publishedOn);
    return year ? `(${who}, ${year})` : `(${who})`;
  }
  const who = meta.author || meta.title || 'Source';
  const year = yearFromIso(meta.publishedOn) || yearFromIso(meta.accessedOn);
  return year ? `(${who}, ${year})` : `(${who})`;
}

/** One-line bibliographic entry for footnotes / references. */
export function formatCitationFull(meta: CitationMeta): string {
  if (meta.kind === KIND.CITATION_PROMPT) {
    const parts = [
      meta.llm || 'LLM',
      meta.version ? `v${meta.version}` : '',
      meta.accessedOn ? `accessed ${meta.accessedOn}` : '',
      meta.url
    ].filter(Boolean);
    return parts.join('. ') + (meta.content ? ` — “${clip(meta.content, 120)}”` : '');
  }
  const bits: string[] = [];
  if (meta.author) bits.push(meta.author);
  if (meta.title) bits.push(`“${meta.title}”`);
  if (meta.publishedIn) bits.push(meta.publishedIn);
  if (meta.publishedBy) bits.push(meta.publishedBy);
  if (meta.publishedOn) bits.push(meta.publishedOn);
  if (meta.pageRange) bits.push(`pp. ${meta.pageRange}`);
  if (meta.chapterTitle) bits.push(meta.chapterTitle);
  if (meta.doi) bits.push(`doi:${meta.doi}`);
  if (meta.url) bits.push(meta.url);
  if (meta.cited) bits.push(`Nostr ${meta.cited}`);
  if (meta.accessedOn) bits.push(`accessed ${meta.accessedOn}`);
  if (meta.version) bits.push(`ed. ${meta.version}`);
  const head = bits.join('. ');
  if (meta.content) return `${head}${head ? ' — ' : ''}“${clip(meta.content, 160)}”`;
  return head || 'Citation';
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function citationMacro(mode: CitationMode, neventOrBech32: string): string {
  let id = neventOrBech32.trim();
  while (id.toLowerCase().startsWith('nostr:')) id = id.slice(6);
  return `[[citation::${mode}::${id}]]`;
}

export function citationNevent(
  event: Pick<Event, 'id' | 'pubkey' | 'kind'>,
  relays?: string[]
): string {
  return nip19.neventEncode({
    id: event.id,
    author: event.pubkey,
    kind: event.kind,
    relays: relays?.length ? relays : undefined
  });
}

export function todayIsoDate(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Build an unsigned citation event from form values (catalog-driven). */
export function buildCitationPartial(input: {
  kind: number;
  content: string;
  values: Record<string, string>;
}): EventTemplate {
  if (!isCitationKind(input.kind)) {
    throw new Error(`Not a citation kind: ${input.kind}`);
  }
  const built = buildComposePartial({
    kind: input.kind,
    content: input.content,
    values: input.values
  });
  const check = validateCompose(built.kind, {
    content: built.content,
    values: input.values,
    tags: built.tags
  });
  if (!check.ok) throw new Error(check.error || 'Citation is incomplete.');
  return {
    kind: built.kind,
    content: built.content,
    tags: built.tags,
    created_at: Math.floor(Date.now() / 1000)
  };
}

type CiteSeg = { type: string; citationMode?: CitationMode };

export type CitationFootEntry = {
  number: number;
  segIndex: number;
  mode: CitationMode;
  event: Event;
  brief: boolean;
};

export type CitationRefEntry = {
  number: number;
  segIndex: number;
  mode: CitationMode;
  event: Event;
};

/** Footnote numbers for `foot` / `foot-end` macros (document-local). */
export function collectCitationFootnotes(
  segments: CiteSeg[],
  resolved: Record<number, Event | null | undefined>
): CitationFootEntry[] {
  const out: CitationFootEntry[] = [];
  let n = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (seg?.type !== 'ref' || !isCitationModeFoot(seg.citationMode)) continue;
    const hit = resolved[i];
    if (!hit || !seg.citationMode) continue;
    n += 1;
    out.push({
      number: n,
      segIndex: i,
      mode: seg.citationMode,
      event: hit,
      brief: seg.citationMode === 'foot-end'
    });
  }
  return out;
}

/** References entries (end / prompt-end / inline / quote / foot-end). */
export function collectCitationReferences(
  segments: CiteSeg[],
  resolved: Record<number, Event | null | undefined>
): CitationRefEntry[] {
  const out: CitationRefEntry[] = [];
  let n = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (seg?.type !== 'ref' || !seg.citationMode) continue;
    const mode = seg.citationMode;
    const include =
      isCitationModeEndOnly(mode) ||
      isCitationModeInline(mode) ||
      isCitationModeQuote(mode) ||
      mode === 'foot-end';
    if (!include) continue;
    const hit = resolved[i];
    if (!hit) continue;
    n += 1;
    out.push({ segIndex: i, number: n, mode, event: hit });
  }
  return out;
}

export function citationKindLabel(kind: number): string {
  switch (kind) {
    case KIND.CITATION_INTERNAL:
      return 'Internal (Nostr)';
    case KIND.CITATION_WEB:
      return 'Web';
    case KIND.CITATION_HARDCOPY:
      return 'Hardcopy';
    case KIND.CITATION_PROMPT:
      return 'Prompt / LLM';
    default:
      return `Kind ${kind}`;
  }
}

export { CITATION_KINDS, isCitationKind };
