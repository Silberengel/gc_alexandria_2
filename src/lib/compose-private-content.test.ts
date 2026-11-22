import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  emptyComposePrivateContent,
  loadComposePrivateContent,
  loadComposePrivatePassthrough,
  mutedFieldFromEvent,
  needsPrivateContentHydrate,
  privateTagsFromMutePayload,
  sealComposePrivateContent
} from './compose-private-content';

const { FAKE_NIP44, FAKE_PLAIN } = vi.hoisted(() => ({
  /** Base64-ish blob that passes looksLikeNip44Ciphertext. */
  FAKE_NIP44: `${'A'.repeat(40)}${'B'.repeat(40)}`,
  FAKE_PLAIN: JSON.stringify([['p', 'b'.repeat(64)]])
}));

vi.mock('./stores/session', () => {
  const nip44Encrypt = vi.fn(async (_pk: string, plain: string) => {
    // Stable fake ciphertext long enough for the NIP-44 heuristic.
    return `${'C'.repeat(40)}${Buffer.from(plain).toString('base64').replace(/=+$/, '')}${'D'.repeat(20)}`.slice(
      0,
      80
    );
  });
  const nip44Decrypt = vi.fn(async (_pk: string, ct: string) => {
    if (ct === FAKE_NIP44) return FAKE_PLAIN;
    throw new Error('bad cipher');
  });
  return {
    session: {
      getPubkey: () => 'a'.repeat(64),
      getSignerType: () => 'nip07',
      getSigner: () => ({ nip44Encrypt, nip44Decrypt })
    }
  };
});

function ev(partial: Partial<Event> & Pick<Event, 'kind'>): Event {
  return {
    id: '1'.repeat(64),
    pubkey: 'a'.repeat(64),
    created_at: 1,
    tags: [],
    content: '',
    sig: '2'.repeat(128),
    ...partial
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('needsPrivateContentHydrate', () => {
  it('flags mute, contacts, and private relay list', () => {
    expect(needsPrivateContentHydrate(KIND.MUTE)).toBe(true);
    expect(needsPrivateContentHydrate(KIND.CONTACT_LIST)).toBe(true);
    expect(needsPrivateContentHydrate(KIND.PRIVATE_RELAY_LIST)).toBe(true);
    expect(needsPrivateContentHydrate(1)).toBe(false);
    expect(needsPrivateContentHydrate(10002)).toBe(false);
  });
});

describe('loadComposePrivateContent', () => {
  it('parses plaintext JSON private tags without crypto', async () => {
    const bag = await loadComposePrivateContent(
      ev({
        kind: KIND.MUTE,
        content: JSON.stringify([['word', 'spam']])
      })
    );
    expect(bag.couldDecrypt).toBe(true);
    expect(bag.privateTags).toEqual([['word', 'spam']]);
    expect(bag.previousCipher).toBe('');
    expect(bag.passthrough).toBe(false);
  });

  it('decrypts NIP-44 private tags via the session signer', async () => {
    const bag = await loadComposePrivateContent(
      ev({
        kind: KIND.MUTE,
        content: FAKE_NIP44
      })
    );
    expect(bag.couldDecrypt).toBe(true);
    expect(bag.privateTags).toEqual([['p', 'b'.repeat(64)]]);
    expect(bag.previousCipher).toBe('');
  });

  it('keeps ciphertext when decrypt fails', async () => {
    const cipher = 'Z'.repeat(64);
    const bag = await loadComposePrivateContent(
      ev({
        kind: KIND.MUTE,
        content: cipher
      })
    );
    expect(bag.couldDecrypt).toBe(false);
    expect(bag.privateTags).toEqual([]);
    expect(bag.previousCipher).toBe(cipher);
  });
});

describe('loadComposePrivatePassthrough', () => {
  it('stores opaque content for contact-style lists', () => {
    const bag = loadComposePrivatePassthrough(
      ev({ kind: KIND.CONTACT_LIST, content: 'opaque-cipher' })
    );
    expect(bag.passthrough).toBe(true);
    expect(bag.previousCipher).toBe('opaque-cipher');
    expect(bag.privateTags).toEqual([]);
  });
});

describe('sealComposePrivateContent', () => {
  it('encrypts next private tags', async () => {
    const sealed = await sealComposePrivateContent(null, [['word', 'spam']]);
    expect(sealed.length).toBeGreaterThanOrEqual(48);
    expect(sealed).not.toContain('spam');
  });

  it('preserves previous cipher when decrypt failed and no new private tags', async () => {
    const bag = emptyComposePrivateContent({
      couldDecrypt: false,
      previousCipher: 'KEEP_ME'
    });
    expect(await sealComposePrivateContent(bag, [])).toBe('KEEP_ME');
  });

  it('returns empty when decrypt succeeded and private tags were cleared', async () => {
    const bag = emptyComposePrivateContent({
      couldDecrypt: true,
      previousCipher: '',
      privateTags: [['word', 'old']]
    });
    expect(await sealComposePrivateContent(bag, [])).toBe('');
  });

  it('passthrough always returns previous content when not editing private tags', async () => {
    const bag = loadComposePrivatePassthrough(
      ev({ kind: KIND.CONTACT_LIST, content: 'contact-cipher' })
    );
    expect(await sealComposePrivateContent(bag, [])).toBe('contact-cipher');
  });
});

describe('mutedFieldFromEvent / privateTagsFromMutePayload', () => {
  it('merges public and private mute rows for the form', () => {
    const pk = 'c'.repeat(64);
    const raw = mutedFieldFromEvent(
      ev({
        kind: KIND.MUTE,
        tags: [['p', pk]]
      }),
      [['word', 'spam']]
    );
    expect(raw).toContain(`p ${pk}`);
    expect(raw).toContain('private word spam');
  });

  it('parses mute privateJson back into tag rows', () => {
    expect(privateTagsFromMutePayload(JSON.stringify([['word', 'x']]))).toEqual([
      ['word', 'x']
    ]);
    expect(privateTagsFromMutePayload('')).toEqual([]);
    expect(privateTagsFromMutePayload('not-json')).toEqual([]);
  });

  it('Clone-style hydrate: decrypt fills Priv rows; failed decrypt still seals cipher', async () => {
    const pk = 'c'.repeat(64);
    const live = ev({
      kind: KIND.MUTE,
      tags: [['p', pk]],
      content: FAKE_NIP44
    });
    const bag = await loadComposePrivateContent(live);
    const muted = mutedFieldFromEvent(live, bag.privateTags);
    expect(muted).toContain(`p ${pk}`);
    expect(muted).toContain(`private p ${'b'.repeat(64)}`);

    const failed = await loadComposePrivateContent(
      ev({ kind: KIND.MUTE, tags: [['p', pk]], content: 'Z'.repeat(64) })
    );
    expect(failed.couldDecrypt).toBe(false);
    expect(await sealComposePrivateContent(failed, [])).toBe('Z'.repeat(64));
  });
});
