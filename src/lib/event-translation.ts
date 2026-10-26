import { get, writable } from 'svelte/store';
import type { Event } from 'nostr-tools';
import { omitMediaUrls, uniqueMedia } from './media';
import {
  defaultPreferredTranslateCode,
  FALLBACK_TRANSLATE_LANGUAGES,
  fetchTranslateLanguages,
  translateApiCode,
  translateDetailed,
  type TranslateLanguageOption
} from './libre-translate';

const PREF_KEY = 'alexandria-preferred-translate-language';
const CACHE_KEY = 'alexandria-note-translations';
const CACHE_CAP = 300;
const RETRY_BACKOFF_MS = 600;
const LANGUAGES_CACHE_MS = 60_000;

export type NoteTranslationEntry = {
  lang: string;
  content: string;
};

export type TranslationResult =
  | { ok: true }
  | { ok: false; reason: 'missing-id' | 'empty' | 'failed' | 'already-in-language'; language?: string };

/** Active translations keyed by lowercase event id. */
export const eventTranslations = writable<Record<string, NoteTranslationEntry>>(loadCache());

/** In-flight translate requests. */
export const eventTranslationPending = writable<Record<string, true>>({});

function loadPreferred(): string {
  try {
    const raw = localStorage.getItem(PREF_KEY)?.trim();
    if (raw) return translateApiCode(raw);
  } catch {
    /* ignore */
  }
  return defaultPreferredTranslateCode();
}

function persistPreferred(code: string): void {
  try {
    localStorage.setItem(PREF_KEY, translateApiCode(code));
  } catch {
    /* ignore */
  }
}

function createPreferredStore() {
  const initial =
    typeof localStorage !== 'undefined' ? loadPreferred() : defaultPreferredTranslateCode();
  const { subscribe, set } = writable(initial);
  return {
    subscribe,
    set(code: string): void {
      const next = translateApiCode(code);
      persistPreferred(next);
      set(next);
    }
  };
}

export const preferredTranslateLanguage = createPreferredStore();

function loadCache(): Record<string, NoteTranslationEntry> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, NoteTranslationEntry>;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, NoteTranslationEntry> = {};
    for (const [id, entry] of Object.entries(parsed)) {
      if (
        entry &&
        typeof entry.lang === 'string' &&
        typeof entry.content === 'string' &&
        entry.content.trim()
      ) {
        out[id.toLowerCase()] = { lang: entry.lang, content: entry.content };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function persistCache(map: Record<string, NoteTranslationEntry>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const ids = Object.keys(map);
    let next = map;
    if (ids.length > CACHE_CAP) {
      next = {};
      for (const id of ids.slice(ids.length - CACHE_CAP)) {
        next[id] = map[id]!;
      }
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function isEventTranslated(eventId: string): boolean {
  const id = eventId.trim().toLowerCase();
  return !!id && !!get(eventTranslations)[id];
}

export function clearEventTranslation(eventId: string): void {
  const id = eventId.trim().toLowerCase();
  if (!id) return;
  eventTranslations.update((map) => {
    if (!(id in map)) return map;
    const next = { ...map };
    delete next[id];
    persistCache(next);
    return next;
  });
}

/** Body text sent to LibreTranslate (media URLs stripped). */
export function translatableBody(event: Event): string {
  const media = uniqueMedia(event);
  return omitMediaUrls(event.content ?? '', media).trim();
}

/** Display content: active translation, else original. */
export function translatedOrOriginalContent(event: Event): string {
  const id = event.id?.trim().toLowerCase();
  if (id) {
    const hit = get(eventTranslations)[id];
    if (hit?.content) return hit.content;
  }
  return event.content ?? '';
}

let languagesCache: TranslateLanguageOption[] | null = null;
let languagesFetchedAt = 0;

export async function availableTranslateLanguages(
  signal?: AbortSignal
): Promise<TranslateLanguageOption[]> {
  const now = Date.now();
  if (languagesCache && now - languagesFetchedAt < LANGUAGES_CACHE_MS) {
    return languagesCache;
  }
  const fetched = await fetchTranslateLanguages(signal);
  languagesCache = fetched.length ? fetched : [...FALLBACK_TRANSLATE_LANGUAGES];
  languagesFetchedAt = now;
  return languagesCache;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function translateWithRetry(
  text: string,
  targetLang: string,
  signal?: AbortSignal
): Promise<Awaited<ReturnType<typeof translateDetailed>>> {
  const first = await translateDetailed(text, targetLang, 'auto', signal);
  if (first) return first;
  await sleep(RETRY_BACKOFF_MS);
  return translateDetailed(text, targetLang, 'auto', signal);
}

/**
 * Toggle translation for an event (imwald TranslationRepository.toggleNoteTranslation).
 * Does not mutate the Nostr event — only the local display store.
 */
export async function toggleEventTranslation(
  event: Event,
  targetLang?: string
): Promise<TranslationResult> {
  const eventId = event.id?.trim().toLowerCase() ?? '';
  if (!eventId) return { ok: false, reason: 'missing-id' };

  if (get(eventTranslations)[eventId]) {
    clearEventTranslation(eventId);
    return { ok: true };
  }

  const sourceText = translatableBody(event);
  if (!sourceText) return { ok: false, reason: 'empty' };

  const resolvedTarget = translateApiCode(targetLang ?? get(preferredTranslateLanguage));

  eventTranslationPending.update((m) => ({ ...m, [eventId]: true }));
  try {
    const outcome = await translateWithRetry(sourceText, resolvedTarget);
    if (!outcome) return { ok: false, reason: 'failed' };

    const detected = outcome.detectedLanguage
      ? translateApiCode(outcome.detectedLanguage)
      : null;
    if (detected && detected === resolvedTarget) {
      return { ok: false, reason: 'already-in-language', language: resolvedTarget };
    }

    const media = uniqueMedia(event);
    const cleaned = omitMediaUrls(outcome.translatedText, media).trim();
    const entry: NoteTranslationEntry = {
      lang: resolvedTarget,
      content: cleaned || outcome.translatedText.trim()
    };
    eventTranslations.update((map) => {
      const next = { ...map, [eventId]: entry };
      persistCache(next);
      return next;
    });
    return { ok: true };
  } finally {
    eventTranslationPending.update((m) => {
      if (!(eventId in m)) return m;
      const next = { ...m };
      delete next[eventId];
      return next;
    });
  }
}
