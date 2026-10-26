/**
 * LibreTranslate client — same host imwald uses (`https://imwald.eu/api/translate`).
 */

export const LIBRE_TRANSLATE_BASE = 'https://imwald.eu/api/translate';

export type TranslateLanguageOption = {
  code: string;
  name: string;
};

export type TranslateOutcome = {
  translatedText: string;
  detectedLanguage: string | null;
  confidence: number | null;
};

/** Imwald TranslateLanguageCatalog.fallbackLanguages. */
export const FALLBACK_TRANSLATE_LANGUAGES: readonly TranslateLanguageOption[] = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'ru', name: 'Русский' },
  { code: 'zh', name: '简体中文' },
  { code: 'ar', name: 'العربية' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'pl', name: 'Polski' },
  { code: 'cs', name: 'Čeština' },
  { code: 'tr', name: 'Türkçe' }
];

/** English by default — do not assume the browser locale (imwald parity). */
export function defaultPreferredTranslateCode(): string {
  return 'en';
}

export function normalizeTranslateCode(code: string): string {
  const trimmed = code.trim().toLowerCase();
  switch (trimmed) {
    case 'sp':
      return 'es';
    case 'ger':
      return 'de';
    case 'eng':
      return 'en';
    case 'fra':
      return 'fr';
    case 'ita':
      return 'it';
    case 'por':
      return 'pt';
    case 'no':
      return 'nb';
    default:
      return trimmed || 'en';
  }
}

/** LibreTranslate/Argos expects `en`, not regional English codes. */
export function translateApiCode(code: string): string {
  const normalized = normalizeTranslateCode(code).replace(/_/g, '-');
  if (normalized === 'en-gb' || normalized === 'en-us') return 'en';
  return normalized;
}

export function translateDisplayName(
  code: string,
  languages: readonly TranslateLanguageOption[] = FALLBACK_TRANSLATE_LANGUAGES
): string {
  const api = translateApiCode(code);
  return (
    languages.find((l) => translateApiCode(l.code) === api)?.name ??
    FALLBACK_TRANSLATE_LANGUAGES.find((l) => translateApiCode(l.code) === api)?.name ??
    code
  );
}

/** Preserve leading/trailing whitespace around the core string sent to the API. */
export function translationParts(text: string): [string, string, string] | null {
  if (!text.trim()) return null;
  const leading = text.match(/^\s*/)?.[0] ?? '';
  const trailing = text.match(/\s*$/)?.[0] ?? '';
  const core = text.slice(leading.length, text.length - trailing.length);
  if (!core.trim()) return null;
  return [leading, core, trailing];
}

type LanguageDto = { code?: string; name?: string };

export async function fetchTranslateLanguages(
  signal?: AbortSignal
): Promise<TranslateLanguageOption[]> {
  try {
    const response = await fetch(`${LIBRE_TRANSLATE_BASE}/languages`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal
    });
    if (!response.ok) return [...FALLBACK_TRANSLATE_LANGUAGES];
    const body = (await response.json()) as unknown;
    if (Array.isArray(body) && body.length) {
      if (typeof body[0] === 'string') {
        return (body as string[])
          .map((code) => code.trim())
          .filter(Boolean)
          .map((code) => ({ code, name: code }));
      }
      return (body as LanguageDto[])
        .map((dto) => {
          const code = String(dto.code ?? '').trim();
          if (!code) return null;
          const name = String(dto.name ?? '').trim() || code;
          return { code, name };
        })
        .filter((x): x is TranslateLanguageOption => !!x);
    }
  } catch {
    /* fall through */
  }
  return [...FALLBACK_TRANSLATE_LANGUAGES];
}

export async function translateDetailed(
  text: string,
  targetLang: string,
  sourceLang = 'auto',
  signal?: AbortSignal
): Promise<TranslateOutcome | null> {
  const parts = translationParts(text);
  if (!parts) return null;
  const [leading, core, trailing] = parts;
  const resolvedTarget = translateApiCode(targetLang);
  const resolvedSource = sourceLang === 'auto' ? 'auto' : translateApiCode(sourceLang);
  try {
    const response = await fetch(`${LIBRE_TRANSLATE_BASE}/translate`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        q: core,
        source: resolvedSource,
        target: resolvedTarget,
        format: 'text'
      }),
      signal
    });
    if (!response.ok) return null;
    const json = (await response.json()) as {
      translatedText?: string;
      detectedLanguage?: { language?: string; confidence?: number };
    };
    const translated = json.translatedText;
    if (typeof translated !== 'string') return null;
    return {
      translatedText: leading + translated + trailing,
      detectedLanguage: json.detectedLanguage?.language?.trim().toLowerCase() || null,
      confidence:
        typeof json.detectedLanguage?.confidence === 'number'
          ? json.detectedLanguage.confidence
          : null
    };
  } catch {
    return null;
  }
}
