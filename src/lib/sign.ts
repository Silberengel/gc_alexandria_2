import type { Event } from 'nostr-tools';
import { scrubTrackingInEventPartial } from './clean-url';
import { ALEXANDRIA_CLIENT, KIND } from './constants';
import { assertReadyToSign } from './kind-compose';
import { kindDescription } from './kind-label';
import { cacheGetEvent } from './nostr/cache';
import { memoryGetEvent } from './nostr/event-memory';
import { ingestEvent } from './nostr/verify';
import { session } from './stores/session';
import { showNotice, showPublishResult } from './stores/toast';
import { Nip07Signer } from './signers/nip07';
import type { BunkerSigner } from './signers/bunker';

/** Toast behavior for {@link signAndPublish} / {@link publishComment}. */
export type PublishFeedbackOpts = {
  /** Skip toast — caller shows its own, or this is background (presence / progress). */
  quiet?: boolean;
  /** Override the success toast copy. */
  successMessage?: string;
};

function publishSuccessCopy(kind: number, override?: string): string {
  if (override) return override;
  switch (kind) {
    case KIND.HIGHLIGHT:
      return 'Highlight published.';
    case KIND.COMMENT:
      return 'Comment published.';
    case KIND.REACTION:
      return 'Reaction published.';
    case KIND.RATING:
      return 'Rating published.';
    case KIND.DELETION:
      return 'Deletion published.';
    case KIND.REPOST:
    case KIND.GENERIC_REPOST:
      return 'Repost published.';
    case KIND.TEXT_NOTE:
      return 'Note published.';
    case KIND.LABEL:
      return 'Label published.';
    case KIND.READING_QUEUE:
      return 'Reading queue updated.';
    case KIND.DIRECTORY:
      return 'Folder published.';
    case KIND.ROOM_PRESENCE:
      return 'Joined the room.';
    case KIND.LIVE_CHAT:
      return 'Chat message published.';
    case KIND.PUBLIC_MESSAGE:
      return 'Message published.';
    default:
      return `${kindDescription(kind)} published.`;
  }
}

function notifyPublishOutcome(
  ok: boolean,
  kind: number,
  opts?: PublishFeedbackOpts
): void {
  if (opts?.quiet) return;
  if (ok) showPublishResult(true, publishSuccessCopy(kind, opts?.successMessage));
  else showPublishResult(false);
}

/** Strip every `client` tag, then append `["client", "Alexandria"]`. */
export function withClientTag(tags: string[][]): string[][] {
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

    const scrubbed = scrubTrackingInEventPartial(partial);
    const ready = assertReadyToSign(scrubbed);
    if (!ready.ok) {
      noteSignFailure(ready.error);
      return null;
    }

    const signed = await signer.signEvent({
      kind: scrubbed.kind,
      content: scrubbed.content,
      tags: withClientTag(scrubbed.tags)
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

/**
 * Sign and publish. Always shows a success/failure toast unless `quiet`.
 * Returns null when signing fails (or when every relay rejects and we do not
 * keep a local-only adoption path — see below).
 */
export async function signAndPublish(
  partial: {
    kind: number;
    content: string;
    tags: string[][];
  },
  opts?: PublishFeedbackOpts
): Promise<Event | null> {
  const signed = await signUnsigned(partial);
  if (!signed) {
    if (!opts?.quiet) {
      showNotice(consumeSignFailure() ?? 'Could not sign this.');
    }
    return null;
  }
  // session.publish adopts locally before relays; treat a successful sign as adopted
  // for UI paint, but toast failure when no relay accepted.
  const wrote = await publishSigned(signed);
  notifyPublishOutcome(wrote, signed.kind, opts);
  return signed;
}

/**
 * Sign a comment, publish it, and return the cached copy when at least one relay writes.
 * Shows a success or failure toast unless `quiet`. Returns null when signing or every relay fails.
 */
export async function publishComment(
  partial: {
    kind: number;
    content: string;
    tags: string[][];
  },
  opts?: PublishFeedbackOpts
): Promise<Event | null> {
  const signed = await signUnsigned(partial);
  if (!signed) {
    if (!opts?.quiet) {
      showNotice(consumeSignFailure() ?? 'Could not sign this.');
    }
    return null;
  }
  const wrote = await publishSigned(signed);
  if (!wrote) {
    notifyPublishOutcome(false, signed.kind, opts);
    return null;
  }
  const cached = (await cacheGetEvent(signed.id)) ?? memoryGetEvent(signed.id) ?? signed;
  notifyPublishOutcome(true, signed.kind, {
    ...opts,
    successMessage: opts?.successMessage ?? publishSuccessCopy(signed.kind)
  });
  return cached;
}
