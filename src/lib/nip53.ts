/**
 * NIP-53 Live Streaming and Spaces — field names, options, and kinds come from
 * `@silberengel/kind-compose-catalog` (suite `nip53`). Display parsers only.
 */
import type { Event } from 'nostr-tools';
import {
  fieldSpecs,
  getKind,
  suiteKinds,
  type FieldDef
} from '@silberengel/kind-compose-catalog';
import { formatAbsoluteTime } from './relative-time';

/** Catalog suite id for this NIP. */
export const NIP53_SUITE = 'nip53' as const;

/** Kind numbers from the catalog suite (not free-hand constants). */
export const NIP53_KIND = {
  LIVE_CHAT: 1311,
  ROOM_PRESENCE: 10312,
  LIVE_EVENT: 30311,
  MEETING_SPACE: 30312,
  MEETING_ROOM: 30313
} as const;

export type Nip53Kind = (typeof NIP53_KIND)[keyof typeof NIP53_KIND];

/** Clients MAY treat `status=live` with no update for this long as ended. */
export const NIP53_STALE_LIVE_SEC = 60 * 60;

const HEX_PUBKEY = /^[0-9a-f]{64}$/;
const HEX_ID = /^[0-9a-f]{64}$/;

export type Nip53Participant = {
  pubkey: string;
  relay: string | null;
  role: string | null;
  proof: string | null;
  /** True when the optional proof slot is present (agreement to participate). */
  agreed: boolean;
};

export type ActivityStatus = 'planned' | 'live' | 'ended' | 'unknown';
export type SpaceStatus = 'open' | 'private' | 'closed' | 'unknown';

export type LiveStreamInfo = {
  title: string;
  summary: string | null;
  status: ActivityStatus;
  statusLabel: string;
  whenLabel: string | null;
  viewersLabel: string | null;
  imageUrl: string | null;
  streamingUrl: string | null;
  recordingUrl: string | null;
  hosts: Nip53Participant[];
  participants: Nip53Participant[];
  pinnedIds: string[];
  relays: string[];
  tags: string[];
  /** True when status was coerced from live → ended due to staleness. */
  stale: boolean;
};

export type MeetingSpaceInfo = {
  room: string;
  summary: string | null;
  status: SpaceStatus;
  statusLabel: string;
  imageUrl: string | null;
  serviceUrl: string | null;
  endpointUrl: string | null;
  providers: Nip53Participant[];
  relays: string[];
  tags: string[];
};

export type MeetingRoomInfo = {
  title: string;
  summary: string | null;
  status: ActivityStatus;
  statusLabel: string;
  whenLabel: string | null;
  viewersLabel: string | null;
  imageUrl: string | null;
  spaceAddress: string | null;
  spaceRelay: string | null;
  hosts: Nip53Participant[];
  participants: Nip53Participant[];
  tags: string[];
  stale: boolean;
};

export type RoomPresenceInfo = {
  spaceAddress: string | null;
  spaceRelay: string | null;
  handRaised: boolean;
};

/** Suite kind list from the catalog (throws if the pin is missing NIP-53). */
export function nip53SuiteKinds(): number[] {
  const kinds = suiteKinds(NIP53_SUITE);
  if (!kinds.length) {
    throw new Error('kind-compose-catalog suite "nip53" is empty or missing');
  }
  return kinds;
}

export function isNip53Kind(kind: number): boolean {
  return nip53SuiteKinds().includes(kind);
}

export function nip53KindLabel(kind: number): string {
  return getKind(kind)?.label ?? `Event (kind ${kind})`;
}

function fieldDef(kind: number, fieldId: string): FieldDef | undefined {
  return fieldSpecs(kind).find((f) => f.id === fieldId);
}

/** Wire tag name for a catalog field id (falls back to the id). */
export function nip53TagName(kind: number, fieldId: string): string {
  return fieldDef(kind, fieldId)?.tag ?? fieldId;
}

export function nip53FieldOptions(kind: number, fieldId: string): string[] {
  return fieldDef(kind, fieldId)?.options ?? [];
}

export function firstTag(event: Event, name: string): string | null {
  for (const tag of event.tags) {
    if (tag[0] !== name) continue;
    const value = (tag[1] ?? '').trim();
    if (value) return value;
  }
  return null;
}

