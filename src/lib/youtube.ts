export type YouTubeRef = {
  videoId: string;
  listId?: string;
  sourceUrl: string;
  /** music.youtube.com — Topic / catalog tracks often refuse iframe embeds. */
  music: boolean;
};

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LIST_ID = /^[A-Za-z0-9_-]+$/;

function hostOf(url: URL): string {
  return url.hostname.replace(/^www\./i, '').toLowerCase();
}

function isYouTubeHost(host: string): boolean {
  return (
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtube-nocookie.com' ||
    host === 'youtu.be'
  );
}

/** Strip trailing punctuation often glued onto pasted links. */
function tidyUrl(raw: string): string {
  return raw.trim().replace(/[),.;:!?'"\]]+$/g, '');
}

/**
 * Parse a YouTube / YouTube Music / youtu.be watch URL into a video id.
 * Returns null for non-YouTube or unparseable links.
 */
export function parseYouTubeUrl(raw: string): YouTubeRef | null {
  let url: URL;
  try {
    url = new URL(tidyUrl(raw));
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = hostOf(url);
  if (!isYouTubeHost(host)) return null;

  let videoId = '';
  if (host === 'youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0] ?? '';
  } else {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch' || parts[0] === 'watch/') {
      videoId = url.searchParams.get('v') ?? '';
    } else if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live' || parts[0] === 'v') {
      videoId = parts[1] ?? '';
    } else if (url.searchParams.get('v')) {
      videoId = url.searchParams.get('v') ?? '';
    }
  }
  if (!VIDEO_ID.test(videoId)) return null;

  const list = url.searchParams.get('list') ?? undefined;
  // Drop Mix/Radio lists (RD…) — they swap the video and break embeds.
  const listId = list && LIST_ID.test(list) && !/^RD/i.test(list) ? list : undefined;
  return {
    videoId,
    listId,
    sourceUrl: tidyUrl(raw),
    music: host === 'music.youtube.com'
  };
}

/**
 * Canonical watch page for opening in a tab.
 * Music links are rewritten to www.youtube.com so Music does not bounce into a
 * radio mix (`list=RD…`) on a different video id.
 */
export function youtubeOpenUrl(ref: YouTubeRef): string {
  if (ref.music) return `https://www.youtube.com/watch?v=${ref.videoId}`;
  if (ref.listId) {
    return `https://www.youtube.com/watch?v=${ref.videoId}&list=${encodeURIComponent(ref.listId)}`;
  }
  return ref.sourceUrl;
}

/** Poster still for cards / pins (`hqdefault`). */
export function youtubeStillUrl(ref: YouTubeRef | string): string | null {
  const parsed = typeof ref === 'string' ? parseYouTubeUrl(ref) : ref;
  if (!parsed) return null;
  return `https://i.ytimg.com/vi/${parsed.videoId}/hqdefault.jpg`;
}

/**
 * Privacy-enhanced iframe src, or `null` when the host should not be iframed
 * (YouTube Music catalog tracks usually render “Video unavailable”).
 */
export function youtubeEmbedSrc(ref: YouTubeRef): string | null {
  if (ref.music) return null;
  const src = new URL(`https://www.youtube-nocookie.com/embed/${ref.videoId}`);
  if (ref.listId) src.searchParams.set('list', ref.listId);
  return src.toString();
}

/** True when this http(s) URL should render as a YouTube player instead of a bare link. */
export function isYouTubeUrl(url: string): boolean {
  return parseYouTubeUrl(url) != null;
}
