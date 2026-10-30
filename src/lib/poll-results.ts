import type { Event, Filter } from 'nostr-tools';
import { KIND } from './constants';
import { cachedEventsReferencing } from './nostr/cache';
import { authorInbox, withPreferredRelays } from './nostr/mailboxes';
import { relayPool } from './nostr/pool';
import { socialStack } from './nostr/selector';
import {
  emptyPollResults,
  mergePollResults,
  parsePollResponse,
  pollOptionIds,
  type PollInfo,
  type PollResults
} from './poll';

function normalizeRelay(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** Relays to query / publish poll votes (author inbox + poll hints + social). */
export async function pollVoteRelays(
  pollEvent: Pick<Event, 'pubkey'>,
  pollInfo: PollInfo
): Promise<{ relays: string[]; maxRelays: number }> {
  const hints = pollInfo.relayUrls.map(normalizeRelay).filter(Boolean);
  let inbox: string[] = [];
  try {
    inbox = await authorInbox(pollEvent.pubkey);
  } catch {
    inbox = [];
  }
  const preferred = [...hints, ...inbox];
  return withPreferredRelays(socialStack(), preferred, 8, Math.min(8, preferred.length || 4));
}

export async function fetchPollResults(
  pollEvent: Event,
  pollInfo: PollInfo,
  onCache?: (results: PollResults) => void
): Promise<PollResults> {
  const pollId = pollEvent.id.trim().toLowerCase();
  const optionIds = pollOptionIds(pollInfo);
  let results = emptyPollResults(optionIds);

  if (!/^[0-9a-f]{64}$/.test(pollId)) return results;

  const applyEvents = (events: Event[]) => {
    const parsed = events
      .map((event) => parsePollResponse(event, optionIds, pollInfo.isMultipleChoice))
      .filter((r): r is NonNullable<typeof r> => r != null);
    results = mergePollResults(emptyPollResults(optionIds), parsed, optionIds);
  };

  const cached = (await cachedEventsReferencing(pollId)).filter(
    (event) => event.kind === KIND.POLL_RESPONSE
  );
  if (cached.length) {
    applyEvents(cached);
    onCache?.(results);
  }

  const filter: Filter = {
    kinds: [KIND.POLL_RESPONSE],
    '#e': [pollId],
    limit: 100
  };
  if (pollInfo.endsAt != null && pollInfo.endsAt > 0) {
    filter.until = pollInfo.endsAt;
  }
  if (results.maxResponseCreatedAt > 0) {
    filter.since = results.maxResponseCreatedAt;
  }

  const scoped = await pollVoteRelays(pollEvent, pollInfo);
  const hits = await relayPool.query(scoped.relays, [filter], 5000, scoped.maxRelays);
  if (hits.length) {
    applyEvents([...cached, ...hits]);
  }
  return results;
}
