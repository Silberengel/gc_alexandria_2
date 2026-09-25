/**
 * Hash-routed SPA: external path links (/publication/..., /wiki/..., /p/..., /search)
 * must become /#/… before the router mounts. Also collapses /publication/naddr/{bech32}
 * (and wiki/nevent/note variants) into /publication/{bech32}.
 */

const POINTER = '(?:naddr|nevent|note)1[02-9ac-hj-np-z]+';

const SPA_PREFIX =
  /^\/(?:search|settings|about|start|contact|p\/|publication\/|wiki\/)/i;

/** Collapse typed pointer segments used by some external linkers. */
export function normalizeExternalSpaPath(pathname: string): string {
  let path = pathname.trim() || '/';
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/\/{2,}/g, '/');
  // /publication/naddr/naddr1… → /publication/naddr1…
  path = path.replace(
    new RegExp(`^/(publication|wiki)/(?:naddr|nevent|note)/(${POINTER})/?$`, 'i'),
    '/$1/$2'
  );
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path;
}

export function isSpaPathname(pathname: string): boolean {
  const path = (pathname.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  if (path === '/') return false;
  // Real static assets (js/css/images) — leave alone
  if (/\.[a-z0-9]{1,8}$/i.test(path) && !/\.html?$/i.test(path)) return false;
  return SPA_PREFIX.test(path) || new RegExp(`^/(publication|wiki)/${POINTER}$`, 'i').test(path);
}

/**
 * If the browser landed on a path deep-link (no hash route), rewrite to `/#/…`
 * via replaceState so svelte-spa-router sees the intended page.
 * Returns true when a rewrite happened.
 */
export function rewritePathDeepLinkToHash(
  loc: Pick<Location, 'pathname' | 'search' | 'hash'> = window.location
): boolean {
  if (typeof window === 'undefined') return false;
  const pathOnly = loc.pathname || '/';
  if (!isSpaPathname(pathOnly)) return false;

  const normalized = normalizeExternalSpaPath(pathOnly);
  const search = loc.search || '';
  // Hash-router query lives after the path: #/publication/naddr1…?section=
  const next = `/${'#'}${normalized}${search}`;
  window.history.replaceState(null, '', next);
  return true;
}
