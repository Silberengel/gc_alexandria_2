import { describe, expect, it } from 'vitest';
import { eventSources, noteEventSource, noteEventSources } from './event-sources';

describe('event sources', () => {
  it('accumulates and sorts unique relay URLs per event id', () => {
    const id = 'a'.repeat(64);
    noteEventSource(id, 'wss://nostr.land');
    noteEventSource(id.toUpperCase(), 'wss://mercury-relay.imwald.eu');
    noteEventSources(id, ['wss://nostr.land', 'wss://thecitadel.nostr1.com']);
    expect(eventSources(id)).toEqual([
      'wss://mercury-relay.imwald.eu',
      'wss://nostr.land',
      'wss://thecitadel.nostr1.com'
    ]);
  });
});
