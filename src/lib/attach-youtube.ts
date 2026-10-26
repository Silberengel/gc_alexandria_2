import { mount, unmount } from 'svelte';
import YouTubeEmbed from './components/YouTubeEmbed.svelte';
import { parseYouTubeUrl } from './youtube';

function mountInto(host: HTMLElement, url: string, cleanups: Array<() => void>): void {
  if (host.childNodes.length) return;
  const ui = mount(YouTubeEmbed, { target: host, props: { url } });
  cleanups.push(() => {
    try {
      unmount(ui);
    } catch {
      /* already gone */
    }
  });
}

/**
 * Replace YouTube anchors in rendered markup with {@link YouTubeEmbed} players.
 * Djot leaves bare URLs as text (linkified later); iframes cannot go through
 * DOMPurify, so the player is mounted after paint.
 *
 * Hosts keep `data-youtube-url` so a Svelte effect cleanup/re-run can remount
 * without needing the original `<a>` (which was already replaced).
 */
export function attachYoutubeEmbeds(node: HTMLElement): () => void {
  const cleanups: Array<() => void> = [];

  for (const host of [...node.querySelectorAll('.youtube-embed-host[data-youtube-url]')]) {
    if (!(host instanceof HTMLElement)) continue;
    const url = (host.getAttribute('data-youtube-url') ?? '').trim();
    if (!parseYouTubeUrl(url)) continue;
    mountInto(host, url, cleanups);
  }

  for (const a of [...node.querySelectorAll('a[href]')]) {
    if (!(a instanceof HTMLAnchorElement)) continue;
    if (a.closest('pre, code, .youtube-embed, .youtube-embed-host')) continue;
    if (a.classList.contains('youtube-embed-open')) continue;
    const href = (a.getAttribute('href') ?? '').trim();
    if (!parseYouTubeUrl(href)) continue;

    const host = document.createElement('div');
    host.className = 'youtube-embed-host';
    host.setAttribute('data-youtube-url', href);
    a.replaceWith(host);
    mountInto(host, href, cleanups);
  }

  return () => {
    for (const stop of cleanups) stop();
  };
}
