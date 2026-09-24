import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { generateSecretKey } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import { BunkerSigner as NBunkerSigner, parseBunkerInput } from 'nostr-tools/nip46';
import { openBunkerAuthUrl } from '../bunker-auth-url';
import type { BunkerLoginOptions, DraftEvent, Signer } from '../signer';

/** Private fields needed to rebind the NIP-46 filter after relays connect. */
type BunkerSignerSocketBind = {
  subCloser?: { close: () => void };
  setupSubscription: () => void;
};

export const BUNKER_CONNECT_TIMEOUT_MS = 25_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
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

export class BunkerSigner implements Signer {
  signer: NBunkerSigner | null = null;
  private clientSecretKey: Uint8Array;
  private pubkey: string | null = null;
  private pool: SimplePool | null = null;
  private relays: string[] = [];

  constructor(clientSecretKey?: string) {
    this.clientSecretKey = clientSecretKey ? hexToBytes(clientSecretKey) : generateSecretKey();
  }

  async login(
    bunker: string,
    isInitialConnection = true,
    options?: BunkerLoginOptions
  ): Promise<string> {
    const bunkerPointer = await parseBunkerInput(bunker);
    if (!bunkerPointer) throw new Error('Invalid bunker');
    if (isInitialConnection && !bunkerPointer.secret && !options?.allowMissingSecret) {
      throw new Error(
        'This bunker URI has no secret. In Amber, create a bunker connection and paste the full bunker:// link (including &secret=…).'
      );
    }

    const pool = new SimplePool();
    this.pool = pool;
    this.relays = [...bunkerPointer.relays];
    this.signer = NBunkerSigner.fromBunker(this.clientSecretKey, bunkerPointer, {
      pool,
      onauth: (url) => {
        openBunkerAuthUrl(url);
      }
    });

    // Always bring bunker relays up — mobile kills websockets while backgrounded.
    await Promise.all(
      this.relays.map(async (url) => {
        try {
          await pool.ensureRelay(url, { connectionTimeout: 12_000 });
        } catch {
          if (isInitialConnection) throw new Error(`Could not open bunker relay ${url}`);
        }
      })
    );
    this.rebindSubscription();

    if (isInitialConnection) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 200));

      const timeoutMs = options?.timeoutMs ?? BUNKER_CONNECT_TIMEOUT_MS;
      try {
        await withTimeout(
          this.signer.connect(),
          timeoutMs,
          'Timed out connecting to the remote signer. Check that the bunker relay is reachable and try again.'
        );
      } catch (err) {
        try {
          await this.signer.close();
        } catch {
          /* ignore */
        }
        this.signer = null;
        throw err;
      }
    }

    try {
      this.pubkey = await withTimeout(
        this.signer.getPublicKey(),
        options?.timeoutMs ?? BUNKER_CONNECT_TIMEOUT_MS,
        'Timed out reading the public key from the remote signer. Try again.'
      );
    } catch (err) {
      try {
        await this.signer.close();
      } catch {
        /* ignore */
      }
      this.signer = null;
      throw err;
    }
    return this.pubkey;
  }

  /** Re-open bunker relay sockets and NIP-46 subscription (needed after mobile sleep). */
  private rebindSubscription(): void {
    if (!this.signer) return;
    const bind = this.signer as unknown as BunkerSignerSocketBind;
    try {
      bind.subCloser?.close();
    } catch {
      /* ignore */
    }
    bind.subCloser = undefined;
    bind.setupSubscription();
  }

  async ensureConnected(): Promise<void> {
    if (!this.signer || !this.pool) return;
    await Promise.all(
      this.relays.map(async (url) => {
        try {
          await this.pool!.ensureRelay(url, { connectionTimeout: 8_000 });
        } catch {
          /* try sign anyway */
        }
      })
    );
    this.rebindSubscription();
  }

  async getPublicKey(): Promise<string> {
    if (!this.signer) throw new Error('Not logged in');
    if (!this.pubkey) this.pubkey = await this.signer.getPublicKey();
    return this.pubkey;
  }

  async signEvent(draft: DraftEvent) {
    if (!this.signer) throw new Error('Not logged in');
    await this.ensureConnected();
    const template = {
      kind: draft.kind,
      content: draft.content,
      tags: draft.tags,
      created_at: draft.created_at ?? Math.floor(Date.now() / 1000)
    };
    return withTimeout(
      this.signer.signEvent(template),
      120_000,
      'Amber did not approve the signature in time. Open Amber, approve the request, and try again.'
    );
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
    this.pool = null;
    this.relays = [];
  }
}