export function allTagValues(event: Event, name: string): string[] {
  const out: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== name) continue;
    // NIP-53 `relays` packs multiple URLs in one tag.
    if (name === 'relays') {
      for (let i = 1; i < tag.length; i++) {
        const value = (tag[i] ?? '').trim();
        if (value) out.push(value);
      }
      continue;
    }
    const value = (tag[1] ?? '').trim();
    if (value) out.push(value);
  }
  return out;
}

/** First value of the catalog field on this event. */
export function firstFieldValue(event: Event, fieldId: string): string | null {
  return firstTag(event, nip53TagName(event.kind, fieldId));
}

export function allFieldValues(event: Event, fieldId: string): string[] {
  return allTagValues(event, nip53TagName(event.kind, fieldId));
}

function httpUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!/^https?:\/\//i.test(value)) return null;
  return value;
}

function topicTags(event: Event): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of event.tags) {
    if (tag[0] !== 't') continue;
    const topic = (tag[1] ?? '').trim().replace(/^#+/u, '').trim();
    if (!topic) continue;
    const key = topic.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(topic);
  }
  return out;
}

/** p-tag participants using catalog overload slots (pubkey, relay, role, proof). */
export function parseNip53Participants(event: Event): Nip53Participant[] {
  const preferredOrder = ['host', 'speaker', 'moderator', 'owner'];
  const out: Nip53Participant[] = [];
  const seen = new Set<string>();
  for (const tag of event.tags) {
    if (tag[0] !== 'p') continue;
    const pubkey = (tag[1] ?? '').trim().toLowerCase();
    if (!HEX_PUBKEY.test(pubkey) || seen.has(pubkey)) continue;
    seen.add(pubkey);
    const relay = (tag[2] ?? '').trim() || null;
    const role = (tag[3] ?? '').trim() || null;
    const proof = (tag[4] ?? '').trim() || null;
    out.push({ pubkey, relay, role, proof, agreed: !!proof });
  }
  out.sort((a, b) => {
    const ar = a.role?.toLowerCase() ?? '';
    const br = b.role?.toLowerCase() ?? '';
    const ai = preferredOrder.indexOf(ar);
    const bi = preferredOrder.indexOf(br);
    const as = ai >= 0 ? ai : a.role ? 50 : 99;
    const bs = bi >= 0 ? bi : b.role ? 50 : 99;
    return as - bs;
  });
  return out;
}

function parseOptionStatus<T extends string>(
  kind: number,
  fieldId: string,
  raw: string | null | undefined
): T | 'unknown' {
  const value = (raw ?? '').trim().toLowerCase();
  const options = nip53FieldOptions(kind, fieldId).map((o) => o.toLowerCase());
  if (value && options.includes(value)) return value as T;
  return 'unknown';
}

export function parseActivityStatus(
  kind: number,
  raw: string | null | undefined
): ActivityStatus {
  return parseOptionStatus<ActivityStatus>(kind, 'status', raw);
}

export function parseSpaceStatus(raw: string | null | undefined): SpaceStatus {
  return parseOptionStatus<SpaceStatus>(NIP53_KIND.MEETING_SPACE, 'status', raw);
}

/** Display labels for catalog activity status options. */
export function activityStatusLabel(status: ActivityStatus, kind = NIP53_KIND.LIVE_EVENT): string {
  switch (status) {
    case 'live':
      return 'Live';
    case 'planned':
      return 'Scheduled';
    case 'ended':
      return 'Ended';
    default:
      return getKind(kind)?.label ?? 'Live activity';
  }
}

export function spaceStatusLabel(status: SpaceStatus): string {
  switch (status) {
    case 'open':
      return 'Open';
    case 'private':
      return 'Private';
    case 'closed':
      return 'Closed';
    default:
      return getKind(NIP53_KIND.MEETING_SPACE)?.label ?? 'Meeting space';
  }
}

/**
 * Apply the NIP-53 1h stale-live rule. Pass `nowSec` for tests.
 */
