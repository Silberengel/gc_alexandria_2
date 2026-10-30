import type { Event } from 'nostr-tools';
import { KIND } from './constants';
import { isImageUrl } from './media';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const HEX_ID = /^[0-9a-f]{64}$/i;
const PDF_EXT = /\.pdf(?:\?|#|$)/i;
const VIDEO_EXT = /\.(?:mp4|webm|ogv|mov|m4v)(?:\?|#|$)/i;
const AUDIO_EXT = /\.(?:mp3|ogg|wav|m4a|aac)(?:\?|#|$)/i;
const MIN_POLL_OPTIONS = 2;

export type PollOptionMediaKind = 'image' | 'video' | 'audio' | 'pdf';

export type PollOptionMedia = {
  url: string;
  kind: PollOptionMediaKind;
};

export type PollOption = {
  id: string;
  label: string;
};

export type PollInfo = {
  question: string;
  options: PollOption[];
  isMultipleChoice: boolean;
  endsAt: number | null;
  relayUrls: string[];
};

export type PollResults = {
  totalVotes: number;
  /** optionId → voter pubkeys */
  results: Record<string, Set<string>>;
  voters: Set<string>;
  maxResponseCreatedAt: number;
};

export type ParsedPollResponse = {
  pubkey: string;
  selectedOptionIds: string[];
  createdAt: number;
};

export type PollComposeFields = {
  options: string[];
  multipleChoice: boolean;
  /** Hours until endsAt; empty when unset. */
  endsHours: string;
};

/** Stable across compose preview rebuilds (imwald `optionIdForIndex` parity). */
export function pollOptionIdForIndex(index: number): string {
  let out = 'p' + index.toString(36);
  const seed = (index + 1) * 17;
  for (let i = 0; i < 7; i++) {
    out += ALPHABET[(seed * (i + 3)) % ALPHABET.length]!;
  }
  return out;
}

export function isPollTagName(name: string | undefined | null): boolean {
  const n = (name ?? '').trim().toLowerCase();
  return n === 'option' || n === 'polltype' || n === 'endsat' || n === 'relay';
}

export function ensureMinPollOptionRows(options: string[]): string[] {
  if (options.length >= MIN_POLL_OPTIONS) return options;
  const filled = options.map((o) => o.trim()).filter((o) => o.length > 0);
  return [...filled, ...Array.from({ length: MIN_POLL_OPTIONS - filled.length }, () => '')];
}

export function filledPollOptions(options: string[]): string[] {
  return options.map((o) => o.trim()).filter((o) => o.length > 0);
}

export function pollOptionMedia(label: string): PollOptionMedia | null {
  const trimmed = label.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  let url: string;
  try {
    url = new URL(trimmed).href;
  } catch {
    return null;
  }
  if (isImageUrl(url)) return { url, kind: 'image' };
  if (VIDEO_EXT.test(url)) return { url, kind: 'video' };
  if (AUDIO_EXT.test(url)) return { url, kind: 'audio' };
  if (PDF_EXT.test(url)) return { url, kind: 'pdf' };
  return null;
}

export function appendPollTags(
  tags: string[][],
  input: {
    options: string[];
    multipleChoice: boolean;
    endsAtEpochSec?: number | null;
    relayHints?: string[];
  }
): string[][] {
  const out = tags.filter((row) => !isPollTagName(row[0]));
  filledPollOptions(input.options).forEach((option, index) => {
    out.push(['option', pollOptionIdForIndex(index), option]);
  });
  out.push(['polltype', input.multipleChoice ? 'multiplechoice' : 'singlechoice']);
  const ends = input.endsAtEpochSec;
  if (ends != null && ends > 0) {
    out.push(['endsAt', String(ends)]);
  }
  const seen = new Set<string>();
  for (const raw of input.relayHints ?? []) {
    const url = raw.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(['relay', url]);
    if (seen.size >= 4) break;
  }
  return out;
}

export function endsAtFromHours(
  hoursRaw: string,
  nowSec = Math.floor(Date.now() / 1000)
): number | null {
  const hours = Number.parseInt(hoursRaw.trim(), 10);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return nowSec + hours * 3600;
}

export function pollComposeFieldsFromEvent(
  event: Pick<Event, 'kind' | 'tags'>,
  nowSec = Math.floor(Date.now() / 1000)
): PollComposeFields {
  if (event.kind !== KIND.POLL) {
    return { options: ['', ''], multipleChoice: false, endsHours: '' };
  }
  const options = event.tags
    .filter((t) => (t[0] ?? '').toLowerCase() === 'option')
    .map((t) => (t[2] ?? '').trim())
    .filter((label) => label.length > 0);
  const multipleChoice = event.tags.some(
    (t) =>
      (t[0] ?? '').toLowerCase() === 'polltype' &&
      (t[1] ?? '').toLowerCase() === 'multiplechoice'
  );
  const endsAt = event.tags
    .find((t) => (t[0] ?? '').toLowerCase() === 'endsat')
    ?.[1]
    ?.trim();
  const endsEpoch = endsAt ? Number.parseInt(endsAt, 10) : NaN;
  const hours =
    Number.isFinite(endsEpoch) && endsEpoch > nowSec
      ? Math.floor((endsEpoch - nowSec + 3599) / 3600)
      : 0;
  return {
    options: options.length ? options : ['', ''],
    multipleChoice,
    endsHours: hours > 0 ? String(hours) : ''
  };
}

function firstTag(event: Pick<Event, 'tags'>, name: string): string | undefined {
  const lower = name.toLowerCase();
  return event.tags.find((t) => (t[0] ?? '').toLowerCase() === lower)?.[1]?.trim();
}

function parsePollInternal(
  event: Pick<Event, 'kind' | 'content' | 'tags'>,
  minOptions: number,
  requireQuestion: boolean
): PollInfo | null {
  const options: PollOption[] = [];
  for (const tag of event.tags) {
    if ((tag[0] ?? '').toLowerCase() !== 'option') continue;
    const id = (tag[1] ?? '').trim();
    const label = (tag[2] ?? '').trim();
    if (!id) continue;
    options.push({ id, label: label || id });
  }
  if (options.length < minOptions) return null;

  const question =
    (event.content ?? '').trim() || firstTag(event, 'title') || (requireQuestion ? null : '');
  if (question == null) return null;

  const isMultipleChoice = event.tags.some(
    (t) =>
      (t[0] ?? '').toLowerCase() === 'polltype' &&
      (t[1] ?? '').toLowerCase() === 'multiplechoice'
  );
  const endsRaw = firstTag(event, 'endsAt');
  const endsParsed = endsRaw ? Number.parseInt(endsRaw, 10) : NaN;
  const endsAt = Number.isFinite(endsParsed) ? endsParsed : null;
  const relayUrls = event.tags
    .filter((t) => (t[0] ?? '').toLowerCase() === 'relay')
    .map((t) => (t[1] ?? '').trim())
    .filter(Boolean);

  return {
    question,
    options,
    isMultipleChoice,
    endsAt,
    relayUrls
  };
}

export function parsePoll(event: Pick<Event, 'kind' | 'content' | 'tags'>): PollInfo | null {
  return parsePollInternal(event, 2, true);
}

/** Compose preview: show chrome once any option exists. */
export function parsePollForDraftPreview(
  event: Pick<Event, 'kind' | 'content' | 'tags'>
): PollInfo | null {
  return parsePollInternal(event, 1, false);
}

export function pollOptionIds(info: PollInfo): Set<string> {
  return new Set(info.options.map((o) => o.id));
}

export function isPollExpired(info: PollInfo, nowSec = Math.floor(Date.now() / 1000)): boolean {
  return info.endsAt != null && nowSec > info.endsAt;
}

export function emptyPollResults(optionIds: Set<string>): PollResults {
  const results: Record<string, Set<string>> = {};
  for (const id of optionIds) results[id] = new Set();
  return {
    totalVotes: 0,
    results,
    voters: new Set(),
    maxResponseCreatedAt: 0
  };
}

export function votesForOption(results: PollResults, optionId: string): number {
  return results.results[optionId]?.size ?? 0;
}

export function pollHasVoted(results: PollResults, pubkey: string): boolean {
  const pk = pubkey.trim().toLowerCase();
  for (const voter of results.voters) {
    if (voter.toLowerCase() === pk) return true;
  }
  return false;
}

export function pollVotedOptionIds(results: PollResults, pubkey: string): Set<string> {
  const pk = pubkey.trim().toLowerCase();
  const out = new Set<string>();
  for (const [optionId, voters] of Object.entries(results.results)) {
    for (const voter of voters) {
      if (voter.toLowerCase() === pk) {
        out.add(optionId);
        break;
      }
    }
  }
  return out;
}

export function parsePollResponse(
  event: Pick<Event, 'kind' | 'pubkey' | 'created_at' | 'tags'>,
  validOptionIds: Set<string>,
  isMultipleChoice: boolean
): ParsedPollResponse | null {
  if (event.kind !== KIND.POLL_RESPONSE) return null;
  const selected = event.tags
    .filter((t) => (t[0] ?? '').toLowerCase() === 'response')
    .map((t) => (t[1] ?? '').trim())
    .filter((id) => id.length > 0 && validOptionIds.has(id));
  if (!selected.length) return null;
  if (selected.length > 1 && !isMultipleChoice) return null;
  return {
    pubkey: event.pubkey,
    selectedOptionIds: selected,
    createdAt: event.created_at
  };
}

export function pollTargetEventId(event: Pick<Event, 'tags'>): string | null {
  const id = event.tags
    .find((t) => (t[0] ?? '').toLowerCase() === 'e')
    ?.[1]
    ?.trim()
    .toLowerCase();
  return id && HEX_ID.test(id) ? id : null;
}

export function createPollResponseDraft(
  pollEvent: Pick<Event, 'id' | 'pubkey'>,
  selectedOptionIds: string[]
): { kind: number; content: string; tags: string[][] } {
  const pollId = pollEvent.id.trim().toLowerCase();
  if (!HEX_ID.test(pollId)) {
    throw new Error('Invalid poll id');
  }
  const tags: string[][] = [
    ['e', pollId, '', pollEvent.pubkey],
    ['p', pollEvent.pubkey]
  ];
  for (const optionId of selectedOptionIds) {
    tags.push(['response', optionId]);
  }
  return {
    kind: KIND.POLL_RESPONSE,
    content: '',
    tags
  };
}

export function mergePollResults(
  existing: PollResults,
  responses: ParsedPollResponse[],
  validOptionIds: Set<string>
): PollResults {
  if (!responses.length) return existing;
  const results: Record<string, Set<string>> = {};
  for (const id of validOptionIds) {
    results[id] = new Set(existing.results[id] ?? []);
  }
  for (const [id, voters] of Object.entries(existing.results)) {
    if (!(id in results)) results[id] = new Set(voters);
  }
  const voters = new Set(existing.voters);
  let totalVotes = existing.totalVotes;
  let maxCreated = existing.maxResponseCreatedAt;

  const sorted = [...responses].sort((a, b) => b.createdAt - a.createdAt);
  for (const response of sorted) {
    const voterKey = response.pubkey.trim().toLowerCase();
    let already = false;
    for (const v of voters) {
      if (v.toLowerCase() === voterKey) {
        already = true;
        break;
      }
    }
    if (already) continue;
    voters.add(response.pubkey);
    totalVotes += response.selectedOptionIds.length;
    for (const optionId of response.selectedOptionIds) {
      const set = results[optionId] ?? new Set<string>();
      set.add(response.pubkey);
      results[optionId] = set;
    }
    maxCreated = Math.max(maxCreated, response.createdAt);
  }

  return {
    totalVotes,
    results,
    voters,
    maxResponseCreatedAt: maxCreated
  };
}

export function addOptimisticPollVote(
  existing: PollResults,
  pubkey: string,
  selectedOptionIds: string[],
  validOptionIds: Set<string>
): PollResults {
  if (pollHasVoted(existing, pubkey)) return existing;
  return mergePollResults(
    existing,
    [
      {
        pubkey,
        selectedOptionIds,
        createdAt: Math.floor(Date.now() / 1000)
      }
    ],
    validOptionIds
  );
}
