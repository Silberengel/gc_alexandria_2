<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Event } from 'nostr-tools';
  import { querystring } from 'svelte-spa-router';
  import { copyPointerForEvent } from '$lib/publication-load';
  import { libraryDocumentPath } from '$lib/metadata';
  import { KIND } from '$lib/constants';
  import {
    eventMatchesThreadTarget,
    feedThreadPath,
    parseFeedThreadTarget
  } from '$lib/feed';
  import { placeMenuPanel, type MenuPlacement } from '$lib/menu-placement';
  import { warmNavEvent } from '$lib/nav-warm';
  import { openRawEvent } from '$lib/stores/raw-event-viewer';
  import { broadcastEvent } from '$lib/broadcast';
  import { fetchRepostsForId, myRepostOf, repostDraft } from '$lib/repost';
  import { deletionDraft } from '$lib/drafts';
  import { consumeSignFailure, publishSigned, signUnsigned } from '$lib/sign';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { showNotice } from '$lib/stores/toast';

  interface Props {
    event: Event;
    /** Extra class on the wrap (e.g. absolute positioning). */
    class?: string;
    /** Prefer opening toward the start (left) — e.g. left-side toolbars. */
    preferStart?: boolean;
    /** Absolute URL to copy as “Copy hyperlink” (reader deep link). Falls back to the library page. */
    shareUrl?: string;
    /** Replace the default ⋯ control (e.g. a bible verse number). */
    trigger?: Snippet;
    before?: Snippet;
    after?: Snippet;
  }

  let {
    event,
    class: className = '',
    preferStart = false,
    shareUrl = '',
    trigger,
    before,
    after
  }: Props = $props();

  let open = $state(false);
  let copied = $state(false);
  let linkCopied = $state(false);
  let repostPending = $state(false);
  let reposted = $state(false);
  let broadcastPending = $state(false);
  /** Viewer's existing kind 6/16 of this event (for Delete Repost). */
  let myRepost = $state<Event | null>(null);
  let timer = 0;
  let root: HTMLDivElement | undefined = $state();
  let panel: HTMLUListElement | undefined = $state();
  // Initial side is updated when opening; preferStart is applied in toggle().
  let place: MenuPlacement = $state({
    side: 'end',
    up: false,
    top: 0,
    left: 0,
    maxHeight: 280
  });

  const ptr = $derived(copyPointerForEvent(event));
  const njumpUrl = $derived(`https://njump.me/${ptr.text}`);
  const threadHref = $derived(`#${feedThreadPath(event)}`);
  /** Already the open feed-thread OP — don't offer a no-op "Open in a thread". */
  const isCurrentThreadOp = $derived.by(() => {
    const target = parseFeedThreadTarget($querystring);
    return !!target && eventMatchesThreadTarget(event, target);
  });
  const isOwnEvent = $derived(
    !!$session.pubkey && $session.pubkey.toLowerCase() === event.pubkey.toLowerCase()
  );
  /** Repost only others' events (signed-out users see the item and get the login dialog). */
  const showRepost = $derived(!isOwnEvent);
  const hasMyRepost = $derived(!!myRepost);

  $effect(() => {
    const target = event;
    const pubkey = $session.pubkey;
    if (!showRepost || !pubkey || !target?.id) {
      myRepost = null;
      return;
    }
    let cancelled = false;
    myRepost = null;
    void fetchRepostsForId(target.id, 40, (cached) => {
      if (cancelled) return;
      myRepost = myRepostOf(cached, pubkey, target);
    }).then((hits) => {
      if (cancelled) return;
      myRepost = myRepostOf(hits, pubkey, target);
    });
    return () => {
      cancelled = true;
    };
  });
  /** Prefer an explicit reader share URL; otherwise the Alexandria document (or njump). */
  const hyperlink = $derived.by(() => {
    const explicit = shareUrl.trim();
    if (explicit) return explicit;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    if (
      event.kind === KIND.PUBLICATION ||
      event.kind === KIND.SECTION ||
      event.kind === KIND.WIKI ||
      event.kind === KIND.SPEC ||
      event.kind === KIND.LONG_FORM
    ) {
      return `${origin}/#${libraryDocumentPath(event)}`;
    }
    return njumpUrl;
  });

  function refreshPlace(measured?: { width: number; height: number }): void {
    if (!root) return;
    let next = placeMenuPanel(root, measured);
    if (preferStart) {
      const r = root.getBoundingClientRect();
      const w = measured?.width ?? 200;
      if (window.innerWidth - r.left - 8 >= w) {
        next = {
          ...next,
          side: 'start',
          left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8))
        };
      }
    }
    place = next;
  }

  /** After paint, measure the real panel and flip/clamp so it stays on-screen. */
  function refinePlace(): void {
    if (!root || !panel) return;
    const rect = panel.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;
    refreshPlace({ width: Math.ceil(rect.width), height: Math.ceil(rect.height) });
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(ptr.text);
      copied = true;
      linkCopied = false;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        copied = false;
        close();
      }, 900);
    } catch {
      close();
    }
  }

  async function copyShareLink(): Promise<void> {
    if (!hyperlink) return;
    try {
      await navigator.clipboard.writeText(hyperlink);
      linkCopied = true;
      copied = false;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        linkCopied = false;
        close();
      }, 900);
    } catch {
      close();
    }
  }

  function toggle(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (!open) refreshPlace();
    open = !open;
    if (!open) {
      copied = false;
      linkCopied = false;
      reposted = false;
      clearTimeout(timer);
    }
  }

  function close(): void {
    open = false;
    reposted = false;
  }

  function openInThread(e: MouseEvent): void {
    e.stopPropagation();
    warmNavEvent(event);
    const modified = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
    if (modified) {
      close();
      return;
    }
    e.preventDefault();
    close();
    window.location.hash = threadHref;
  }

  async function repost(): Promise<void> {
    if (repostPending || isOwnEvent) return;
    if (!$session.pubkey) {
      close();
      openLoginDialog();
      return;
    }
    if (myRepost) {
      await deleteRepost();
      return;
    }
    repostPending = true;
    try {
      const signed = await signUnsigned(repostDraft(event));
      if (!signed) {
        showNotice(consumeSignFailure() ?? 'The repost could not be signed.');
        return;
      }
      const wrote = await publishSigned(signed);
      if (!wrote) {
        showNotice('The repost was signed, but no relay accepted it.');
        return;
      }
      myRepost = signed;
      reposted = true;
      showNotice('Reposted.', true);
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        reposted = false;
        close();
      }, 900);
    } finally {
      repostPending = false;
    }
  }

  async function deleteRepost(): Promise<void> {
    const target = myRepost;
    if (repostPending || !target) return;
    repostPending = true;
    try {
      const signed = await signUnsigned(deletionDraft(target));
      if (!signed) {
        showNotice(consumeSignFailure() ?? 'The deletion could not be signed.');
        return;
      }
      const wrote = await publishSigned(signed);
      if (!wrote) {
        showNotice('The deletion was signed, but no relay accepted it.');
        return;
      }
      myRepost = null;
      reposted = false;
      showNotice('Repost deleted.', true);
      clearTimeout(timer);
      timer = window.setTimeout(() => close(), 900);
    } finally {
      repostPending = false;
    }
  }

  async function broadcast(): Promise<void> {
    if (broadcastPending) return;
    broadcastPending = true;
    try {
      const { accepted, attempted } = await broadcastEvent(event);
      if (!attempted) {
        showNotice('No write relays are available to broadcast to.');
        return;
      }
      if (!accepted) {
        showNotice('No relay accepted the broadcast.');
        return;
      }
      showNotice(
        accepted === 1
          ? 'Broadcast to 1 relay.'
          : `Broadcast to ${accepted} of ${attempted} relays.`,
        true
      );
      clearTimeout(timer);
      timer = window.setTimeout(() => close(), 900);
    } finally {
      broadcastPending = false;
    }
  }

  function onPanelClick(e: MouseEvent): void {
    const item = (e.target as HTMLElement | null)?.closest?.('.menu-item');
    if (!item) return;
    if (item instanceof HTMLAnchorElement) return;
    if (item.hasAttribute('data-copy-action')) return;
    queueMicrotask(close);
  }

  $effect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onReposition = () => {
      refinePlace();
    };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    // Capture: reading pane / ToC may scroll inside nested containers.
    window.addEventListener('scroll', onReposition, true);
    const tick = requestAnimationFrame(() => {
      refinePlace();
      // Second frame: fonts/layout may still settle after first paint.
      requestAnimationFrame(refinePlace);
    });
    return () => {
      cancelAnimationFrame(tick);
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  });
</script>

