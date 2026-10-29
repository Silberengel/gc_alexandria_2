import { describe, expect, it } from 'vitest';
import {
  contentForPrivateTags,
  looksLikeNip04Ciphertext,
  looksLikeNip44Ciphertext,
  parseTagRowsJson
} from './private-tags';

describe('private-tags', () => {
  it('parses JSON tag rows', () => {
    const pk = 'a'.repeat(64);
    expect(parseTagRowsJson(JSON.stringify([['p', pk], ['word', 'spam']]))).toEqual([
      ['p', pk],
      ['word', 'spam']
    ]);
    expect(parseTagRowsJson('not-json')).toBeNull();
    expect(parseTagRowsJson('{}')).toBeNull();
  });

  it('rejects non-ciphertext strings', () => {
    expect(looksLikeNip44Ciphertext('Could not decrypt the message')).toBe(false);
    expect(looksLikeNip04Ciphertext('Could not decrypt the message')).toBe(false);
    expect(looksLikeNip44Ciphertext('A'.repeat(64))).toBe(true);
  });

  it('preserves previous content when decrypt failed and no new private tags', async () => {
    const prev = 'A'.repeat(64);
    const content = await contentForPrivateTags({
      privateTags: [],
      previousContent: prev,
      couldDecryptPrevious: false
    });
    expect(content).toBe(prev);
  });

  it('clears content when decrypt succeeded and no private tags remain', async () => {
    const content = await contentForPrivateTags({
      privateTags: [],
      previousContent: 'A'.repeat(64),
      couldDecryptPrevious: true
    });
    expect(content).toBe('');
  });
});