export function effectiveActivityStatus(
  event: Event,
  rawStatus: ActivityStatus,
  nowSec = Math.floor(Date.now() / 1000)
): { status: ActivityStatus; stale: boolean } {
  if (rawStatus !== 'live') return { status: rawStatus, stale: false };
  if (nowSec - event.created_at < NIP53_STALE_LIVE_SEC) {
    return { status: 'live', stale: false };
  }
  return { status: 'ended', stale: true };
}

function formatWhen(
  event: Event,
  status: ActivityStatus
): string | null {
  const startsRaw = firstFieldValue(event, 'starts');
  const endsRaw = firstFieldValue(event, 'ends');
  const starts = startsRaw ? formatAbsoluteTime(Number(startsRaw)) : '';
  const ends = endsRaw ? formatAbsoluteTime(Number(endsRaw)) : '';
  switch (status) {
    case 'live':
      if (starts) return `Started ${starts}`;
      if (ends) return `Until ${ends}`;
      return null;
    case 'planned':
      if (starts && ends) return `${starts} – ${ends}`;
      if (starts) return `Starts ${starts}`;
      return null;
    case 'ended':
      if (ends) return `Ended ${ends}`;
      if (starts) return `From ${starts}`;
      return null;
    default:
      if (starts && ends) return `${starts} – ${ends}`;
      return starts || ends || null;
  }
}

function formatViewers(event: Event): string | null {
  const current = Number.parseInt(firstFieldValue(event, 'current_participants') ?? '', 10);
  const total = Number.parseInt(firstFieldValue(event, 'total_participants') ?? '', 10);
  const hasCurrent = Number.isFinite(current) && current >= 0;
  const hasTotal = Number.isFinite(total) && total >= 0;
  if (hasCurrent && hasTotal && total > 0) return `${current} watching · ${total} total`;
  if (hasCurrent) return current === 1 ? '1 watching' : `${current} watching`;
  if (hasTotal) return total === 1 ? '1 participant' : `${total} participants`;
  return null;
}

/** Prefer HLS playlists, then any http(s) streaming URL (skip moq:// etc.). */
function pickStreamingUrl(event: Event): string | null {
  const tag = nip53TagName(NIP53_KIND.LIVE_EVENT, 'streaming');
  const http = allTagValues(event, tag)
    .map((u) => httpUrl(u))
    .filter((u): u is string => !!u);
  return http.find((u) => isHlsMediaUrl(u)) ?? http[0] ?? null;
}

/** Parse NIP-53 kind 30311 display fields from catalog field ids. */
export function parseLiveStream(
  event: Event,
  nowSec = Math.floor(Date.now() / 1000)
): LiveStreamInfo {
  const kind = NIP53_KIND.LIVE_EVENT;
  const rawStatus = parseActivityStatus(kind, firstFieldValue(event, 'status'));
  const { status, stale } = effectiveActivityStatus(event, rawStatus, nowSec);
  const title = firstFieldValue(event, 'title') || nip53KindLabel(kind);
  const summaryTag = firstFieldValue(event, 'summary');
  const content = (event.content ?? '').trim();
  const summary = summaryTag || (content && content !== title ? content : null);
  const participants = parseNip53Participants(event);
  const hosts = participants.filter((p) => {
    const role = p.role?.toLowerCase() ?? '';
    return role === 'host' || role === 'owner' || role === 'speaker' || role === 'moderator';
  });
  return {
    title,
    summary,
    status,
    statusLabel: activityStatusLabel(status, kind),
    whenLabel: formatWhen(event, status),
    viewersLabel: formatViewers(event),
    imageUrl:
      httpUrl(firstFieldValue(event, 'image')) || httpUrl(firstTag(event, 'thumb')),
    streamingUrl: pickStreamingUrl(event),
    recordingUrl: httpUrl(firstFieldValue(event, 'recording')),
    hosts: (hosts.length ? hosts : participants).slice(0, 4),
    participants,
    pinnedIds: allFieldValues(event, 'pinned').filter((id) => HEX_ID.test(id.toLowerCase())),
    relays: allFieldValues(event, 'relays'),
    tags: topicTags(event),
    stale
  };
}

