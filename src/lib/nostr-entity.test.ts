import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  eventBech32FromDestination,
  urlEmbedsNostrEvent,
  visibleEventLinkLabel
} from './nostr-entity';

const naddr = nip19.naddrEncode({
  kind: 30311,
  pubkey: 'f'.repeat(64),
  identifier: '92f789a1-f387-439a-b18f-f247b7baf9e6'
});

describe('eventBech32FromDestination', () => {
  it('reads bare and nostr: tokens', () => {
    expect(eventBech32FromDestination(naddr)).toBe(naddr);
    expect(eventBech32FromDestination(`nostr:${naddr}`)).toBe(naddr);
  });

  it('finds the entity inside an njump URL without rewriting it', () => {
    const url = `https://njump.me/${naddr}`;
    expect(eventBech32FromDestination(url)).toBe(naddr);
    expect(urlEmbedsNostrEvent(url)).toBe(true);
    expect(urlEmbedsNostrEvent('https://example.com/x')).toBe(false);
  });
});

describe('visibleEventLinkLabel', () => {
  it('keeps host and crops a long path', () => {
    const label = visibleEventLinkLabel(`https://njump.me/${naddr}`);
    expect(label.startsWith('njump.me/')).toBe(true);
    expect(label.length).toBeLessThan(naddr.length + 20);
  });
});
