import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { emptyMuteState } from './mute';
import {
  effectiveThreadWatchState,
  eventMatchesThreadWatchRefs,
  isNotificationThreadInteraction,
  parseThreadWatchList
} from './thread-watch';
import { isNotificationForViewer } from './feed/taxonomy';

function ev(over: Partial<Event> & { tags?: string[][] }): Event {
  return {
    id: over.id ?? 'a'.repeat(64),
    pubkey: over.pubkey ?? 'b'.repeat(64),
    created_at: over.created_at ?? 1,
    kind: over.kind ?? KIND.TEXT_NOTE,
    tags: over.tags ?? [],
    content: over.content ?? '',
    sig: over.sig ?? 'c'.repeat(128)
  };
}

describe('parseThreadWatchList', () => {
  it('collects e and a tags', () => {
    const list = ev({
      kind: KIND.THREAD_NOTIFICATION_FOLLOW,
      tags: [
        ['e', '1'.repeat(64)],
        ['a', `30040:${'2'.repeat(64)}:book`]
      ]
    });
    const refs = parseThreadWatchList(list);
    expect(refs.eIds.has('1'.repeat(64))).toBe(true);
    expect(refs.aCoords.has(`30040:${'2'.repeat(64)}:book`)).toBe(true);
  });
});

describe('eventMatchesThreadWatchRefs', () => {
  it('matches a reply that e-tags a watched id', () => {
    const rootId = '1'.repeat(64);
    const refs = parseThreadWatchList(
      ev({ kind: KIND.THREAD_NOTIFICATION_FOLLOW, tags: [['e', rootId]] })
    );
    const reply = ev({
      id: '3'.repeat(64),
      kind: KIND.TEXT_NOTE,
      tags: [
        ['e', rootId, '', 'root'],
        ['e', rootId, '', 'reply']
      ]
    });
    expect(eventMatchesThreadWatchRefs(reply, refs)).toBe(true);
    expect(isNotificationThreadInteraction(reply)).toBe(true);
  });
});

describe('effectiveThreadWatchState', () => {
  it('lets hide and notif-mute beat follow when wire lists conflict', () => {
    const target = ev({ id: '4'.repeat(64), kind: KIND.TEXT_NOTE });
    const follow = ev({
      kind: KIND.THREAD_NOTIFICATION_FOLLOW,
      tags: [['e', target.id]]
    });
    const notifMute = ev({
      kind: KIND.THREAD_NOTIFICATION_MUTE,
      tags: [['e', target.id]]
    });
    const mute = emptyMuteState();
    mute.eventIds.add(target.id.toLowerCase());
    expect(
      effectiveThreadWatchState(target, {
        followList: follow,
        notifMuteList: notifMute,
        mute
      })
    ).toEqual({ followed: false, notifMuted: true, hidden: true });
  });
});

describe('isNotificationForViewer thread watch', () => {
  const viewer = '5'.repeat(64);
  const rootId = '6'.repeat(64);

  it('includes 19130 interactions without #p and excludes 19132', () => {
    const followRefs = parseThreadWatchList(
      ev({ kind: KIND.THREAD_NOTIFICATION_FOLLOW, tags: [['e', rootId]] })
    );
    const reply = ev({
      id: '7'.repeat(64),
      pubkey: '8'.repeat(64),
      kind: KIND.TEXT_NOTE,
      tags: [['e', rootId, '', 'root']]
    });
    expect(
      isNotificationForViewer(reply, viewer, { followRefs })
    ).toBe(true);

    const notifMuteRefs = parseThreadWatchList(
      ev({ kind: KIND.THREAD_NOTIFICATION_MUTE, tags: [['e', rootId]] })
    );
    expect(
      isNotificationForViewer(reply, viewer, { followRefs, notifMuteRefs })
    ).toBe(false);
  });

  it('keeps #p hits', () => {
    const note = ev({
      id: '9'.repeat(64),
      pubkey: '8'.repeat(64),
      kind: KIND.TEXT_NOTE,
      tags: [['p', viewer]]
    });
    expect(isNotificationForViewer(note, viewer)).toBe(true);
  });
});
