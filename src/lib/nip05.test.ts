import { describe, expect, it } from 'vitest';
import {
  getWellKnownNip05Url,
  splitNip05Identifier,
  verifyNip05AgainstWellKnown
} from './nip05';

const SILBERENGEL = 'fd208ee8c8f283780a9552896e4823cc9dc6bfd442063889577106940fd927c1';

describe('nip05', () => {
  it('splits local@domain on the first @', () => {
    expect(splitNip05Identifier('silberengel@gitcitadel.com')).toEqual({
      name: 'silberengel',
      domain: 'gitcitadel.com'
    });
    expect(splitNip05Identifier('bad')).toBeNull();
  });

  it('builds the well-known URL', () => {
    expect(getWellKnownNip05Url('gitcitadel.com')).toBe(
      'https://gitcitadel.com/.well-known/nostr.json'
    );
    expect(getWellKnownNip05Url('gitcitadel.com', 'silberengel')).toContain('name=silberengel');
  });

  it('verifies a matching names entry', () => {
    const json = {
      names: {
        silberengel: SILBERENGEL,
        other: 'a'.repeat(64)
      }
    };
    expect(verifyNip05AgainstWellKnown(json, 'silberengel', SILBERENGEL)).toBe(true);
    expect(verifyNip05AgainstWellKnown(json, 'silberengel', 'b'.repeat(64))).toBe(false);
    expect(verifyNip05AgainstWellKnown(json, 'missing', SILBERENGEL)).toBe(false);
  });

  it('accepts inverted hex → name rows', () => {
    const json = { names: { [SILBERENGEL]: 'silberengel' } };
    expect(verifyNip05AgainstWellKnown(json, 'silberengel', SILBERENGEL)).toBe(true);
  });
});
