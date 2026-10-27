import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  buildMuteListPayload,
  formatMuteRows,
  mutedRawFromTags,
  muteRowsFromRaw
} from './compose-mute-list';

describe('compose-mute-list', () => {
  const pk = 'a'.repeat(64);
  const eid = 'b'.repeat(64);

  it('parses public and private mute lines', () => {
    const rows = muteRowsFromRaw(`p ${pk}\nprivate word spam\ne ${eid}\nt nostr`);
    expect(rows).toEqual([
      { tag: 'p', value: pk, private: false },
      { tag: 'word', value: 'spam', private: true },
      { tag: 'e', value: eid, private: false },
      { tag: 't', value: 'nostr', private: false }
    ]);
  });

  it('builds public tags and private JSON', () => {
    const npub = nip19.npubEncode(pk);
    const payload = buildMuteListPayload(
      `p ${npub}\nprivate word spam\ne ${nip19.noteEncode(eid)}\nt #Nostr`
    );
    expect(payload.tags).toEqual([
      ['p', pk],
      ['e', eid],
      ['t', 'nostr']
    ]);
    expect(JSON.parse(payload.privateJson)).toEqual([['word', 'spam']]);
  });

  it('round-trips public + private tags into the muted field', () => {
    const raw = mutedRawFromTags(
      [
        ['p', pk],
        ['word', 'public']
      ],
      [['e', eid]]
    );
    expect(formatMuteRows(muteRowsFromRaw(raw))).toBe(raw);
    const payload = buildMuteListPayload(raw);
    expect(payload.tags).toEqual([
      ['p', pk],
      ['word', 'public']
    ]);
    expect(JSON.parse(payload.privateJson)).toEqual([['e', eid]]);
  });
});
