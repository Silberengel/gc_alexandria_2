import { bytesToHex } from '@noble/hashes/utils';
import { BunkerSigner as NBunkerSigner, toBunkerURL } from 'nostr-tools/nip46';
import { openBunkerAuthUrl } from '../bunker-auth-url';
import type { DraftEvent, Signer } from '../signer';

/** Amber / NostrConnect (`nostrconnect://`) → NIP-46 bunker session. */
export class NostrConnectionSigner implements Signer {
  signer: NBunkerSigner | null = null;
  private clientSecretKey: Uint8Array;
  private pubkey: string | null = null;
  private connectionString: string;
  private bunkerString: string | null = null;

  constructor(clientSecretKey: Uint8Array, connectionString: string) {
    this.clientSecretKey = clientSecretKey;
    this.connectionString = connectionString;
  }

  async login(abortSignal?: AbortSignal): Promise<{ bunkerString: string | null; pubkey: string }> {
    if (this.pubkey) {
      return { bunkerString: this.bunkerString, pubkey: this.pubkey };
    }

    this.signer = await NBunkerSigner.fromURI(
      this.clientSecretKey,
      this.connectionString,
      {
        // Amber often never answers switch_relays; skip like imwald-android / jumble.
        skipSwitchRelays: true,
        onauth: (url) => {
          openBunkerAuthUrl(url);
        }
      },
      abortSignal ?? 300_000
    );
    this.bunkerString = toBunkerURL(this.signer.bp);
    this.pubkey = await this.signer.getPublicKey();
    return { bunkerString: this.bunkerString, pubkey: this.pubkey };
  }

  async getPublicKey(): Promise<string> {
    if (!this.signer) throw new Error('Not logged in');
    if (!this.pubkey) this.pubkey = await this.signer.getPublicKey();
    return this.pubkey;
  }

  async signEvent(draft: DraftEvent) {
    if (!this.signer) throw new Error('Not logged in');
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(
          new Error(
            'Amber did not approve the signature in time. Open Amber, approve the request, and try again.'
          )
        );
      }, 120_000);
      this.signer!.signEvent(draft).then(
        (value) => {
          window.clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          window.clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  async nip04Encrypt(pubkey: string, plaintext: string) {
    if (!this.signer) throw new Error('Not logged in');
    return this.signer.nip04Encrypt(pubkey, plaintext);
  }

  async nip04Decrypt(pubkey: string, ciphertext: string) {
    if (!this.signer) throw new Error('Not logged in');
    return this.signer.nip04Decrypt(pubkey, ciphertext);
  }

  async nip44Encrypt(pubkey: string, plaintext: string) {
    if (!this.signer) throw new Error('Not logged in');
    return this.signer.nip44Encrypt(pubkey, plaintext);
  }

  async nip44Decrypt(pubkey: string, ciphertext: string) {
    if (!this.signer) throw new Error('Not logged in');
    return this.signer.nip44Decrypt(pubkey, ciphertext);
  }

  getClientSecretKey(): string {
    return bytesToHex(this.clientSecretKey);
  }

  async close(): Promise<void> {
    try {
      await this.signer?.close();
    } catch {
      /* ignore */
    }
    this.signer = null;
  }
}
