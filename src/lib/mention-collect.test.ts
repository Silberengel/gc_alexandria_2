import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { collectMentionCandidates } from './mention-collect';

const ada = 'a'.repeat(64);
const grace = 'b'.repeat(64);
const relayOnly = 'c'.repeat(64);

function profile(pubkey: string, content: string, created_at = 10): Event {
  return {
    id: pubkey.slice(0, 64),
    pubkey,
    created_at,
    kind: KIND.METADATA,
    tags: [],
    content,
    sig: 'd'.repeat(128)
  };
}

describe('collectMentionCandidates', () => {
  it('lists follows before the profile cache and relay hits', () => {
    const rows = collectMentionCandidates('ada', {
      follows: [{ pubkey: ada, petname: '' }],
      cached: [
        profile(ada, '{"name":"ada","display_name":"Ada Follow"}'),
        profile(grace, '{"display_name":"Ada Cached"}')
      ],
      network: [profile(relayOnly, '{"display_name":"Ada Relay"}')]
    });
    expect(rows.map((row) => row.pubkey)).toEqual([ada, grace, relayOnly]);
  });

  it('matches a follow petname and a kind-0 petname', () => {
    const rows = collectMentionCandidates('boss', {
      follows: [{ pubkey: ada, petname: 'Boss' }],
      cached: [profile(grace, '{"name":"grace","petname":"boss"}')]
    });
    expect(rows.map((row) => row.pubkey)).toEqual([ada, grace]);
  });

  it('matches a kind-0 username', () => {
    const rows = collectMentionCandidates('lovelace', {
      follows: [],
      cached: [profile(ada, '{"username":"lovelace","display_name":"Ada"}')]
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('lovelace');
  });

  it('shows follows for a bare @ and skips the wider cache', () => {
    const rows = collectMentionCandidates('', {
      follows: [
        { pubkey: ada, petname: 'Ada' },
        { pubkey: grace, petname: '' }
      ],
      cached: [profile(relayOnly, '{"name":"stranger"}')]
    });
    expect(rows.map((row) => row.pubkey)).toEqual([ada, grace]);
  });
});
