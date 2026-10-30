import { get, writable } from 'svelte/store';

const STORAGE_KEY = 'alexandria-grammar-ignore';
/** Cap so a huge list cannot slow every grammar pass. */
const MAX_WORDS = 500;

function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== 'string') continue;
      const word = normalizeIgnoreWord(item);
      if (!word) continue;
      const key = word.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(word);
      if (out.length >= MAX_WORDS) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Single token for the ignore list — no whitespace (LanguageTool Words API parity). */
export function normalizeIgnoreWord(raw: string): string {
  const t = raw.trim();
  if (!t || /\s/.test(t)) return '';
  return t.slice(0, 64);
}

function createGrammarIgnoreStore() {
  const initial = typeof localStorage !== 'undefined' ? load() : [];
  const { subscribe, set, update } = writable<string[]>(initial);

  function persist(words: string[]): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(words));
  }

  return {
    subscribe,
    /** Case-insensitive membership. */
    has(word: string): boolean {
      const key = normalizeIgnoreWord(word).toLowerCase();
      if (!key) return false;
      return get({ subscribe }).some((w) => w.toLowerCase() === key);
    },
    add(word: string): boolean {
      const next = normalizeIgnoreWord(word);
      if (!next) return false;
      let added = false;
      update((words) => {
        if (words.some((w) => w.toLowerCase() === next.toLowerCase())) return words;
        const out = [...words, next].slice(0, MAX_WORDS);
        persist(out);
        added = true;
        return out;
      });
      return added;
    },
    remove(word: string): void {
      const key = normalizeIgnoreWord(word).toLowerCase();
      if (!key) return;
      update((words) => {
        const out = words.filter((w) => w.toLowerCase() !== key);
        persist(out);
        return out;
      });
    },
    reset(): void {
      persist([]);
      set([]);
    }
  };
}

export const grammarIgnoreWords = createGrammarIgnoreStore();
