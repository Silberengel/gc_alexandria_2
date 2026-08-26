import type { Event } from 'nostr-tools';
import { ingestEvent } from './nostr/verify';
import { mercuryPublish } from './nostr/mercury';
import { session } from './stores/session';

export async function signUnsigned(partial: {
  kind: number;
  content: string;
  tags: string[][];
}): Promise<Event | null> {
  const ext = window.nostr;
  if (!ext?.signEvent || !ext.getPublicKey) return null;
  const pubkey = (await ext.getPublicKey()).toLowerCase();
  const unsigned = {
    kind: partial.kind,
    content: partial.content,
    tags: partial.tags,
    created_at: Math.floor(Date.now() / 1000),
    pubkey
  };
  try {
    const signed = await ext.signEvent(unsigned);
    return ingestEvent(signed);
  } catch {
    return null;
  }
}

export async function publishSigned(event: Event): Promise<boolean> {
  try {
    await session.publish(event);
    void mercuryPublish(event);
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
