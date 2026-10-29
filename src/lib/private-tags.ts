/**
 * NIP-51-style private entries: JSON tag rows (`string[][]`) in event content,
 * preferably NIP-44-encrypted to self (legacy NIP-04 accepted on decrypt).
 * Used by mute lists, directories, reading queues, and other entry-bag kinds.
 */
import type { Event } from 'nostr-tools';

export type DecryptPrivateTagsResult = {
  tags: string[][];
  /** True when content was empty, plaintext JSON, or successfully decrypted. */
  couldDecrypt: boolean;
};

/** Parse a JSON array of tag rows. */
export function parseTagRowsJson(plain: string): string[][] | null {
  try {
    const parsed = JSON.parse(plain) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((row): row is string[] => Array.isArray(row) && typeof row[0] === 'string');
  } catch {
    return null;
  }
}

/** NIP-04: base64?iv=base64. Rejects plaintext error strings that nos2x would log on. */
export function looksLikeNip04Ciphertext(content: string): boolean {
  const i = content.indexOf('?iv=');
  if (i <= 0) return false;
  const body = content.slice(0, i);
  const iv = content.slice(i + 4);
  return body.length > 0 && iv.length > 0 && !/\s/.test(content);
}

/**
 * NIP-44 payloads are base64(url) without whitespace. Short English error strings
 * (e.g. "Could not decrypt the message") must not be sent to the signer.
 */
export function looksLikeNip44Ciphertext(content: string): boolean {
  if (content.length < 48 || /\s/.test(content) || content.includes('?iv=')) return false;
  return /^[A-Za-z0-9+/_=-]+$/.test(content);
}

/**
 * Decrypt private tag rows from event content.
 * Plaintext JSON arrays (legacy / unsigned drafts) are accepted without crypto.
 */
export async function decryptPrivateTags(event: Event): Promise<string[][]> {
  const result = await decryptPrivateTagsDetailed(event);
  return result.tags;
}

export async function decryptPrivateTagsDetailed(
  event: Event
): Promise<DecryptPrivateTagsResult> {
  const content = event.content?.trim();
  if (!content) return { tags: [], couldDecrypt: true };
  // Some lists store private tags as plaintext JSON; never treat that as ciphertext.
  if (content.startsWith('[')) {
    const rows = parseTagRowsJson(content);
    return { tags: rows ?? [], couldDecrypt: rows != null };
  }

  const attempts: Array<(pubkey: string, ciphertext: string) => Promise<string>> = [];
  /** When true, never fall back to window.nostr (wrong key while Amber/bunker is the session). */
  let bunkerSession = false;

  try {
    const { session } = await import('./stores/session');
    bunkerSession = session.getSignerType() === 'bunker';
    const signer = session.getSigner();
    if (looksLikeNip44Ciphertext(content) && signer?.nip44Decrypt) {
      attempts.push((pk, ct) => signer.nip44Decrypt!(pk, ct));
    }
    if (looksLikeNip04Ciphertext(content) && signer?.nip04Decrypt) {
      attempts.push((pk, ct) => signer.nip04Decrypt!(pk, ct));
    }
    if (!bunkerSession) {
      const ext = typeof window !== 'undefined' ? window.nostr : undefined;
      if (looksLikeNip44Ciphertext(content) && typeof ext?.nip44?.decrypt === 'function') {
        attempts.push(ext.nip44.decrypt.bind(ext.nip44));
      }
      if (looksLikeNip04Ciphertext(content) && typeof ext?.nip04?.decrypt === 'function') {
        attempts.push(ext.nip04.decrypt.bind(ext.nip04));
      }
    }
  } catch {
    /* session unavailable */
  }

  if (!attempts.length && !bunkerSession) {
    const ext = typeof window !== 'undefined' ? window.nostr : undefined;
    if (looksLikeNip44Ciphertext(content) && typeof ext?.nip44?.decrypt === 'function') {
      attempts.push(ext.nip44.decrypt.bind(ext.nip44));
    }
    if (looksLikeNip04Ciphertext(content) && typeof ext?.nip04?.decrypt === 'function') {
      attempts.push(ext.nip04.decrypt.bind(ext.nip04));
    }
  }

  for (const decrypt of attempts) {
    try {
      // Huge private lists can freeze the UI for minutes in nos2x-fox — bail out.
      const plain = await Promise.race([
        decrypt(event.pubkey, content),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500))
      ]);
      if (plain == null) continue;
      const rows = parseTagRowsJson(plain);
      if (rows) return { tags: rows, couldDecrypt: true };
    } catch {
      /* try next decryptor */
    }
  }
  return { tags: [], couldDecrypt: false };
}

/** Encrypt a JSON tag-array string to the signed-in pubkey (NIP-44). */
export async function encryptPrivateTagsJson(privateJson: string): Promise<string> {
  const trimmed = privateJson.trim();
  if (!trimmed) return '';
  const { session } = await import('./stores/session');
  const pk = session.getPubkey();
  if (!pk) throw new Error('Sign in before encrypting private tags.');
  const signer = session.getSigner();
  if (!signer?.nip44Encrypt) {
    throw new Error('Your signer does not support NIP-44 encryption.');
  }
  return signer.nip44Encrypt(pk, trimmed);
}

export async function encryptPrivateTags(tags: string[][]): Promise<string> {
  if (!tags.length) return '';
  return encryptPrivateTagsJson(JSON.stringify(tags));
}

/**
 * Choose content for a replaceable republish.
 * - New private tags → encrypt (or plaintext JSON if encrypt fails and allowPlaintext)
 * - No private tags + previous ciphertext we could not decrypt → preserve previous content
 * - Otherwise empty
 */
export async function contentForPrivateTags(opts: {
  privateTags: string[][];
  previousContent?: string;
  couldDecryptPrevious?: boolean;
  /** When encrypt is unavailable, leave plaintext JSON (compose mute path). Default false. */
  allowPlaintextFallback?: boolean;
}): Promise<string> {
  const { privateTags, previousContent = '', couldDecryptPrevious = true } = opts;
  if (privateTags.length) {
    const json = JSON.stringify(privateTags);
    try {
      return await encryptPrivateTagsJson(json);
    } catch {
      if (opts.allowPlaintextFallback) return json;
      throw new Error('Could not encrypt private tags.');
    }
  }
  const prev = previousContent.trim();
  if (prev && !couldDecryptPrevious) return previousContent;
  return '';
}
