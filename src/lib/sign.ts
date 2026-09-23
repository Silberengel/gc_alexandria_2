import type { Event } from 'nostr-tools';
import { ALEXANDRIA_CLIENT } from './constants';
import { ingestEvent } from './nostr/verify';
import { session } from './stores/session';
import { Nip07Signer } from './signers/nip07';
import type { BunkerSigner } from './signers/bunker';

/** One `client` tag naming this app. Replaces any other client tag on the draft. */
export function withClientTag(tags: string[][]): string[][] {
  if (tags.some((t) => t[0] === 'client' && t[1] === ALEXANDRIA_CLIENT && t.length === 2)) {
    return tags;
  }
  return [...tags.filter((t) => t[0] !== 'client'), ['client', ALEXANDRIA_CLIENT]];
}

/** Nested NIP-46 / extension sign calls in flight (Amber opens → page hides). */
let signDepth = 0;

export function isSignInFlight(): boolean {
  return signDepth > 0;
}

export async function signUnsigned(partial: {
  kind: number;
  content: string;
  tags: string[][];
}): Promise<Event | null> {
  signDepth += 1;
  try {
    let signer = session.getSigner();
    if (!signer) {
      // Painted bunker identity with a dead socket — rebuild before giving up.
      if (session.getSignerType() === 'bunker' && session.getPubkey()) {
        try {
          await session.ensureBunkerSigner();
          signer = session.getSigner();
        } catch {
          return null;
        }
      }
      // Lazy attach NIP-07 when the session painted from storage but the signer is not ready yet.
      if (!signer) {
        if (!session.getPubkey() || !window.nostr?.signEvent) return null;
        try {
          signer = new Nip07Signer();
          await signer.getPublicKey();
        } catch {
          return null;
        }
      }
    }
    // Mobile: wake bunker relay sockets before asking Amber to sign.
    if (signer && 'ensureConnected' in signer && typeof (signer as BunkerSigner).ensureConnected === 'function') {
      try {
        await (signer as BunkerSigner).ensureConnected();
      } catch {
        /* sign may still work */
      }
    }
    const signed = await signer.signEvent({
      kind: partial.kind,
      content: partial.content,
      tags: withClientTag(partial.tags)
    });
    return ingestEvent(signed);
  } catch (err) {
    console.warn('[alexandria:sign] sign failed', err);
    return null;
  } finally {
    signDepth = Math.max(0, signDepth - 1);
  }
}

export async function publishSigned(event: Event): Promise<boolean> {
  try {
    await session.publish(event);
    return true;
  } catch {
    return false;
  }
}

export async function signAndPublish(partial: {
  kind: number;
  content: string;
  tags: string[][];
}): Promise<Event | null> {
  const signed = await signUnsigned(partial);
  if (!signed) return null;
  const ok = await publishSigned(signed);
  return ok ? signed : null;
}
