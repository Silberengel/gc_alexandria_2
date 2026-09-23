import type { Event } from 'nostr-tools';
import { ingestEvent } from './nostr/verify';
import { session } from './stores/session';
import { Nip07Signer } from './signers/nip07';

export async function signUnsigned(partial: {
  kind: number;
  content: string;
  tags: string[][];
}): Promise<Event | null> {
  let signer = session.getSigner();
  if (!signer) {
    // Lazy attach NIP-07 when the session painted from storage but the signer is not ready yet.
    if (!session.getPubkey() || !window.nostr?.signEvent) return null;
    try {
      signer = new Nip07Signer();
      await signer.getPublicKey();
    } catch {
      return null;
    }
  }
  try {
    const signed = await signer.signEvent({
      kind: partial.kind,
      content: partial.content,
      tags: partial.tags
    });
    return ingestEvent(signed);
  } catch {
    return null;
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
