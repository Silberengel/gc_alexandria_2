import type { Event } from 'nostr-tools';
import { formatAbsoluteTime } from './relative-time';

/** NIP-53 kind 30311 status. */
export type LiveStreamStatus = 'live' | 'planned' | 'ended' | 'unknown';

export type LiveStreamParticipant = {
  pubkey: string;
  role: string | null;
};

export type LiveStreamInfo = {
  title: string;
  summary: string | null;
  status: LiveStreamStatus;
  statusLabel: string;
  whenLabel: string | null;
  viewersLabel: string | null;
  imageUrl: string | null;
  streamingUrl: string | null;
  recordingUrl: string | null;
  hosts: LiveStreamParticipant[];
  tags: string[];
};

function firstTag(event: Event, name: string): string | null {
  for (const tag of event.tags) {
    if (tag[0] !== name) continue;
    const value = (tag[1] ?? '').trim();
    if (value) return value;
  }
  return null;
}

function allTagValues(event: Event, name: string): string[] {
  const out: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== name) continue;
    const value = (tag[1] ?? '').trim();
    if (value) out.push(value);
  }
  return out;
}

function httpUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!/^https?:\/\//i.test(value)) return null;
  return value;
}

/** Prefer HLS playlists, then any http(s) streaming URL (skip moq:// etc.). */
function pickStreamingUrl(event: Event): string | null {
  const http = allTagValues(event, 'streaming')
    .map((u) => httpUrl(u))
    .filter((u): u is string => !!u);
  return http.find((u) => isHlsMediaUrl(u)) ?? http[0] ?? null;
}

export function parseLiveStreamStatus(raw: string | null | undefined): LiveStreamStatus {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'live':
      return 'live';
    case 'planned':
      return 'planned';
    case 'ended':
      return 'ended';
    default:
      return 'unknown';
  }
}

function statusLabel(status: LiveStreamStatus): string {
  switch (status) {
    case 'live':
      return 'Live';
    case 'planned':
      return 'Scheduled';
    case 'ended':
      return 'Ended';
    default:
      return 'Live stream';
  }
}

function formatWhen(event: Event, status: LiveStreamStatus): string | null {
  const startsRaw = firstTag(event, 'starts');
  const endsRaw = firstTag(event, 'ends');
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
  const current = Number.parseInt(firstTag(event, 'current_participants') ?? '', 10);
  const total = Number.parseInt(firstTag(event, 'total_participants') ?? '', 10);
  const hasCurrent = Number.isFinite(current) && current >= 0;
  const hasTotal = Number.isFinite(total) && total >= 0;
  if (hasCurrent && hasTotal && total > 0) return `${current} watching · ${total} total`;
  if (hasCurrent) return current === 1 ? '1 watching' : `${current} watching`;
  if (hasTotal) return total === 1 ? '1 participant' : `${total} participants`;
  return null;
}

function participants(event: Event): LiveStreamParticipant[] {
  const preferredOrder = ['host', 'speaker', 'moderator', 'owner'];
  const out: LiveStreamParticipant[] = [];
  const seen = new Set<string>();
  for (const tag of event.tags) {
    if (tag[0] !== 'p') continue;
    const pubkey = (tag[1] ?? '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(pubkey) || seen.has(pubkey)) continue;
    seen.add(pubkey);
    const role = (tag[3] ?? '').trim() || null;
    out.push({ pubkey, role });
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
  return out.slice(0, 4);
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

/** Parse NIP-53 kind 30311 display fields (imwald LiveStreamMetadata). */
export function parseLiveStream(event: Event): LiveStreamInfo {
  const status = parseLiveStreamStatus(firstTag(event, 'status'));
  const title = firstTag(event, 'title') || 'Live stream';
  const summaryTag = firstTag(event, 'summary');
  const content = (event.content ?? '').trim();
  const summary =
    summaryTag || (content && content !== title ? content : null);
  return {
    title,
    summary,
    status,
    statusLabel: statusLabel(status),
    whenLabel: formatWhen(event, status),
    viewersLabel: formatViewers(event),
    imageUrl: httpUrl(firstTag(event, 'image')) || httpUrl(firstTag(event, 'thumb')),
    streamingUrl: pickStreamingUrl(event),
    recordingUrl: httpUrl(firstTag(event, 'recording')),
    hosts: participants(event),
    tags: topicTags(event)
  };
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

/** Prefer live stream, then recording (imwald order). */
export function liveStreamPlaybackUrl(info: LiveStreamInfo): string | null {
  return info.streamingUrl || info.recordingUrl || null;
}
