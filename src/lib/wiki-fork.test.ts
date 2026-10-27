import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  eventIsWikiForkOf,
  getWikiForkTarget,
  isWikiFork,
  uniqueWikiForks,
  wikiForkDraftFrom,
  wikiForkOriginHref
} from './wiki-fork';

function ev(partial: Partial<Event> & Pick<Event, 'kind' | 'pubkey'>): Event {
  return {
    id: (partial.id ?? 'a'.repeat(64)).slice(0, 64),
    created_at: partial.created_at ?? 1_700_000_000,
    content: partial.content ?? 'body',
    tags: partial.tags ?? [['d', 'bitcoin']],
    sig: 'c'.repeat(128),
    ...partial
  };
}

describe('wiki-fork', () => {
  it('reads fork markers', () => {
    const pk = 'b'.repeat(64);
    const article = ev({
      kind: KIND.WIKI,
      pubkey: 'f'.repeat(64),
      id: 'e'.repeat(64),
      tags: [
        ['d', 'bitcoin'],
        ['a', `30818:${pk}:bitcoin`, '', 'fork'],
        ['e', 'd'.repeat(64), '', 'fork']
      ]
    });
    expect(isWikiFork(article)).toBe(true);
    expect(getWikiForkTarget(article)?.coordinate).toBe(`30818:${pk}:bitcoin`);
    expect(getWikiForkTarget(article)?.eventId).toBe('d'.repeat(64));
  });

  it('detects inbound forks of a target and builds origin hrefs', () => {
    const originPk = 'b'.repeat(64);
    const forkPk = 'c'.repeat(64);
    const origin = ev({
      kind: KIND.WIKI,
      pubkey: originPk,
      id: '1'.repeat(64),
      tags: [['d', 'bitcoin'], ['title', 'Bitcoin']]
    });
    const fork = ev({
      kind: KIND.WIKI,
      pubkey: forkPk,
      id: '2'.repeat(64),
      created_at: 20,
      tags: [
        ['d', 'bitcoin'],
        ['title', 'Bitcoin fork'],
        ['a', `30818:${originPk}:bitcoin`, '', 'fork'],
        ['e', origin.id, '', 'fork']
      ]
    });
    const older = ev({
      kind: KIND.WIKI,
      pubkey: forkPk,
      id: '3'.repeat(64),
      created_at: 10,
      tags: [
        ['d', 'bitcoin'],
        ['a', `30818:${originPk}:bitcoin`, '', 'fork']
      ]
    });
    expect(eventIsWikiForkOf(fork, origin)).toBe(true);
    expect(eventIsWikiForkOf(origin, fork)).toBe(false);
    expect(uniqueWikiForks([fork, older, origin], origin).map((e) => e.id)).toEqual([fork.id]);
    expect(wikiForkOriginHref(origin)).toContain('/wiki/');
    expect(wikiForkOriginHref(null, getWikiForkTarget(fork))).toMatch(/\/wiki\/d\/bitcoin\/p\//);
  });

  it('builds a compose draft with fork_a/fork_e and strips prior fork/defer tags', () => {
    const pk = 'b'.repeat(64);
    const source = ev({
      kind: KIND.WIKI,
      pubkey: pk,
      id: '1'.repeat(64),
      content: 'Article text',
      tags: [
        ['d', 'bitcoin'],
        ['title', 'Bitcoin'],
        ['a', `30818:${'c'.repeat(64)}:bitcoin`, '', 'fork'],
        ['e', '2'.repeat(64), '', 'fork'],
        ['a', `30818:${'d'.repeat(64)}:bitcoin`, '', 'defer'],
        ['client', 'other']
      ]
    });
    const draft = wikiForkDraftFrom(source);
    expect(draft.kind).toBe(KIND.WIKI);
    expect(draft.content).toBe('Article text');
    expect(draft.values.d).toBe('bitcoin');
    expect(draft.values.title).toBe('Bitcoin');
    expect(draft.values.fork_a).toBe(`30818:${pk}:bitcoin`);
    expect(draft.values.fork_e).toBe('1'.repeat(64));
    expect(draft.values.defer_a).toBeUndefined();
    expect(draft.freeformTags.some((t) => t[3] === 'fork' || t[3] === 'defer')).toBe(false);
    expect(draft.freeformTags.some((t) => t[0] === 'client')).toBe(false);
  });
});
