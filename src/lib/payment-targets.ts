import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { ensureMetadata } from './ensure-metadata';
import { cachedIdentityEvent, rememberIdentityEvent } from './nostr/identity-cache';
import { memoryFindMetadata, rememberEvents } from './nostr/event-memory';
import { relayPool } from './nostr/pool';
import { profileStack, socialStack } from './nostr/selector';
import { isNewerReplaceable, pickLatestReplaceable } from './nostr/replaceable';
import {
  parseKind0,
  paymentRows,
  type PaymentRow
} from './profile-fields';

export type AuthorPaymentTargets = {
  pubkey: string;
  profile: Event | null;
  paymentEvents: Event[];
  rows: PaymentRow[];
};

function adoptPayment(event: Event): void {
  rememberEvents([event]);
  rememberIdentityEvent(event);
}

/**
 * Kind 0 + kind 10133 payment targets for an author (cache first, then relays).
 */
export async function loadAuthorPaymentTargets(pubkey: string): Promise<AuthorPaymentTargets> {
  const pk = pubkey.trim().toLowerCase();
  const empty: AuthorPaymentTargets = { pubkey: pk, profile: null, paymentEvents: [], rows: [] };
  if (!/^[0-9a-f]{64}$/.test(pk)) return empty;

  let profile =
    memoryFindMetadata(pk) ?? cachedIdentityEvent(KIND.METADATA, pk) ?? null;
  const cachedPay = cachedIdentityEvent(KIND.PAYMENT, pk);
  let paymentEvents = cachedPay ? [cachedPay] : [];

  const [meta, fetched] = await Promise.all([
    profile ? Promise.resolve(profile) : ensureMetadata(pk),
    relayPool.query(
      [...new Set([...profileStack(), ...socialStack()])],
      [
        { kinds: [KIND.METADATA], authors: [pk], limit: 1 },
        { kinds: [KIND.PAYMENT], authors: [pk], limit: 10 }
      ],
      4000
    )
  ]);

  if (meta) profile = meta;
  const remoteMeta = pickLatestReplaceable(fetched, KIND.METADATA, pk);
  if (remoteMeta) {
    if (!profile || isNewerReplaceable(remoteMeta, profile)) profile = remoteMeta;
  }

  const remotePays = fetched.filter((e) => e.kind === KIND.PAYMENT && e.pubkey.toLowerCase() === pk);
  if (remotePays.length) {
    for (const pay of remotePays) adoptPayment(pay);
    const byId = new Map<string, Event>();
    for (const e of [...paymentEvents, ...remotePays]) byId.set(e.id.toLowerCase(), e);
    paymentEvents = [...byId.values()].sort((a, b) => b.created_at - a.created_at);
  }

  const fields = parseKind0(profile);
  const rows = paymentRows(fields, paymentEvents, profile);
  return { pubkey: pk, profile, paymentEvents, rows };
}
