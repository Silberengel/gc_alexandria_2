import type { Event } from 'nostr-tools';
import { KIND } from './constants';

const HEX_64 = /^[0-9a-f]{64}$/i;
const BOLT11_HRP = /^ln(?:bc|tb|bcrt)(\d+)([munp]?)1/i;

/** Nosmero / Monero tip disclosure (amount in XMR). */
export const KIND_MONERO_TIP = KIND.MONERO_TIP;
/** Garnet / jumble Monero tip receipt. */
export const KIND_MONERO_TIP_RECEIPT = KIND.MONERO_TIP_RECEIPT;

export const MONERO_TIP_KINDS: ReadonlySet<number> = new Set([
  KIND.MONERO_TIP,
  KIND.MONERO_TIP_RECEIPT
]);

export type ZapInfo = {
  senderPubkey: string;
  recipientPubkey: string | null;
  amountSats: number | null;
  comment: string | null;
  targetEventId: string | null;
  targetCoordinate: string | null;
};

/** Kind-9736 Nosmero disclosure / kind-1814 Garnet receipt / kind-1 `#monerotip`. */
export type MoneroTipInfo = {
  senderPubkey: string;
  recipientPubkey: string | null;
  amountXmr: number | null;
  comment: string | null;
  targetEventId: string | null;
  targetCoordinate: string | null;
  txid: string | null;
  verified: boolean;
};

/** Sats from a BOLT11 invoice HRP (imwald Bolt11Amount parity). */
export function satsFromBolt11(invoice: string): number | null {
  const raw = invoice.trim().replace(/^lightning:/i, '');
  const match = BOLT11_HRP.exec(raw);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = (match[2] ?? '').toLowerCase();
  let sats: number | null;
  switch (unit) {
    case 'm':
      sats = amount * 100_000;
      break;
    case 'u':
      sats = amount * 100;
      break;
    case 'n':
      sats = Math.floor(amount / 10);
      break;
    case 'p':
      sats = Math.floor(amount / 1_000);
      break;
    case '':
      sats = amount * 100_000_000;
      break;
    default:
      sats = null;
  }
  return sats != null && sats > 0 ? sats : null;
}

export function formatCompactSats(amount: number): string {
  const n = Math.floor(amount);
  if (!Number.isFinite(n) || n <= 0) return '0 sats';
  const number =
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
      : n >= 1_000
        ? `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`
        : String(n);
  return `${number} ${n === 1 ? 'sat' : 'sats'}`;
}

/** Compact XMR label (imwald formatCompactXmr parity). */
export function formatCompactXmr(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '0 XMR';
  const raw = (
    amount >= 100
      ? amount.toFixed(0)
      : amount >= 1
        ? amount.toFixed(2)
        : amount >= 0.01
          ? amount.toFixed(3)
          : amount.toFixed(4)
  )
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
  return `${raw} XMR`;
}

function firstTag(event: Event, name: string): string | null {
  for (const tag of event.tags) {
    if (tag[0] === name && tag[1]?.trim()) return tag[1].trim();
  }
  return null;
}

function firstTagCi(event: Event, name: string): string | null {
  const want = name.toLowerCase();
  for (const tag of event.tags) {
    if ((tag[0] ?? '').toLowerCase() === want && tag[1]?.trim()) return tag[1].trim();
  }
  return null;
}

function targetEventIdFromTags(event: Event): string | null {
  for (const tag of event.tags) {
    if ((tag[0] === 'e' || tag[0] === 'E') && tag[1] && HEX_64.test(tag[1])) {
      return tag[1].toLowerCase();
    }
  }
  return null;
}

function targetCoordinateFromTags(event: Event): string | null {
  return firstTagCi(event, 'a');
}

function looksLikeJson(text: string): boolean {
  const t = text.trim();
  return t.startsWith('{') && t.endsWith('}');
}

function humanText(text: string): string | null {
  const t = text.trim();
  if (!t || looksLikeJson(t)) return null;
  return t;
}

