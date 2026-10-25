/**
 * Live stream media helpers + re-exports of catalog-backed NIP-53 parsers.
 * Prefer importing from `$lib/nip53` for new code.
 */
import {
  NIP53_KIND,
  type ActivityStatus,
  type LiveStreamInfo,
  type Nip53Participant,
  isDirectPlayableMediaUrl,
  isHlsMediaUrl,
  isInPagePlayableMediaUrl,
  isVideoMediaUrl,
  liveStreamPlaybackUrl,
  parseActivityStatus,
  parseLiveStream
} from './nip53';

export type LiveStreamStatus = ActivityStatus;
export type { LiveStreamInfo, Nip53Participant as LiveStreamParticipant };
export {
  isDirectPlayableMediaUrl,
  isHlsMediaUrl,
  isInPagePlayableMediaUrl,
  isVideoMediaUrl,
  liveStreamPlaybackUrl,
  parseLiveStream
};

/** Status options for kind 30311 from the catalog. */
export function parseLiveStreamStatus(raw: string | null | undefined): ActivityStatus {
  return parseActivityStatus(NIP53_KIND.LIVE_EVENT, raw);
}