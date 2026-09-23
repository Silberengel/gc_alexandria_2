import type { Event } from 'nostr-tools';
import type { DraftEvent, Signer } from '../signer';

type Nip07Api = {
  getPublicKey(): Promise<string>;
  signEvent(event: unknown): Promise<unknown>;
  nip04?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
  _pubkey?: string | null;
  enable?: () => Promise<void>;
};

function getApi(): Nip07Api {
  const api = window.nostr as Nip07Api | undefined;
  if (!api?.getPublicKey || !api.signEvent) {
    throw new Error('No NIP-07 extension is available. Install one such as nos2x, Alby, or nos2x-fox.');
  }
  return api;
}

/** Clear nos2x-fox page-level pubkey cache before asking the extension. */
export function clearNip07PagePubkeyCache(): void {
  if (typeof window === 'undefined') return;
  try {
    const n = window.nostr as Nip07Api | undefined;
    if (n && '_pubkey' in n) n._pubkey = null;
  } catch {
    /* ignore */
  }
}

export class Nip07Signer implements Signer {
  private pubkey: string | null = null;

  async getPublicKey(): Promise<string> {
    const api = getApi();
    if (typeof api.enable === 'function') {
      try {
        await api.enable();
      } catch {
        /* optional */
      }
    }
    clearNip07PagePubkeyCache();
    this.pubkey = (await api.getPublicKey()).toLowerCase();
    return this.pubkey;
  }

  async signEvent(draft: DraftEvent): Promise<Event> {
    const api = getApi();
    const pubkey = this.pubkey ?? (await this.getPublicKey());
    const unsigned = {
      kind: draft.kind,
      content: draft.content,
      tags: draft.tags,
      created_at: draft.created_at ?? Math.floor(Date.now() / 1000),
      pubkey
    };
    const signed = await api.signEvent(unsigned);
    return signed as Event;
  }

  async nip04Encrypt(pubkey: string, plaintext: string): Promise<string> {
    const api = getApi();
    if (!api.nip04?.encrypt) throw new Error('Extension does not support nip04 encryption');
    return api.nip04.encrypt(pubkey, plaintext);
  }

  async nip04Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    const api = getApi();
    if (!api.nip04?.decrypt) throw new Error('Extension does not support nip04 decryption');
    return api.nip04.decrypt(pubkey, ciphertext);
  }

  async nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    const api = getApi();
    if (!api.nip44?.encrypt) throw new Error('Extension does not support nip44 encryption');
    return api.nip44.encrypt(pubkey, plaintext);
  }

  async nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    const api = getApi();
    if (!api.nip44?.decrypt) throw new Error('Extension does not support nip44 decryption');
    return api.nip44.decrypt(pubkey, ciphertext);
  }
}
