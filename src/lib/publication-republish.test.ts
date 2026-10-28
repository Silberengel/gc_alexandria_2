import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import {
  collectPublicationEventsForRepublish,
  republishPublicationToWriteRelays
} from './publication-republish';
import { setSelectorContext } from './nostr/selector';

vi.mock('./publication-export', () => ({
  collectPublicationEventsForExport: vi.fn(async (_root: Event, seed: Event[] = []) => seed)
}));

vi.mock('./nostr/pool', () => ({
  relayPool: {
    broadcast: vi.fn(async () => 1)
  }
}));

import { collectPublicationEventsForExport } from './publication-export';
import { relayPool } from './nostr/pool';

function ev(partial: Partial<Event> & Pick<Event, 'kind' | 'id'>): Event {
  return {
    pubkey: 'a'.repeat(64),
    created_at: 1,
    tags: [],
    content: '',
    sig: 'b'.repeat(128),
    ...partial
  };
}

describe('publication republish', () => {
  beforeEach(() => {
    vi.mocked(collectPublicationEventsForExport).mockClear();
    vi.mocked(relayPool.broadcast).mockClear();
    vi.mocked(relayPool.broadcast).mockResolvedValue(1);
    setSelectorContext({
      signedIn: true,
      viewerPubkey: 'c'.repeat(64),
      inbox: [],
      outbox: ['wss://outbox.example'],
      favorites: [],
      local: [],
      blocked: []
    });
  });

  afterEach(() => {
    setSelectorContext({
      signedIn: false,
      viewerPubkey: '',
      inbox: [],
      outbox: [],
      favorites: [],
      local: [],
      blocked: []
    });
  });

  it('collects the root plus nested seed events once each', async () => {
    const root = ev({
      id: '1'.repeat(64),
      kind: KIND.PUBLICATION,
      tags: [['d', 'book']]
    });
    const section = ev({ id: '2'.repeat(64), kind: KIND.SECTION, tags: [['d', 'ch1']] });
    const nestedIndex = ev({
      id: '3'.repeat(64),
      kind: KIND.PUBLICATION,
      tags: [['d', 'part']]
    });
    const events = await collectPublicationEventsForRepublish(root, [
      section,
      nestedIndex,
      section
    ]);
    expect(events.map((e) => e.id)).toEqual([root.id, section.id, nestedIndex.id]);
  });

  it('refuses non-publication roots', async () => {
    const result = await republishPublicationToWriteRelays(
      ev({ id: '1'.repeat(64), kind: KIND.SECTION })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/30040/);
    expect(relayPool.broadcast).not.toHaveBeenCalled();
  });

  it('requires a signed-in write stack', async () => {
    setSelectorContext({
      signedIn: false,
      viewerPubkey: '',
      inbox: [],
      outbox: [],
      favorites: [],
      local: [],
      blocked: []
    });
    const result = await republishPublicationToWriteRelays(
      ev({ id: '1'.repeat(64), kind: KIND.PUBLICATION, tags: [['d', 'book']] })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/write relays/i);
  });

  it('broadcasts every collected event to the write stack', async () => {
    const root = ev({
      id: '1'.repeat(64),
      kind: KIND.PUBLICATION,
      tags: [['d', 'book']]
    });
    const section = ev({ id: '2'.repeat(64), kind: KIND.SECTION, tags: [['d', 'ch1']] });
    const wiki = ev({ id: '3'.repeat(64), kind: KIND.WIKI, tags: [['d', 'note']] });
    vi.mocked(collectPublicationEventsForExport).mockResolvedValueOnce([section, wiki]);

    const phases: string[] = [];
    const result = await republishPublicationToWriteRelays(root, {
      onProgress: (p) => phases.push(p.phase)
    });

    expect(result.ok).toBe(true);
    expect(result.eventCount).toBe(3);
    expect(result.acceptedEvents).toBe(3);
    expect(result.failedIds).toEqual([]);
    expect(relayPool.broadcast).toHaveBeenCalledTimes(3);
    expect(vi.mocked(relayPool.broadcast).mock.calls[0]?.[0]).toEqual(['wss://outbox.example']);
    expect(phases[0]).toBe('collecting');
    expect(phases).toContain('publishing');
    expect(phases.at(-1)).toBe('done');
  });

  it('reports events that no relay accepted', async () => {
    const root = ev({
      id: '1'.repeat(64),
      kind: KIND.PUBLICATION,
      tags: [['d', 'book']]
    });
    const section = ev({ id: '2'.repeat(64), kind: KIND.SECTION, tags: [['d', 'ch1']] });
    vi.mocked(collectPublicationEventsForExport).mockResolvedValueOnce([section]);
    vi.mocked(relayPool.broadcast)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0);

    const result = await republishPublicationToWriteRelays(root);
    expect(result.ok).toBe(true);
    expect(result.acceptedEvents).toBe(1);
    expect(result.failedIds).toEqual([section.id]);
  });
});
