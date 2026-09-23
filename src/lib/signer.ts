import type { Event } from 'nostr-tools';

/** Unsigned event fields passed to a signer (NIP-07 / NIP-46). */
export type DraftEvent = {
  kind: number;
  content: string;
  tags: string[][];
  created_at?: number;
  pubkey?: string;
};

/** Shared signer surface — NIP-07 extension, Amber bunker, or Pomegranate. */
export interface Signer {
  getPublicKey(): Promise<string>;
  signEvent(draft: DraftEvent): Promise<Event>;
  nip04Encrypt?(pubkey: string, plaintext: string): Promise<string>;
  nip04Decrypt?(pubkey: string, ciphertext: string): Promise<string>;
  nip44Encrypt?(pubkey: string, plaintext: string): Promise<string>;
  nip44Decrypt?(pubkey: string, ciphertext: string): Promise<string>;
}

export type SignerType = 'nip07' | 'bunker';

export type BunkerLoginOptions = {
  allowMissingSecret?: boolean;
  timeoutMs?: number;
};