function parsePositiveXmr(raw: string | null | undefined): number | null {
  if (raw == null || !String(raw).trim()) return null;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function hasHashtag(event: Event, tag: string): boolean {
  const needle = tag.toLowerCase();
  return event.tags.some(
    (row) =>
      (row[0] ?? '').toLowerCase() === 't' && (row[1] ?? '').trim().toLowerCase() === needle
  );
}

function msatsToSats(raw: string | null | undefined): number | null {
  if (raw == null || !String(raw).trim()) return null;
  const msats = Number(String(raw).trim());
  if (!Number.isFinite(msats) || msats <= 0) return null;
  const sats = Math.floor(msats / 1000);
  return sats > 0 ? sats : null;
}

/**
 * NIP-57 zap receipt (kind 9735).
 * Amount: receipt `amount` (msats) → description request tags → bolt11 HRP.
 */
export function parseZap(event: Event): ZapInfo | null {
  if (event.kind !== KIND.ZAP) return null;
  let sender = firstTag(event, 'P');
  let recipient = firstTag(event, 'p');
  let targetEvent = targetEventIdFromTags(event);
  let targetCoordinate = targetCoordinateFromTags(event);
  let amountSats = msatsToSats(firstTag(event, 'amount'));
  let comment: string | null = null;

  const description = firstTag(event, 'description');
  if (description) {
    try {
      const obj = JSON.parse(description) as {
        content?: unknown;
        pubkey?: unknown;
        tags?: unknown;
      };
      if (!comment && typeof obj.content === 'string' && obj.content.trim()) {
        comment = obj.content.trim();
      }
      if (!sender && typeof obj.pubkey === 'string' && obj.pubkey.trim()) {
        sender = obj.pubkey.trim();
      }
      if (Array.isArray(obj.tags)) {
        for (const row of obj.tags) {
          if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
          const name = row[0].toLowerCase();
          const value = typeof row[1] === 'string' ? row[1].trim() : '';
          if (!value) continue;
          if (name === 'amount' && amountSats == null) amountSats = msatsToSats(value);
          if (name === 'p' && !recipient) recipient = value;
          if ((name === 'e' || name === 'E') && !targetEvent && HEX_64.test(value)) {
            targetEvent = value.toLowerCase();
          }
          if (name === 'a' && !targetCoordinate) targetCoordinate = value;
        }
      }
    } catch {
      /* ignore bad description JSON */
    }
  }

  if (amountSats == null || amountSats <= 0) {
    const bolt11 = firstTag(event, 'bolt11');
    if (bolt11) amountSats = satsFromBolt11(bolt11);
  }

  const resolvedSender = sender?.trim() || event.pubkey;
  if (!recipient && amountSats == null && !comment) return null;
  return {
    senderPubkey: resolvedSender,
    recipientPubkey: recipient,
    amountSats,
    comment: comment && !looksLikeJson(comment) ? comment : null,
    targetEventId: targetEvent,
    targetCoordinate
  };
}

/** PosterChan-style kind-1 tip: `#monerotip` + `amount_xmr` + target `e`. */
export function isKind1MoneroTip(event: Event): boolean {
  return event.kind === KIND.TEXT_NOTE && parseKind1MoneroTip(event) != null;
}

export function isMoneroTipEvent(event: Event): boolean {
  return MONERO_TIP_KINDS.has(event.kind) || isKind1MoneroTip(event);
}

export function parseMoneroTip(event: Event): MoneroTipInfo | null {
  if (event.kind === KIND.TEXT_NOTE) return parseKind1MoneroTip(event);
  if (!MONERO_TIP_KINDS.has(event.kind)) return null;
  if (event.kind === KIND_MONERO_TIP_RECEIPT) return parseGarnetTipReceipt(event);

  const recipient = firstTag(event, 'p');
  const sender = firstTag(event, 'P') || event.pubkey;
  const targetEvent = targetEventIdFromTags(event);
  const targetCoordinate = targetCoordinateFromTags(event);
  const amountXmr = parsePositiveXmr(
    firstTag(event, 'amount') ?? firstTagCi(event, 'amount_xmr')
  );
  const verified =
    firstTag(event, 'verified')?.toLowerCase() === 'true';
  const txid = firstTagCi(event, 'txid');
  const comment = humanText(event.content);
  if (!recipient && amountXmr == null && !comment && !targetEvent) return null;
  return {
    senderPubkey: sender,
    recipientPubkey: recipient,
    amountXmr,
    comment,
    targetEventId: targetEvent,
    targetCoordinate,
    txid,
    verified
  };
}

function parseKind1MoneroTip(event: Event): MoneroTipInfo | null {
  if (!hasHashtag(event, 'monerotip')) return null;
  const amountXmr = parsePositiveXmr(firstTagCi(event, 'amount_xmr'));
  if (amountXmr == null) return null;
  const targetEvent = targetEventIdFromTags(event);
  if (!targetEvent) return null;
  return {
    senderPubkey: event.pubkey,
    recipientPubkey: firstTag(event, 'p'),
    amountXmr,
    comment: humanText(event.content),
    targetEventId: targetEvent,
    targetCoordinate: targetCoordinateFromTags(event),
    txid: firstTagCi(event, 'txid'),
    verified: false
  };
}

type GarnetTipProof = {
  txid: string | null;
  message: string | null;
  amountRaw: string | null;
};

function parseGarnetTipProof(content: string): GarnetTipProof | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    const str = (...keys: string[]): string | null => {
      for (const key of keys) {
        const v = obj[key];
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
      return null;
    };
    return {
      txid: str('txid', 'txId'),
      message: str('message'),
      amountRaw: str('amount', 'amount_xmr', 'amountXmr')
    };
  } catch {
    return null;
  }
}

