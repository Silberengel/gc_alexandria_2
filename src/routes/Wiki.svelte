<script lang="ts">
  import { appClientHeight, appOffsetTop, appScrollTo } from '$lib/app-scroll';
  import { replace, querystring } from 'svelte-spa-router';
  import ErrorPage from '$lib/components/ErrorPage.svelte';
  import UserBadge from '$lib/components/UserBadge.svelte';
  import MentionControl from '$lib/components/MentionControl.svelte';
  import EventBody from '$lib/components/EventBody.svelte';
  import DetailsPanel from '$lib/components/DetailsPanel.svelte';
  import PublicationCard from '$lib/components/PublicationCard.svelte';
  import EditionHeader from '$lib/components/EditionHeader.svelte';
  import PageFilter from '$lib/components/PageFilter.svelte';
  import WorkCommentsPanel from '$lib/components/WorkCommentsPanel.svelte';
  import LoadingHint from '$lib/components/LoadingHint.svelte';
  import { KIND } from '$lib/constants';
  import { libraryDocumentPath } from '$lib/metadata';
  import { addressPath, parseAddress } from '$lib/library-scope';
  import { getWikiDeferTarget, isDeferralPlaceholderContent, isWikiDeference, deferrerPubkeys, wikiPathFromCoordinate } from '$lib/wiki-defer';
  import { parseWikiRedirect, uniqueRedirectTargets, wikiRedirectTargetHref } from '$lib/wiki-redirect';
  import { normalizeDTag } from '$lib/dtag';
  import { mercuryFilter, MERCURY_DOCUMENT_KINDS } from '$lib/nostr/mercury';
  import { relayPool } from '$lib/nostr/pool';
  import { wikiStack, documentStack } from '$lib/nostr/selector';
  import { eventAddress } from '$lib/nostr/verify';
  import { fetchById } from '$lib/nostr/fetch';
  import { memoryFindByAddress, memoryGetEvent, rememberEvents } from '$lib/nostr/event-memory';
  import { isNewerReplaceable, pruneToLatestReplaceables } from '$lib/nostr/replaceable';
  import { cacheFindByAddress } from '$lib/nostr/cache';
  import { warmAddress, warmNavEvent } from '$lib/nav-warm';
  import { skipNextNavTrack } from '$lib/nav-history';
  import { muteState, filterMuted } from '$lib/mute';
  import { createPageFindController, filterPageEvents } from '$lib/page-filter';
  import {
    emptyWorkResponses,
    fetchWorkResponses,
    highlightsForEvent,
    type WorkResponses
  } from '$lib/comments';
  import { isLibraryCopyPubkey } from '$lib/hex';
  import { decodePublicationPointer, hexFromNpubParam } from '$lib/publication-load';
  import {
    mergeInkIntoHighlights,
    textHighlightsFromEvents,
    seedHighlightProfile
  } from '$lib/text-highlights';
  import { wikiSpecHeroThumbUrl } from '$lib/cover';
  import type { Event } from 'nostr-tools';
  import SelectionActionTray from '$lib/components/SelectionActionTray.svelte';
  import { attachReaderPenSelect } from '$lib/reader-pen-select';
  import DrawingEditor from '$lib/components/DrawingEditor.svelte';
  import {
    deleteThreadDraft,
    loadThreadDraft,
    quoteDraftScope,
    saveThreadDraft
  } from '$lib/comment-drafts';
  import { articleHighlightDraft, commentDraft } from '$lib/drafts';
  import { publishComment, signAndPublish } from '$lib/sign';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { inkMarginChipsFromEvents } from '$lib/ink-margin';

  interface Props {
    params?: { d?: string; npub?: string; naddr?: string };
  }

  let { params = {} }: Props = $props();

  let event = $state<Event | null>(null);
  let versions = $state<Event[]>([]);
  /** Kind-30819 redirects for this d-tag when no article versions exist (disambiguation). */
  let redirectOptions = $state<Event[]>([]);
  let responses = $state<WorkResponses>(emptyWorkResponses());
  let error = $state(false);
  let deferredByList = $state<string[]>([]);
  let forwarding = $state(false);
  let pageFilter = $state('');
  let loading = $state(true);
  let socialLoading = $state(false);
  let articlePane = $state<HTMLElement | undefined>();
  let wikiSelDraft = $state<{ quote: string; context?: string } | null>(null);
  /** Hold quote when tray chrome / follow-up UI clears the browser selection. */
  let keepWikiSelDraft = false;
  let markMode = $state(false);
  $effect(() => {
    const root = articlePane;
    if (!root || typeof window === 'undefined') return;
    void markMode;
    return attachReaderPenSelect(root, { markMode: () => markMode });
  });
  let inkOpen = $state(false);
  /** Quote frozen when Ink note opens — survives selection/tray teardown. */
  let inkQuote = $state<string | null>(null);
  let notePromptOpen = $state(false);
  let notePromptText = $state('');
  let replyComposeOpen = $state(false);
  let replyDraftText = $state('');
  let selectionSheet = $state(false);
  /** Bumps on each wiki route paint; drops stale social/deferrer assignments. */
  let wikiPaintGen = 0;
  /** Route kind from URL prefix — wiki, spec, and article share this page but never the same address. */
  let routeKind = $state<number>(KIND.WIKI);
  const pageFind = createPageFindController();

  $effect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 720px)');
    const sync = () => {
      selectionSheet = mq.matches;
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  });

  function wikiContextFromSelection(sel: Selection | null, quote: string): string | undefined {
    try {
      const node = sel?.anchorNode;
      const el = node instanceof Element ? node : node?.parentElement;
      const block = el?.closest('p, li, blockquote, pre, div.paragraph, article');
      const full = block?.textContent?.trim();
      if (full && full !== quote && full.includes(quote)) return full.slice(0, 500);
    } catch {
      /* ignore */
    }
    return undefined;
  }

  function syncWikiSelection(): void {
    const sel = window.getSelection();
    const quote = sel?.toString().trim() ?? '';
    // Keep the draft while tray chrome is pressed or a follow-up UI is open —
    // browsers often clear the selection on pointerdown before click fires.
    const holdDraft = keepWikiSelDraft || inkOpen || notePromptOpen || replyComposeOpen;
    if (!quote || !sel || !articlePane) {
      if (!holdDraft) wikiSelDraft = null;
      return;
    }
    const node = sel.anchorNode;
    if (!node || !articlePane.contains(node)) {
      if (!holdDraft) wikiSelDraft = null;
      return;
    }
    keepWikiSelDraft = false;
    wikiSelDraft = { quote, context: wikiContextFromSelection(sel, quote) };
  }

  $effect(() => {
    if (!event || !articlePane) {
      wikiSelDraft = null;
      keepWikiSelDraft = false;
      return;
    }
    const onSel = () => syncWikiSelection();
    const onPointer = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      // Tray / follow-up chrome must not drop the captured quote on pointerdown.
      if (t.closest('.sel-tray, .reader-sel-host, .reader-mini-dialog, .draw-overlay')) {
        keepWikiSelDraft = true;
      }
    };
    document.addEventListener('selectionchange', onSel);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('selectionchange', onSel);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  });

  async function saveWikiHighlight(comment?: string): Promise<void> {
    if (!event || !wikiSelDraft) return;
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    const signed = await signAndPublish(
      articleHighlightDraft(event, wikiSelDraft.quote, wikiSelDraft.context, comment)
    );
    if (signed) {
      const mine = session
        .getMetadata()
        .find((e) => e.kind === KIND.METADATA && e.pubkey.toLowerCase() === signed.pubkey.toLowerCase());
      seedHighlightProfile(signed.pubkey, mine ?? null);
      responses = {
        ...responses,
        highlights: [signed, ...responses.highlights.filter((h) => h.id !== signed.id)]
      };
      clearSelectionDraft('note', wikiSelDraft.quote);
      wikiSelDraft = null;
      notePromptOpen = false;
      notePromptText = '';
      window.getSelection()?.removeAllRanges();
    }
  }

  async function submitWikiReply(): Promise<void> {
    if (!event || !wikiSelDraft) return;
    const text = replyDraftText.trim();
    if (!text) return;
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    const quote = wikiSelDraft.quote;
    const body = `> ${quote.replace(/\n/g, '\n> ')}\n\n${text}`;
    const signed = await publishComment(commentDraft(event, body));
    if (signed) {
      clearSelectionDraft('reply', quote);
      replyComposeOpen = false;
      replyDraftText = '';
      wikiSelDraft = null;
      window.getSelection()?.removeAllRanges();
    }
  }

  async function onWikiInkComplete(result: {
    url: string;
    imeta: string[];
  }): Promise<void> {
    const quote = inkQuote ?? wikiSelDraft?.quote;
    if (!event || !quote) return;
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    const body = `> ${quote.replace(/\n/g, '\n> ')}\n\n${result.url}`;
    const partial = commentDraft(event, body);
    const signed = await publishComment({ ...partial, tags: [...partial.tags, result.imeta] });
    if (signed) {
      responses = {
        ...responses,
        thread: [signed, ...responses.thread.filter((e) => e.id !== signed.id)]
      };
      inkOpen = false;
      inkQuote = null;
      wikiSelDraft = null;
      keepWikiSelDraft = false;
      window.getSelection()?.removeAllRanges();
      // publishComment already toasts success.
    }
  }

  function openWikiInk(): void {
    if (!wikiSelDraft) return;
    inkQuote = wikiSelDraft.quote;
    keepWikiSelDraft = true;
    inkOpen = true;
  }

  const wikiInkDraftScope = $derived(
    event && inkQuote
      ? `ink:${event.id.toLowerCase()}:${quoteDraftScope(inkQuote)}`
      : ''
  );

  function selectionDraftScope(kind: 'reply' | 'note', quote: string): string {
    if (!event) return '';
    return `wiki-${kind}:${event.id.toLowerCase()}:${quoteDraftScope(quote)}`;
  }

  function hydrateSelectionDraft(kind: 'reply' | 'note', quote: string): void {
    const pubkey = $session.pubkey;
    const scope = selectionDraftScope(kind, quote);
    if (!pubkey || !scope) return;
    const saved = loadThreadDraft(pubkey, scope);
    if (!saved?.text) return;
    if (kind === 'reply') replyDraftText = saved.text;
    else notePromptText = saved.text;
  }

  function persistSelectionDraft(kind: 'reply' | 'note', quote: string, text: string): void {
    const pubkey = $session.pubkey;
    const scope = selectionDraftScope(kind, quote);
    if (!pubkey || !scope) return;
    saveThreadDraft(pubkey, scope, {
      text,
      imetaTags: [],
      asKind1Reply: false
    });
  }

  function clearSelectionDraft(kind: 'reply' | 'note', quote: string): void {
    const pubkey = $session.pubkey;
    const scope = selectionDraftScope(kind, quote);
    if (!pubkey || !scope) return;
    deleteThreadDraft(pubkey, scope);
  }

  $effect(() => {
    if (!replyComposeOpen || !wikiSelDraft) return;
    const quote = wikiSelDraft.quote;
    const text = replyDraftText;
    const t = setTimeout(() => persistSelectionDraft('reply', quote, text), 280);
    return () => clearTimeout(t);
  });

  $effect(() => {
    if (!notePromptOpen || !wikiSelDraft) return;
    const quote = wikiSelDraft.quote;
    const text = notePromptText;
    const t = setTimeout(() => persistSelectionDraft('note', quote, text), 280);
    return () => clearTimeout(t);
  });

  const isSpecRoute = $derived(routeKind === KIND.SPEC);
  const isArticleRoute = $derived(routeKind === KIND.LONG_FORM);
  const surfaceLabel = $derived(
    isSpecRoute ? 'Spec' : isArticleRoute ? 'Article' : 'Wiki'
  );

  function stackForArticleKind(kind: number): string[] {
    return kind === KIND.LONG_FORM ? documentStack() : wikiStack();
  }

  function isArticleKind(kind: number): boolean {
    return kind === KIND.WIKI || kind === KIND.SPEC || kind === KIND.LONG_FORM;
  }
  const mutedHighlights = $derived(filterMuted(responses.highlights, $muteState));
  const wikiInkChips = $derived(inkMarginChipsFromEvents(responses.thread));
  const bodyHighlights = $derived(
    event
      ? mergeInkIntoHighlights(
          textHighlightsFromEvents(highlightsForEvent(mutedHighlights, event)),
          wikiInkChips
        )
      : []
  );
  const visibleVersions = $derived(filterPageEvents(versions, pageFilter));
  const panelResponses = $derived.by((): WorkResponses => {
    const q = pageFilter.trim().toLowerCase();
    if (!q) return responses;
    const match = (e: Event) => e.content.toLowerCase().includes(q);
    return {
      thread: responses.thread.filter(match),
      quotes: responses.quotes.filter(match),
      highlights: responses.highlights.filter(match),
      other: (responses.other ?? []).filter(match),
      zaps: responses.zaps ?? [],
      boosts: responses.boosts ?? [],
      bookmarks: responses.bookmarks ?? [],
      pins: responses.pins ?? [],
      bookmarkSets: responses.bookmarkSets ?? [],
      curations: responses.curations ?? [],
      labels: responses.labels ?? [],
      appHandlers: responses.appHandlers ?? []
    };
  });
  /** Strip the early body image when the header paints it as a hero. */
  const dedupeHeaderHero = $derived(!!event && !!wikiSpecHeroThumbUrl(event));
  const hideBody = $derived(
    !!event && (isWikiDeference(event) || isDeferralPlaceholderContent(event.content))
  );
  const urlFocusComment = $derived(
    (new URLSearchParams($querystring ?? '').get('comment') ?? '').trim().toLowerCase()
  );

  let commentFocusApplied = $state('');

  function decodeParam(raw: string): string {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  function routeKindFromHash(hashPath: string): number {
    if (/^\/spec(\/|$)/i.test(hashPath)) return KIND.SPEC;
    if (/^\/article(\/|$)/i.test(hashPath)) return KIND.LONG_FORM;
    return KIND.WIKI;
  }

  /** Sync only — landing/search already put this in memory. Never scan Cache Storage here. */
  function warmArticle(pubkey: string, d: string, kind: number): Event | null {
    const slug = normalizeDTag(d) || d;
    return memoryFindByAddress(kind, pubkey, slug) ?? memoryFindByAddress(kind, pubkey, d);
  }

  /**
   * Cold load: Mercury (if up) then wikiStack across relays in parallel.
   * `onHit` fires as soon as any relay returns the article so SPA nav can paint early.
   * Uses a priority pool slot so Home background FoF/deletion REQs cannot starve wiki.
   */
  async function loadArticleByAuthorD(
    pubkey: string,
    d: string,
    kind: number,
    onHit?: (event: Event) => void
  ): Promise<Event | null> {
    if (!/^[0-9a-f]{64}$/.test(pubkey)) return null;
    const slug = normalizeDTag(d) || d;
    const dValues = [...new Set([d, slug].filter(Boolean))];
    const filter = {
      kinds: [kind],
      authors: [pubkey],
      '#d': dValues,
      limit: 5
    };
    let reported = false;
    const report = (ev: Event): void => {
      if (reported) return;
      if (ev.kind !== kind) return;
      reported = true;
      onHit?.(ev);
    };
    const pickNewest = (events: Event[]): Event | null => {
      let best: Event | null = null;
      for (const ev of events) {
        if (ev.kind !== kind) continue;
        if (!best || isNewerReplaceable(ev, best)) best = ev;
      }
      return best;
    };
    const absorb = (batch: Event[]): void => {
      const hit = pickNewest(batch);
      if (hit) report(hit);
    };
    // Race Mercury HTTP with wiki/document relays. Specs like nkbip-04 may live on
    // thecitadel while Mercury only indexes a subset (e.g. nkbip-01).
    // includeCooling: a prior soft-fail must not hide library hosts for deep links.
    const queryOpts = { priority: true, includeCooling: true };
    const [mHits, wHits] = await Promise.all([
      mercuryFilter(filter),
      relayPool.query(stackForArticleKind(kind), [filter], 8000, 6, absorb, queryOpts)
    ]);
    let hit = pickNewest([...mHits, ...wHits]);
    if (hit) {
      report(hit);
      return hit;
    }
    // Second pass: document search hosts only (thecitadel / Mercury WSS).
    const docHits = await relayPool.query(
      documentStack(),
      [filter],
      8000,
      6,
      absorb,
      queryOpts
    );
    hit = pickNewest(docHits);
    if (hit) report(hit);
    return hit;
  }

  function isBech32Pointer(value: string): boolean {
    return /^(naddr|nevent|note)1[02-9ac-hj-np-z]+$/i.test(value.trim());
  }
  $effect(() => {
    if (!event || loading) return;
    void $querystring;
    const id = urlFocusComment;
    if (!id) {
      commentFocusApplied = '';
      queueMicrotask(() => appScrollTo({ top: 0, left: 0, behavior: 'auto' }));
      return;
    }
    void responses;
    if (id === commentFocusApplied) return;
    let attempts = 40;
    let timer = 0;
    const tryScroll = () => {
      const el = document.getElementById(`comment-${id}`);
      if (el) {
        const top = Math.max(0, appOffsetTop(el) - Math.round(appClientHeight() / 3));
        appScrollTo({ top, left: 0, behavior: 'smooth' });
        commentFocusApplied = id;
        return;
      }
      if (attempts-- <= 0) return;
      timer = window.setTimeout(tryScroll, 100);
    };
    const tick = window.setTimeout(() => requestAnimationFrame(tryScroll), 50);
    return () => {
      clearTimeout(tick);
      clearTimeout(timer);
    };
  });

  $effect(() => {
    const root = articlePane;
    const q = pageFilter;
    if (!event || hideBody || !root) return;
    return pageFind.observe(root, q);
  });

  function cyclePageFind(): void {
    if (articlePane) pageFind.next(articlePane);
  }

  function hashQuery(): URLSearchParams {
    const hash = window.location.hash;
    const i = hash.indexOf('?');
    return new URLSearchParams(i >= 0 ? hash.slice(i + 1) : '');
  }

  function seedDeferrersFromUrl(): string[] {
    const q = hashQuery();
    return q
      .getAll('deferredBy')
      .flatMap((v) => v.split(','))
      .map((s) => s.trim().toLowerCase())
      .filter((pk) => /^[0-9a-f]{64}$/.test(pk));
  }

  async function loadDeferrers(target: Event): Promise<string[]> {
    const seeds = seedDeferrersFromUrl();
    const addr = eventAddress(target);
    const dTag = target.tags.find((t) => t[0] === 'd')?.[1];
    // Mercury-first — avoid a second full wikiStack fan-out on every page load.
    // Deferrers are wiki/spec articles that point at this address (either kind may defer).
    const filters = [
      { kinds: [KIND.WIKI, KIND.SPEC], '#a': [addr], limit: 40 },
      ...(dTag ? [{ kinds: [KIND.WIKI, KIND.SPEC], '#d': [dTag], limit: 40 }] : [])
    ];
    const batches = await Promise.all(filters.map((filter) => mercuryFilter(filter)));
    const byId = new Map<string, Event>();
    for (const batch of batches) for (const e of batch) byId.set(e.id, e);
    if (byId.size < 2) {
      const relayHits = await relayPool.query(wikiStack(), filters, 4000);
      for (const e of relayHits) byId.set(e.id, e);
    }
    return deferrerPubkeys(pruneToLatestReplaceables([...byId.values()]), target, seeds);
  }

  async function paintWiki(fetched: Event, gen: number): Promise<void> {
    // Paint immediately — never leave "Page is loading…" waiting on deference I/O.
    rememberEvents([fetched]);
    event = fetched;
    loading = false;
    socialLoading = true;
    if (await forwardDeference(fetched)) return;
    if (gen !== wikiPaintGen || event?.id !== fetched.id) {
      if (gen === wikiPaintGen) socialLoading = false;
      return;
    }
    // Social + deferrers after first paint — waiting on them left the page stuck under rate limits.
    void loadSocial(fetched, gen);
    void loadDeferrers(fetched).then((deferrers) => {
      if (gen !== wikiPaintGen || event?.id !== fetched.id) return;
      deferredByList = deferrers;
    });
  }

  async function eventFromId(id: string): Promise<Event | null> {
    const fromMem = memoryGetEvent(id);
    if (fromMem) return fromMem;
    const mercury = await mercuryFilter({
      ids: [id],
      kinds: [...MERCURY_DOCUMENT_KINDS],
      limit: 1
    });
    if (mercury[0]) {
      rememberEvents([mercury[0]]);
      return mercury[0];
    }
    const hit = (await relayPool.query(wikiStack(), [{ ids: [id], limit: 1 }]))[0] ?? null;
    if (hit) rememberEvents([hit]);
    return hit;
  }

  async function forwardDeference(from: Event): Promise<boolean> {
    if (hashQuery().get('deferredBy')) return false;
    const target = getWikiDeferTarget(from);
    if (!target) return false;
    let path: string | null = null;
    if (target.coordinate) {
      const parsed = parseAddress(target.coordinate);
      if (parsed && parsed.pubkey === from.pubkey) {
        const d = from.tags.find((t) => t[0] === 'd')?.[1] ?? '';
        if (parsed.d === d) return false;
      }
      warmAddress(target.coordinate);
      path = addressPath(target.coordinate);
    }
    if (!path && target.eventId) {
      const dest = await eventFromId(target.eventId);
      if (dest) {
        warmNavEvent(dest);
        path = libraryDocumentPath(dest);
      }
    }
    if (!path) return false;
    forwarding = true;
    replace(`${path}?deferredBy=${from.pubkey}`);
    return true;
  }

  async function loadSocial(target: Event, gen: number): Promise<void> {
    try {
      const hit = await fetchWorkResponses(target, 60, (cached) => {
        if (gen !== wikiPaintGen || event?.id !== target.id) return;
        responses = cached;
        socialLoading = false;
      });
      if (gen !== wikiPaintGen || event?.id !== target.id) return;
      responses = hit;
    } finally {
      if (gen === wikiPaintGen) socialLoading = false;
    }
  }

  $effect(() => {
    // Prefer router params; fall back to parsing the hash so a stale/empty params
    // object never skips the lookup and flashes "not found".
    const hashPath = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '').split('?')[0] : '';
    const kind = routeKindFromHash(hashPath);
    routeKind = kind;
    const prefix =
      kind === KIND.SPEC ? 'spec' : kind === KIND.LONG_FORM ? 'article' : 'wiki';
    const hashDnpub = hashPath.match(new RegExp(`^\\/${prefix}\\/d\\/([^/]+)\\/p\\/([^/]+)\\/?$`, 'i'));
    const hashDonly = hashPath.match(new RegExp(`^\\/${prefix}\\/d\\/([^/]+)\\/?$`, 'i'));
    const hashPointer = hashPath.match(
      new RegExp(
        `^\\/${prefix}\\/(?:(?:naddr|nevent|note)\\/)?((?:naddr|nevent|note)1[02-9ac-hj-np-z]+)\\/?$`,
        'i'
      )
    );

    const dTag = decodeParam(
      params.d || (hashDnpub?.[1] ?? hashDonly?.[1] ?? '')
    );
    const npubParam = (params.npub || hashDnpub?.[2] || '').split('?')[0];
    const naddrRaw = params.naddr || hashPointer?.[1] || '';
    const naddr = isBech32Pointer(naddrRaw) ? naddrRaw : '';

    let cancelled = false;
    const paintGen = ++wikiPaintGen;
    versions = [];
    redirectOptions = [];
    responses = emptyWorkResponses();
    socialLoading = false;
    error = false;
    forwarding = false;
    deferredByList = seedDeferrersFromUrl();

    const pubkey = npubParam ? hexFromNpubParam(npubParam) : '';
    const warm = dTag && pubkey ? warmArticle(pubkey, dTag, kind) : null;

    if (warm) {
      void paintWiki(warm, paintGen);
    } else {
      event = null;
      loading = true;
    }

    void (async () => {
      try {
        // Author+d is the normal deep link — never let a stray naddr param steal this path.
        if (dTag && npubParam) {
          if (!pubkey) {
            if (!cancelled) error = true;
            return;
          }
          if (warm) return;
          const slug = normalizeDTag(dTag) || dTag;
          // Memory / shallow cache only — a full Cache Storage walk blocks wiki for seconds.
          const cached =
            memoryFindByAddress(kind, pubkey, slug) ??
            (await cacheFindByAddress(kind, pubkey, slug));
          if (cancelled) return;
          if (cached) {
            await paintWiki(cached, paintGen);
            return;
          }
          const fetched = await loadArticleByAuthorD(pubkey, dTag, kind, (early) => {
            if (!cancelled) void paintWiki(early, paintGen);
          });
          if (cancelled) return;
          if (fetched) {
            if (!event || event.id !== fetched.id) await paintWiki(fetched, paintGen);
          } else if (!cancelled && !event) error = true;
          return;
        }

        if (naddr) {
          const decoded = decodePublicationPointer(naddr);
          if (!decoded) {
            if (!cancelled) error = true;
            return;
          }
          // Pointer kind wins over the URL prefix so a wiki naddr under /spec (or vice versa)
          // canonicalizes to the correct surface.
          const fromPointer = decoded.kind;
          const pointerKind = fromPointer != null && isArticleKind(fromPointer) ? fromPointer : kind;
          let fetched: Event | null = null;
          if (decoded.id) {
            fetched = memoryGetEvent(decoded.id) ?? (await fetchById(decoded.id));
          } else if (decoded.pubkey && decoded.d != null) {
            fetched =
              warmArticle(decoded.pubkey, decoded.d, pointerKind) ??
              (await loadArticleByAuthorD(decoded.pubkey, decoded.d, pointerKind, (early) => {
                if (!cancelled) void paintWiki(early, paintGen);
              }));
          }
          if (cancelled) return;
          if (!fetched || !isArticleKind(fetched.kind)) {
            if (!event) error = true;
            return;
          }
          const path = libraryDocumentPath(fetched);
          const here = window.location.hash.replace(/^#/, '').split('?')[0];
          if (here !== path) {
            skipNextNavTrack();
            replace(path);
            return;
          }
          await paintWiki(fetched, paintGen);
          return;
        }

        if (dTag && !npubParam) {
          const articleFilter = { kinds: [kind], '#d': [dTag], limit: 50 };
          const redirectFilter = {
            kinds: [KIND.WIKI_REDIRECT],
            '#d': [dTag],
            limit: 40
          };
          const [m, w, redirects] = await Promise.all([
            mercuryFilter(articleFilter),
            relayPool.query(stackForArticleKind(kind), [articleFilter], 8000),
            kind === KIND.LONG_FORM
              ? Promise.resolve([] as Event[])
              : relayPool.query(wikiStack(), [redirectFilter], 6000)
          ]);
          const byId = new Map<string, Event>();
          for (const e of [...m, ...w]) {
            if (e.kind === kind) byId.set(e.id, e);
          }
          const found = pruneToLatestReplaceables([...byId.values()]);
          if (cancelled) return;
          if (found.length) {
            rememberEvents(found);
            versions = found;
            redirectOptions = [];
            return;
          }
          const redirectHits = pruneToLatestReplaceables(
            redirects.filter((e) => e.kind === KIND.WIKI_REDIRECT)
          );
          if (redirectHits.length) {
            rememberEvents(redirectHits);
            const targets = uniqueRedirectTargets(redirectHits);
            if (targets.length === 1) {
              const path = wikiPathFromCoordinate(targets[0]);
              if (path) {
                forwarding = true;
                skipNextNavTrack();
                replace(path);
                return;
              }
            }
            redirectOptions = redirectHits;
            return;
          }
          error = true;
          return;
        }

        if (!cancelled) error = true;
      } catch {
        if (!cancelled) error = true;
      } finally {
        if (!cancelled) loading = false;
      }
    })();

    return () => {
      cancelled = true;
      if (paintGen === wikiPaintGen) wikiPaintGen++;
    };
  });
</script>

<main class="shell">
  {#if error}
    <ErrorPage title={`${surfaceLabel} page not found`} />
  {:else if forwarding}
    <LoadingHint message="Opening the preferred version…" />
  {:else if versions.length}
    <header class="page-header">
      <p class="page-kicker">{surfaceLabel}</p>
      <h1>Versions</h1>
      <p class="page-lede muted">Choose which author’s version of this page to open.</p>
    </header>
    <PageFilter bind:value={pageFilter} />
    <div class="card-grid card-grid-results">
      {#each visibleVersions as version (version.id)}
        <div>
          {#if isLibraryCopyPubkey(version.pubkey)}
            <p class="muted">Library copy</p>
          {/if}
          <PublicationCard event={version} />
        </div>
      {/each}
    </div>
  {:else if redirectOptions.length}
    <header class="page-header">
      <p class="page-kicker">{surfaceLabel}</p>
      <h1>Disambiguation</h1>
      <p class="page-lede muted">
        This slug redirects to more than one article. Choose a destination.
      </p>
    </header>
    <ul class="wiki-redirect-disambig">
      {#each redirectOptions as redirect (redirect.id)}
        {@const parsed = parseWikiRedirect(redirect)}
        {@const href = wikiRedirectTargetHref(redirect)}
        <li>
          {#if href}
            <a href={`#${href}`}>{parsed?.targetCoordinate ?? href}</a>
          {:else}
            <span class="muted">{parsed?.targetCoordinate ?? redirect.id.slice(0, 12)}</span>
          {/if}
          <span class="muted"> · </span>
          <UserBadge pubkey={redirect.pubkey} />
        </li>
      {/each}
    </ul>
  {:else if event}
    {#if deferredByList.length}
      <div class="wiki-defer-banner">
        <p class="wiki-defer-banner-title">Deferred to by</p>
        <ul class="wiki-defer-list">
          {#each deferredByList as pk (pk)}
            <li><UserBadge pubkey={pk} /></li>
          {/each}
        </ul>
      </div>
    {/if}
    <PageFilter
      bind:value={pageFilter}
      placeholder="Find in this page…"
      onEnter={cyclePageFind}
    />
    <article class="card reading-body" class:mark-mode={markMode} bind:this={articlePane}>
      <EditionHeader {event} />
      {#if !hideBody}
        <EventBody {event} quotes={bodyHighlights} dedupeHeroImage={dedupeHeaderHero} />
      {/if}
      <DetailsPanel {event} appHandlers={responses.appHandlers ?? []} />
    </article>
    {#if wikiSelDraft && !inkOpen && !notePromptOpen && !replyComposeOpen}
      {@const selDraft = wikiSelDraft}
      <div class="reader-sel-host" class:sheet={selectionSheet}>
        <SelectionActionTray
          quote={selDraft.quote}
          sheet={selectionSheet}
          {markMode}
          onMarkMode={(on) => (markMode = on)}
          onHighlight={() => void saveWikiHighlight()}
          onHighlightNote={() => {
            keepWikiSelDraft = true;
            notePromptText = '';
            hydrateSelectionDraft('note', selDraft.quote);
            notePromptOpen = true;
          }}
          onReply={() => {
            keepWikiSelDraft = true;
            replyDraftText = '';
            hydrateSelectionDraft('reply', selDraft.quote);
            replyComposeOpen = true;
          }}
          onInk={openWikiInk}
          onDismiss={() => {
            wikiSelDraft = null;
            keepWikiSelDraft = false;
            window.getSelection()?.removeAllRanges();
          }}
        />
      </div>
    {/if}
    {#if notePromptOpen && wikiSelDraft}
      <div class="reader-mini-dialog" role="dialog" aria-label="Highlight note">
        <label>
          Note on highlight
          <MentionControl mode="prose" multiline rows={3} bind:value={notePromptText} placeholder="Your note…" />
        </label>
        <div class="compose-actions">
          <button class="btn" type="button" onclick={() => (notePromptOpen = false)}>Cancel</button>
          <button
            class="btn btn-primary"
            type="button"
            disabled={!notePromptText.trim()}
            onclick={() => void saveWikiHighlight(notePromptText.trim())}
            >Save highlight</button
          >
        </div>
      </div>
    {/if}
    {#if replyComposeOpen && wikiSelDraft}
      <div class="reader-mini-dialog" role="dialog" aria-label="Reply with quote">
        <label>
          Reply
          <MentionControl mode="prose" multiline rows={3} bind:value={replyDraftText} placeholder="Your reply…" />
        </label>
        <div class="compose-actions">
          <button class="btn" type="button" onclick={() => (replyComposeOpen = false)}>Cancel</button>
          <button
            class="btn btn-primary"
            type="button"
            disabled={!replyDraftText.trim()}
            onclick={() => void submitWikiReply()}
            >Post reply</button
          >
        </div>
      </div>
    {/if}
    <DrawingEditor
      bind:open={inkOpen}
      title="Ink note"
      initialPaper="sticky"
      draftScope={wikiInkDraftScope}
      onComplete={(r) => void onWikiInkComplete(r)}
      onCancel={() => {
        inkOpen = false;
        inkQuote = null;
      }}
    />
    <div class="card reading-width" style="margin-top:1rem">
      <WorkCommentsPanel target={event} responses={panelResponses} focusId={urlFocusComment} loading={socialLoading} />
    </div>
  {:else}
    <LoadingHint message="Page is loading..." />
  {/if}
</main>
