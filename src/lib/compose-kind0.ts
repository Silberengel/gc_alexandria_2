import type { Event } from 'nostr-tools';
import { parseKind0Json } from './kind-compose';

/** Singleton profile fields — at most one row; empty placeholders stay in the editor. */
export const KIND0_SINGLETON_NAMES = [
  'display_name',
  'name',
  'about',
  'picture',
  'banner'
] as const;

const UNIQUE_NAMES = ['bot', 'birthday'] as const;
const AT_MOST_ONE_NAMES = new Set<string>([...KIND0_SINGLETON_NAMES, ...UNIQUE_NAMES]);

export const KIND0_DISPLAY_ORDER = [
  'display_name',
  'name',
  'about',
  'picture',
  'banner',
  'nip05',
  'lud16',
  'lud06',
  'website',
  'bot',
  'birthday'
] as const;

/**
 * Kind 0 `content` JSON string fields other clients read (NIP-01 / NIP-24 / NIP-05 / NIP-57).
 * `bot` is a NIP-24 boolean handled separately.
 */
const CONTENT_JSON_NAMES = new Set([
  'display_name',
  'name',
  'about',
  'picture',
  'banner',
  'nip05',
  'lud16',
  'lud06',
  'website',
  'birthday'
]);

const KNOWN_EDITOR_NAMES = new Set<string>(KIND0_DISPLAY_ORDER);
const AUTO_NAMES = new Set(['alt', 'client']);

/** Deletable tag names offered by the editor's add-tag control. */
export const KIND0_ADD_TAG_OPTIONS = [
  'nip05',
  'lud16',
  'lud06',
  'website',
  'bot',
  'birthday'
] as const;

export type Kind0SavePayload = {
  contentJson: string;
  orderedTags: string[][];
};

export function isKnownKind0EditorName(name: string): boolean {
  return KNOWN_EDITOR_NAMES.has(name);
}

export function isKind0Singleton(name: string): boolean {
  return (KIND0_SINGLETON_NAMES as readonly string[]).includes(name);
}

export function isKind0AtMostOne(name: string): boolean {
  return AT_MOST_ONE_NAMES.has(name);
}

function normalizeTagName(n: string): string {
  if (n === 'displayName') return 'display_name';
  if (n === 'username') return 'name';
  return n;
}

/** NIP-24 `bot` JSON boolean from kind-0 tags. */
export function botJsonBooleanFromTags(tags: string[][]): boolean | null {
  for (const tag of tags) {
    if (!tag[0] || tag[0].toLowerCase() !== 'bot') continue;
    const v = (tag[1] ?? '').trim().toLowerCase();
    if (!v) return true;
    if (v === 'false') return false;
    if (v === 'true') return true;
    return null;
  }
  return null;
}

function parseProfileBotJsonValue(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
  }
  return null;
}

function contentStringMap(content: string): Map<string, string> {
  const obj = parseKind0Json(content);
  const out = new Map<string, string>();
  for (const [key, el] of Object.entries(obj)) {
    if (typeof el !== 'string') continue;
    const s = el.trim();
    if (s) out.set(key, s);
  }
  return out;
}

/**
 * Merge kind-0 tags + JSON content into editor rows (imwald `buildTagListFromEvent`).
 * Tags win for singletons already present; JSON fills gaps; unknown JSON keys become rows.
 */