function parseGarnetTipReceipt(event: Event): MoneroTipInfo | null {
  const proof = parseGarnetTipProof(event.content);
  const recipient = firstTag(event, 'p');
  const targetEvent = targetEventIdFromTags(event);
  const targetCoordinate = targetCoordinateFromTags(event);
  const amountXmr = parsePositiveXmr(
    firstTag(event, 'amount') ?? firstTagCi(event, 'amount_xmr') ?? proof?.amountRaw
  );
  const txid = proof?.txid ?? firstTagCi(event, 'txid');
  const comment = proof?.message?.trim() || null;
  if (!recipient && amountXmr == null && !comment && !targetEvent && !txid) return null;
  return {
    senderPubkey: event.pubkey,
    recipientPubkey: recipient,
    amountXmr,
    comment,
    targetEventId: targetEvent,
    targetCoordinate,
    txid,
    verified: !!txid
  };
}

/** Pubkey to show as the tipper / zapper in feed rows. */
export function tipActorPubkey(event: Event): string {
  const zap = parseZap(event);
  if (zap) return zap.senderPubkey;
  const tip = parseMoneroTip(event);
  if (tip) return tip.senderPubkey;
  return event.pubkey;
}

/** One-line notification preview for Lightning zap or Monero tip. */
export function tipNotificationText(event: Event): string | null {
  const zap = parseZap(event);
  if (zap) {
    const amount =
      zap.amountSats != null && zap.amountSats > 0
        ? formatCompactSats(zap.amountSats)
        : null;
    if (amount && zap.comment) return `Zap · ${amount} — ${zap.comment}`;
    if (amount) return `Zap · ${amount}`;
    if (zap.comment) return `Zap — ${zap.comment}`;
    return 'Zap receipt';
  }
  const tip = parseMoneroTip(event);
  if (tip) {
    const amount =
      tip.amountXmr != null && tip.amountXmr > 0 ? formatCompactXmr(tip.amountXmr) : null;
    if (amount && tip.comment) return `Monero tip · ${amount} — ${tip.comment}`;
    if (amount) return `Monero tip · ${amount}`;
    if (tip.comment) return `Monero tip — ${tip.comment}`;
    return 'Monero tip';
  }
  return null;
}
