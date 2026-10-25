import { intersects, protectedRanges } from './grammar-markup-protect';

export type GrammarIssue = {
  offset: number;
  length: number;
  message: string;
  replacements: string[];
};

/** Imwald TranslateLanguageCatalog.fallbackLanguages + LanguageToolCodes mapping. */
export type GrammarLanguageOption = {
  /** Short translate / BCP-47 base code (e.g. `en`, `de`). */
  code: string;
  /** LanguageTool `language` query value (e.g. `en-US`, `de-DE`). */
  languageToolCode: string;
  label: string;
};

export const LANGUAGETOOL_URL = 'https://imwald.eu/api/languagetool/v2/check';

const MAX_CHARS = 28_000;

const LT_ALIASES: Record<string, string> = {
  en: 'en-US',
  'en-us': 'en-US',
  'en-gb': 'en-GB',
  de: 'de-DE',
  ger: 'de-DE',
  fr: 'fr-FR',
  fra: 'fr-FR',
  it: 'it',
  ita: 'it',
  pt: 'pt-BR',
  por: 'pt-BR',
  pl: 'pl-PL',
  ru: 'ru-RU',
  nl: 'nl',
  cs: 'cs-CZ',
  tr: 'tr',
  ar: 'ar',
  zh: 'zh-CN',
  es: 'es',
  sp: 'es',
  nb: 'no',
  no: 'no',
  eng: 'en-US'
};

/** Same fallback set imwald uses for the grammar language dropdown. */
export const GRAMMAR_LANGUAGE_OPTIONS: readonly GrammarLanguageOption[] = [
  { code: 'en', languageToolCode: 'en-US', label: 'English' },
  { code: 'de', languageToolCode: 'de-DE', label: 'Deutsch' },
  { code: 'es', languageToolCode: 'es', label: 'Español' },
  { code: 'fr', languageToolCode: 'fr-FR', label: 'Français' },
  { code: 'it', languageToolCode: 'it', label: 'Italiano' },
  { code: 'pt', languageToolCode: 'pt-BR', label: 'Português' },
  { code: 'ru', languageToolCode: 'ru-RU', label: 'Русский' },
  { code: 'zh', languageToolCode: 'zh-CN', label: '简体中文' },
  { code: 'ar', languageToolCode: 'ar', label: 'العربية' },
  { code: 'nl', languageToolCode: 'nl', label: 'Nederlands' },
  { code: 'pl', languageToolCode: 'pl-PL', label: 'Polski' },
  { code: 'cs', languageToolCode: 'cs-CZ', label: 'Čeština' },
  { code: 'tr', languageToolCode: 'tr', label: 'Türkçe' }
];

/** Map a browser / publication / free-form code to a LanguageTool language id. */
export function languageToolCodeFrom(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (!trimmed) return 'en-US';
  if (LT_ALIASES[trimmed]) return LT_ALIASES[trimmed]!;
  const base = trimmed.split('-')[0] ?? trimmed;
  if (LT_ALIASES[base]) return LT_ALIASES[base]!;
  const hit = GRAMMAR_LANGUAGE_OPTIONS.find(
    (o) =>
      o.languageToolCode.toLowerCase() === trimmed ||
      o.code === base ||
      o.languageToolCode.toLowerCase() === base
  );
  return hit?.languageToolCode ?? (trimmed.includes('-') ? trimmed : 'en-US');
}

/**
 * Dropdown order: preferred first, then English, then the rest (imwald
 * `grammarLanguageOptions`).
 */
export function grammarLanguageOptions(
  preferredCode: string | null | undefined = null
): GrammarLanguageOption[] {
  const preferred = languageToolCodeFrom(preferredCode);
  const seen = new Set<string>();
  const out: GrammarLanguageOption[] = [];
  const push = (opt: GrammarLanguageOption) => {
    if (seen.has(opt.languageToolCode)) return;
    seen.add(opt.languageToolCode);
    out.push(opt);
  };
  const prefOpt =
    GRAMMAR_LANGUAGE_OPTIONS.find((o) => o.languageToolCode === preferred) ??
    GRAMMAR_LANGUAGE_OPTIONS.find((o) => languageToolCodeFrom(o.code) === preferred);
  if (prefOpt) push(prefOpt);
  const en = GRAMMAR_LANGUAGE_OPTIONS.find((o) => o.code === 'en');
  if (en) push(en);
  for (const opt of GRAMMAR_LANGUAGE_OPTIONS) push(opt);
  return out;
}

export function defaultGrammarLanguageToolCode(): string {
  if (typeof navigator === 'undefined') return 'en-US';
  return languageToolCodeFrom(navigator.language || 'en-US');
}

type LtMatch = {
  offset?: number;
  length?: number;
  message?: string;
  replacements?: Array<{ value?: string }>;
};

type LtResponse = {
  matches?: LtMatch[];
};

export function filterGrammarIssues(text: string, issues: GrammarIssue[]): GrammarIssue[] {
  const ranges = protectedRanges(text);
  return issues.filter((issue) => !intersects(issue.offset, issue.length, ranges));
}

export async function checkGrammar(
  text: string,
  language: string,
  signal?: AbortSignal,
): Promise<GrammarIssue[]> {
  // Keep leading/trailing whitespace so LT offsets match the editor content.
  if (!text.trim()) return [];
  const payload = text.slice(0, MAX_CHARS);

  const body = new URLSearchParams({
    text: payload,
    language,
    enabledOnly: 'false',
  });

  try {
    const response = await fetch(LANGUAGETOOL_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal,
    });
    if (!response.ok) return [];
    const json = (await response.json()) as LtResponse;
    const issues: GrammarIssue[] = (json.matches ?? []).map((match) => ({
      offset: match.offset ?? 0,
      length: match.length ?? 0,
      message: match.message ?? '',
      replacements: (match.replacements ?? [])
        .map((r) => String(r.value ?? '').trim())
        .filter((v) => v.length > 0),
    }));
    return filterGrammarIssues(payload, issues);
  } catch {
    return [];
  }
}
