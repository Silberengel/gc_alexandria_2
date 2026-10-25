import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  checkGrammar,
  filterGrammarIssues,
  grammarLanguageOptions,
  languageToolCodeFrom,
  type GrammarIssue
} from './compose-grammar';

describe('languageToolCodeFrom', () => {
  it('maps browser and short codes to LanguageTool ids', () => {
    expect(languageToolCodeFrom('de')).toBe('de-DE');
    expect(languageToolCodeFrom('en-GB')).toBe('en-GB');
    expect(languageToolCodeFrom('ger')).toBe('de-DE');
  });
});

describe('grammarLanguageOptions', () => {
  it('puts the preferred language first, then English', () => {
    const opts = grammarLanguageOptions('de');
    expect(opts[0]?.languageToolCode).toBe('de-DE');
    expect(opts[1]?.languageToolCode).toBe('en-US');
  });
});

describe('filterGrammarIssues', () => {
  it('drops issues overlapping nostr tokens', () => {
    const text = 'hello nostr:npub1abcdefghijklmnopqrstuvwxyzabcdefghijklmnop hello';
    const issues: GrammarIssue[] = [
      { offset: 0, length: 5, message: 'x', replacements: [] },
      { offset: 6, length: 10, message: 'in nostr', replacements: [] }
    ];
    const kept = filterGrammarIssues(text, issues);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.offset).toBe(0);
  });
});

describe('checkGrammar', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves leading whitespace in offsets', async () => {
    const text = '  helllo world';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const sent = new URLSearchParams(String(init?.body ?? '')).get('text');
        expect(sent).toBe(text);
        return {
          ok: true,
          json: async () => ({
            matches: [{ offset: 2, length: 6, message: 'typo', replacements: [{ value: 'hello' }] }]
          })
        };
      })
    );

    const issues = await checkGrammar(text, 'en-US');
    expect(issues).toEqual([
      { offset: 2, length: 6, message: 'typo', replacements: ['hello'] }
    ]);
  });
});
