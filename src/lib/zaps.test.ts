import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  formatCompactSats,
  formatCompactXmr,
  isKind1MoneroTip,
  isMoneroTipEvent,
  KIND_MONERO_TIP,
  KIND_MONERO_TIP_RECEIPT,
  parseMoneroTip,
  parseZap,
  satsFromBolt11,
  tipActorPubkey,
  tipNotificationText
} from './zaps';

function ev(partial: Partial<Event> & Pick<Event, 'kind'>): Event {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1,
    tags: [],
    content: '',
    sig: 'c'.repeat(128),
    ...partial
  };
}

describe('zaps', () => {
  it('parses sats from bolt11 HRP', () => {
    expect(satsFromBolt11('lnbc130n1p4xy8g4sp5p42y')).toBe(13);
    expect(satsFromBolt11('lnbc210n1p0fake')).toBe(21);
    expect(satsFromBolt11('lightning:lnbc1u1abc')).toBe(100);
    expect(satsFromBolt11('not-an-invoice')).toBeNull();
  });

  it('formats compact sats and XMR', () => {
    expect(formatCompactSats(1)).toBe('1 sat');
    expect(formatCompactSats(21)).toBe('21 sats');
    expect(formatCompactSats(2100)).toBe('2.1k sats');
    expect(formatCompactXmr(0.0001)).toBe('0.0001 XMR');
    expect(formatCompactXmr(1.25)).toBe('1.25 XMR');
  });

  it('reads zap amount from description when receipt has no amount tag', () => {
    const targetId = '0'.repeat(64);
    const sender = 'd'.repeat(64);
    const recipient = 'e'.repeat(64);
    const description = JSON.stringify({
      id: 'f'.repeat(64),
      pubkey: sender,
      created_at: 1,
      kind: 9734,
      tags: [
        ['amount', '13000'],
        ['p', recipient],
        ['e', targetId]
      ],
      content: 'thanks',
      sig: '00'
    });
    const zap = ev({
      kind: KIND.ZAP,
      pubkey: '9'.repeat(64),
      tags: [
        ['p', recipient],
        ['e', targetId],
        ['P', sender],
        ['bolt11', 'lnbc130n1p4xy8g4sp5p42y'],
        ['description', description]
      ]
    });
    const info = parseZap(zap);
    expect(info?.amountSats).toBe(13);
    expect(info?.senderPubkey).toBe(sender);
    expect(info?.recipientPubkey).toBe(recipient);
    expect(info?.targetEventId).toBe(targetId);
    expect(info?.comment).toBe('thanks');
    expect(tipActorPubkey(zap)).toBe(sender);
    expect(tipNotificationText(zap)).toBe('Zap · 13 sats — thanks');
  });

  it('reads zap amount from bolt11 when description omits amount', () => {
    const targetId = '1'.repeat(64);
    const zap = ev({
      kind: KIND.ZAP,
      tags: [
        ['p', '2'.repeat(64)],
        ['e', targetId],
        ['bolt11', 'lnbc210n1p0fake'],
        [
          'description',
          JSON.stringify({
            pubkey: '3'.repeat(64),
            kind: 9734,
            tags: [
              ['p', '2'.repeat(64)],
              ['e', targetId]
            ],
            content: ''
          })
        ]
      ]
    });
    expect(parseZap(zap)?.amountSats).toBe(21);
    expect(tipNotificationText(zap)).toBe('Zap · 21 sats');
  });

  it('parses Nosmero kind-9736 and Garnet kind-1814 tips', () => {
    const tip = ev({
      kind: KIND_MONERO_TIP,
      pubkey: '4'.repeat(64),
      content: 'cheers',
      tags: [
        ['p', '5'.repeat(64)],
        ['e', '6'.repeat(64)],
        ['amount', '0.0001'],
        ['txid', 'abc123']
      ]
    });
    expect(isMoneroTipEvent(tip)).toBe(true);
    expect(parseMoneroTip(tip)).toMatchObject({
      amountXmr: 0.0001,
      comment: 'cheers',
      txid: 'abc123',
      targetEventId: '6'.repeat(64)
    });
    expect(tipNotificationText(tip)).toBe('Monero tip · 0.0001 XMR — cheers');

    const receipt = ev({
      kind: KIND_MONERO_TIP_RECEIPT,
      pubkey: '7'.repeat(64),
      content: JSON.stringify({
        txid: 'deadbeef',
        message: 'ok',
        amount_xmr: '0.01'
      }),
      tags: [
        ['p', '8'.repeat(64)],
        ['e', 'a'.repeat(64)]
      ]
    });
    const parsed = parseMoneroTip(receipt);
    expect(parsed?.amountXmr).toBe(0.01);
    expect(parsed?.txid).toBe('deadbeef');
    expect(parsed?.comment).toBe('ok');
    expect(parsed?.verified).toBe(true);
  });

  it('recognizes PosterChan kind-1 monerotip notes', () => {
    const note = ev({
      kind: KIND.TEXT_NOTE,
      content: 'tip',
      tags: [
        ['t', 'monerotip'],
        ['amount_xmr', '0.0002'],
        ['e', 'b'.repeat(64)],
        ['p', 'c'.repeat(64)]
      ]
    });
    expect(isKind1MoneroTip(note)).toBe(true);
    expect(parseMoneroTip(note)?.amountXmr).toBe(0.0002);
    expect(tipNotificationText(note)).toBe('Monero tip · 0.0002 XMR — tip');
  });
});
