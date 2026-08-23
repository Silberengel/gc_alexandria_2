/** i.nostr.build thumbs: insert `/thumb` before the path. cdn.nostr.build has no such route. */

const I_NOSTR_BUILD = 'i.nostr.build';
const VIDEO_EXT = /\.(?:webm|mp4|m4v|mov)(?:[?#]|$)/i;

export function canUseNostrBuildThumb(url: string): boolean {
  const u = url.trim();
  if (!u || VIDEO_EXT.test(u)) return false;
  try {
    const parsed = new URL(u);
    if (parsed.hostname !== I_NOSTR_BUILD) return false;
    const p = parsed.pathname;
    return p !== '/thumb' && !p.startsWith('/thumb/');
  } catch {
    return false;
  }
}

export function toNostrBuildThumbUrl(url: string): string {
  const u = url.trim();
  if (!canUseNostrBuildThumb(u)) return u;
  try {
    const parsed = new URL(u);
    const p = parsed.pathname || '/';
    parsed.pathname = '/thumb' + (p.startsWith('/') ? p : `/${p}`);
    return parsed.toString();
  } catch {
    return u;
  }
}