<div
  class={`menu-wrap event-more-menu ${className}`.trim()}
  class:event-more-menu-open={open}
  bind:this={root}
>
  <button
    class="btn btn-icon copy-pointer-btn"
    class:copy-pointer-btn-custom={!!trigger}
    type="button"
    title="More"
    aria-label="More actions"
    aria-expanded={open}
    aria-haspopup="menu"
    onclick={toggle}
  >
    {#if trigger}
      {@render trigger()}
    {:else}
      <span class="more-ellipsis" aria-hidden="true">⋯</span>
    {/if}
  </button>
  {#if open}
    <ul
      class="menu-panel menu-panel-fixed"
      bind:this={panel}
      style={`top:${place.top}px;left:${place.left}px;max-height:${place.maxHeight}px;overflow-y:auto`}
      role="menu"
      onclick={onPanelClick}
      onkeydown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      }}
    >
      {#if before}
        {@render before()}
      {/if}
      <li role="none">
        <button
          class="menu-item"
          type="button"
          role="menuitem"
          data-copy-action
          onclick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void copyShareLink();
          }}
        >
          {linkCopied ? 'Copied' : 'Copy hyperlink'}
        </button>
      </li>
      <li role="none">
        <button
          class="menu-item"
          type="button"
          role="menuitem"
          data-copy-action
          onclick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void copy();
          }}
        >
          {copied ? 'Copied' : ptr.label}
        </button>
      </li>
      {#if !isCurrentThreadOp}
        <li role="none">
          <a
            class="menu-item"
            role="menuitem"
            href={threadHref}
            onclick={openInThread}
          >
            Open in a thread
          </a>
        </li>
      {/if}
      {#if showRepost}
        <li role="none">
          <button
            class="menu-item"
            type="button"
            role="menuitem"
            disabled={repostPending}
            onclick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void repost();
            }}
          >
            {#if repostPending}
              {hasMyRepost ? 'Deleting…' : 'Reposting…'}
            {:else if hasMyRepost}
              Delete Repost
            {:else if reposted}
              Reposted
            {:else}
              Repost
            {/if}
          </button>
        </li>
      {/if}
      <li role="none">
        <button
          class="menu-item"
          type="button"
          role="menuitem"
          disabled={broadcastPending}
          onclick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void broadcast();
          }}
        >
          {broadcastPending ? 'Broadcasting…' : 'Broadcast to your outboxes'}
        </button>
      </li>
      <li role="none">
        <button
          class="menu-item"
          type="button"
          role="menuitem"
          onclick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openRawEvent(event);
            close();
          }}
        >
          View the raw event
        </button>
      </li>
      <li role="none">
        <a
          class="menu-item"
          role="menuitem"
          href={njumpUrl}
          target="_blank"
          rel="noopener noreferrer"
          onclick={(e) => {
            e.stopPropagation();
            close();
          }}
        >
          View on Njump
        </a>
      </li>
      {#if after}
        {@render after()}
      {/if}
    </ul>
  {/if}
</div>
