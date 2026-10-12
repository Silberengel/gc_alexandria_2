import type { Event } from 'nostr-tools';
import { ALEXANDRIA_CLIENT } from './constants';
import { cacheGetEvent } from './nostr/cache';
import { memoryGetEvent } from './nostr/event-memory';
import { ingestEvent } from './nostr/verify';
import { session } from './stores/session';
import { showNotice, showPublishResult } from './stores/toast';
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

/** Why the latest `signUnsigned` returned null, until the caller reads it. */
let signFailure: string | null = null;

const STALE_BUNKER =
  'The signer connection is stale. Open Amber and connect again, then try again.';

export function isSignInFlight(): boolean {
  return signDepth > 0;
}

/** User-facing reason for the last failed sign, then cleared. */
export function consumeSignFailure(): string | null {
  const message = signFailure;
  signFailure = null;
  return message;
}

function noteSignFailure(message: string): void {
  signFailure = message;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message.trim() : '';
}

function bunkerSignFailure(err: unknown): string {
  const text = errorText(err);
  if (
    /not logged in|could not open bunker|timed out connecting|timed out reading the public key|invalid bunker/i.test(
      text
    )
  ) {
    return STALE_BUNKER;
  }
  return text || STALE_BUNKER;
}

export async function signUnsigned(partial: {
  kind: number;
  content: string;
  tags: string[][];
}): Promise<Event | null> {
  signDepth += 1;
  signFailure = null;
  const signerType = session.getSignerType();
  try {
    const expectedPubkey = session.getPubkey()?.toLowerCase() ?? '';
    let signer = session.getSigner();

    if (!signer) {
      if (signerType === 'bunker') {
        // Amber / bunker session — never fall through to window.nostr (nos2x).
        const ok = await session.ensureBunkerSigner();
        signer = session.getSigner();
        if (!ok || !signer) {
          console.warn(
            '[alexandria:sign] bunker session has no live signer; refusing NIP-07 fallback'
          );
          noteSignFailure(STALE_BUNKER);
          return null;
        }
      } else if (signerType === 'nip07' || (!signerType && expectedPubkey && window.nostr?.signEvent)) {
        // Lazy attach NIP-07 when the session painted from storage but the signer is not ready yet.
        try {
          signer = new Nip07Signer();
          await signer.getPublicKey();
        } catch (err) {
          noteSignFailure(errorText(err) || 'The browser signer is not available.');
          return null;
        }
      } else {
        noteSignFailure('Sign in again before trying this.');
        return null;
      }
    }

    // Bunker identity must never use a NIP-07 extension, even if one is installed.
    if (signerType === 'bunker' && signer instanceof Nip07Signer) {
      console.warn('[alexandria:sign] bunker session had NIP-07 signer; reconnecting Amber');
      const ok = await session.ensureBunkerSigner();
      signer = session.getSigner();
      if (!ok || !signer || signer instanceof Nip07Signer) {
        console.warn('[alexandria:sign] could not rebuild bunker signer');
        noteSignFailure(STALE_BUNKER);
        return null;
      }
    }

    // Mobile: wake bunker relay sockets before asking Amber to sign.
    if (
      signer &&
      'ensureConnected' in signer &&
      typeof (signer as BunkerSigner).ensureConnected === 'function'
    ) {
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
    const event = ingestEvent(signed);
    if (!event) {
      noteSignFailure('The signature could not be verified.');
      return null;
    }
    // Guard against an extension signing as a different key while bunker was intended.
    if (expectedPubkey && event.pubkey.toLowerCase() !== expectedPubkey) {
      console.warn('[alexandria:sign] signed pubkey mismatch; dropping event', {
        expected: expectedPubkey.slice(0, 8),
        got: event.pubkey.slice(0, 8),
        signerType
      });
      noteSignFailure('The signer used a different key than the one you are signed in with.');
      return null;
    }
    return event;
  } catch (err) {
    console.warn('[alexandria:sign] sign failed', err);
    noteSignFailure(
      signerType === 'bunker'
        ? bunkerSignFailure(err)
        : errorText(err) || 'The signer did not approve this.'
    );
    return null;
  } finally {
    signDepth = Math.max(0, signDepth - 1);
  }
}

/** True when at least one relay accepted the event. */
export async function publishSigned(event: Event): Promise<boolean> {
  try {
    return await session.publish(event);
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
  // session.publish adopts locally before relays; always treat a successful sign as adopted.
  await publishSigned(signed);
  return signed;
}

/**
 * Sign a comment, publish it, and return the cached copy when at least one relay writes.
 * Shows a success or failure toast. Returns null when signing or every relay fails.
 */
export async function publishComment(partial: {
  kind: number;
  content: string;
  tags: string[][];
}): Promise<Event | null> {
  const signed = await signUnsigned(partial);
  if (!signed) {
    showNotice(consumeSignFailure() ?? 'Could not sign this.');
    return null;
  }
  const wrote = await publishSigned(signed);
  if (!wrote) {
    showPublishResult(false);
    return null;
  }
  const cached = (await cacheGetEvent(signed.id)) ?? memoryGetEvent(signed.id) ?? signed;
  showPublishResult(true);
  return cached;
}