export function parseMeetingSpace(event: Event): MeetingSpaceInfo {
  const kind = NIP53_KIND.MEETING_SPACE;
  const status = parseSpaceStatus(firstFieldValue(event, 'status'));
  return {
    room: firstFieldValue(event, 'room') || nip53KindLabel(kind),
    summary: firstFieldValue(event, 'summary'),
    status,
    statusLabel: spaceStatusLabel(status),
    imageUrl: httpUrl(firstFieldValue(event, 'image')),
    serviceUrl: httpUrl(firstFieldValue(event, 'service')),
    endpointUrl: httpUrl(firstFieldValue(event, 'endpoint')),
    providers: parseNip53Participants(event),
    relays: allFieldValues(event, 'relays'),
    tags: topicTags(event)
  };
}

export function parseMeetingRoom(
  event: Event,
  nowSec = Math.floor(Date.now() / 1000)
): MeetingRoomInfo {
  const kind = NIP53_KIND.MEETING_ROOM;
  const rawStatus = parseActivityStatus(kind, firstFieldValue(event, 'status'));
  const { status, stale } = effectiveActivityStatus(event, rawStatus, nowSec);
  const title = firstFieldValue(event, 'title') || nip53KindLabel(kind);
  const summaryTag = firstFieldValue(event, 'summary');
  const content = (event.content ?? '').trim();
  const aTag = event.tags.find((t) => t[0] === 'a' && (t[1] ?? '').trim());
  const participants = parseNip53Participants(event);
  const hosts = participants.filter((p) => {
    const role = p.role?.toLowerCase() ?? '';
    return role === 'host' || role === 'owner' || role === 'speaker' || role === 'moderator';
  });
  return {
    title,
    summary: summaryTag || (content && content !== title ? content : null),
    status,
    statusLabel: activityStatusLabel(status, kind),
    whenLabel: formatWhen(event, status),
    viewersLabel: formatViewers(event),
    imageUrl: httpUrl(firstFieldValue(event, 'image')),
    spaceAddress: aTag?.[1]?.trim() || null,
    spaceRelay: aTag?.[2]?.trim() || null,
    hosts: (hosts.length ? hosts : participants).slice(0, 4),
    participants,
    tags: topicTags(event),
    stale
  };
}

export function parseRoomPresence(event: Event): RoomPresenceInfo {
  const aTag = event.tags.find((t) => t[0] === 'a' && (t[1] ?? '').trim());
  const handOptions = nip53FieldOptions(NIP53_KIND.ROOM_PRESENCE, 'hand');
  const raisedValue = handOptions.find((o) => o === '1') ?? '1';
  const hand = firstFieldValue(event, 'hand');
  return {
    spaceAddress: aTag?.[1]?.trim() || null,
    spaceRelay: aTag?.[2]?.trim() || null,
    handRaised: (hand ?? '').trim() === raisedValue
  };
}

/** a-tag address of the live activity a kind 1311 chat message belongs to. */
export function liveChatActivityAddress(event: Event): string | null {
  if (event.kind !== NIP53_KIND.LIVE_CHAT) return null;
  for (const tag of event.tags) {
    if (tag[0] !== 'a') continue;
    const addr = (tag[1] ?? '').trim();
    if (addr.startsWith(`${NIP53_KIND.LIVE_EVENT}:`)) return addr;
  }
  return null;
}

/** HLS playlist — needs hls.js (or Safari native). */
export function isHlsMediaUrl(url: string): boolean {
  return /\.m3u8(?:\?|#|$)/i.test(url.trim());
}

/** Direct file the browser can play in `<video>` / `<audio>`. */
export function isDirectPlayableMediaUrl(url: string): boolean {
  return /\.(?:mp4|webm|ogv|mov|m4v|mp3|ogg|wav|m4a|aac)(?:\?|#|$)/i.test(url.trim());
}

export function isVideoMediaUrl(url: string): boolean {
  return /\.(?:mp4|webm|ogv|mov|m4v)(?:\?|#|$)/i.test(url.trim());
}

/** True when we can attach an in-page player (progressive file or HLS). */
export function isInPagePlayableMediaUrl(url: string): boolean {
  return isDirectPlayableMediaUrl(url) || isHlsMediaUrl(url);
}

/** Prefer live stream, then recording. */
export function liveStreamPlaybackUrl(info: LiveStreamInfo): string | null {
  return info.streamingUrl || info.recordingUrl || null;
}