export function buildKind0TagListFromEvent(
  event: Pick<Event, 'content' | 'tags'> | null | undefined
): string[][] {
  const content = contentStringMap(event?.content ?? '');
  const contentObj = parseKind0Json(event?.content ?? '');
  const result: string[][] = [];
  const dedup = new Set<string>();
  const singletonFromTags = new Set<string>();

  function push(tag: string[]): void {
    const name = tag[0];
    if (!name) return;
    if ((KIND0_SINGLETON_NAMES as readonly string[]).includes(name)) {
      if (dedup.has(name)) return;
      dedup.add(name);
      singletonFromTags.add(name);
    } else {
      const key = `${name}\0${tag[1] ?? ''}`;
      if (dedup.has(key)) return;
      dedup.add(key);
    }
    result.push(tag);
  }

  for (const raw of event?.tags ?? []) {
    if (!raw.length) continue;
    const rawName = raw[0]!.trim();
    if (AUTO_NAMES.has(rawName)) continue;
    const name = normalizeTagName(rawName);
    push(name !== rawName ? [name, ...raw.slice(1)] : [...raw]);
  }

  for (const name of KIND0_DISPLAY_ORDER) {
    if (AUTO_NAMES.has(name) || name === 'bot') continue;
    const rawVal = content.get(name)?.trim();
    if (!rawVal) continue;
    if (
      (KIND0_SINGLETON_NAMES as readonly string[]).includes(name) &&
      singletonFromTags.has(name)
    ) {
      continue;
    }
    push([name, rawVal]);
  }

  if (!result.some((t) => t[0]?.toLowerCase() === 'bot')) {
    const bot = parseProfileBotJsonValue(contentObj.bot);
    if (bot === true) push(['bot', 'true']);
    else if (bot === false) push(['bot', 'false']);
  }

  for (const [rawKey, valStr] of content) {
    const trimmed = valStr.trim();
    if (!trimmed) continue;
    const name = normalizeTagName(rawKey);
    if (AUTO_NAMES.has(name) || (KIND0_DISPLAY_ORDER as readonly string[]).includes(name)) {
      continue;
    }
    push([name, trimmed]);
  }

  for (const name of KIND0_SINGLETON_NAMES) {
    if (!result.some((t) => t[0] === name)) push([name, '']);
  }
  // Always show the bot option group; default false when unset.
  if (!result.some((t) => t[0]?.toLowerCase() === 'bot')) {
    push(['bot', 'false']);
  }
  return result;
}

/**
 * Build kind-0 JSON content + ordered tags from editor rows (imwald `toSavePayload`).
 * Lightning (`lud16`/`lud06`) and other content fields are written into JSON, not tags only.
 */
export function kind0SavePayload(rows: string[][]): Kind0SavePayload {
  const validTags = rows.flatMap((raw) => {
    if (!raw.length) return [];
    const name = raw[0]!.trim();
    if (!name) return [];
    const v1 = (raw[1] ?? '').trim();
    if (name === 'bot') {
      if (raw.length === 1 || !v1) return [['bot']];
      if (v1.toLowerCase() === 'false') return [['bot', 'false']];
      if (v1.toLowerCase() === 'true') return [['bot', 'true']];
      return [[name, v1, ...raw.slice(2)]];
    }
    if (raw.length >= 2 && v1) return [[name, v1, ...raw.slice(2)]];
    return [];
  });

  const seen = new Set<string>();
  const orderedTags = validTags.filter((tag) => {
    const name = tag[0]!;
    if (!AT_MOST_ONE_NAMES.has(name)) return true;
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });

  const content: Record<string, string> = {};
  for (const tag of orderedTags) {
    const name = tag[0]!;
    if (!CONTENT_JSON_NAMES.has(name) || name in content) continue;
    const value = (tag[1] ?? '').trim();
    if (value) content[name] = value;
  }
  if (content.display_name) content.displayName = content.display_name;

  const botJson = botJsonBooleanFromTags(orderedTags);
  const jsonObj: Record<string, unknown> = { ...content };
  if (botJson !== null) jsonObj.bot = botJson;

  return {
    contentJson: JSON.stringify(jsonObj),
    orderedTags
  };
}

export function emptyKind0TagRows(): string[][] {
  return buildKind0TagListFromEvent(null);
}

/** True when rows are only empty singleton placeholders (+ default bot=false). */
export function isKind0TagRowsEmpty(rows: string[][]): boolean {
  return rows.every((row) => {
    const name = (row[0] ?? '').trim();
    const value = (row[1] ?? '').trim();
    if (!name) return !value && row.slice(2).every((c) => !String(c).trim());
    if (isKind0Singleton(name)) return !value;
    // Default bot option-group value does not count as user input.
    if (name === 'bot' && value.toLowerCase() === 'false') return true;
    return !value && row.slice(2).every((c) => !String(c).trim());
  });
}

export function kind0FieldLabel(name: string): string {
  switch (name) {
    case 'display_name':
      return 'Display name';
    case 'name':
      return 'Username';
    case 'about':
      return 'About';
    case 'picture':
      return 'Avatar URL';
    case 'banner':
      return 'Banner URL';
    case 'website':
      return 'Website';
    case 'birthday':
      return 'Birthday';
    case 'bot':
      return 'Bot';
    case 'nip05':
      return 'NIP-05';
    case 'lud16':
      return 'lud16';
    case 'lud06':
      return 'lud06';
    default:
      return name;
  }
}
