<script lang="ts">
  import TopBar from '$lib/components/TopBar.svelte';
  import EventCard from '$lib/components/EventCard.svelte';
  import Pager from '$lib/components/Pager.svelte';
  import PageFilter from '$lib/components/PageFilter.svelte';
  import ListingViewToggle from '$lib/components/ListingViewToggle.svelte';
  import EventsTable from '$lib/components/EventsTable.svelte';
  import { listingDensity } from '$lib/stores/listing-density';
  import { listingPageSize } from '$lib/listing-table';
  import { KIND, READING_CONCURRENT_DEFAULT } from '$lib/constants';
  import { relayPool } from '$lib/nostr/pool';
  import { documentStack, profileStack, socialStack } from '$lib/nostr/selector';
  import { firstTag, eventAddress, isTopLevel30040 } from '$lib/nostr/verify';
  import { toNostrBuildThumbUrl } from '$lib/nostr-build';
  import { countReadsByAuthor } from '$lib/search';
  import { parseKind0, paymentRows, paymentTypeLabel, cropPaymentAddress, aboutHtml } from '$lib/profile-fields';
  import { selectUserStatuses, type UserStatus } from '$lib/nip38-user-status';
  import { muteState, filterMuted, followPubkeysFromMetadata, latestReplaceable } from '$lib/mute';
  import { filterPageEvents } from '$lib/page-filter';
  import { mercuryFilter } from '$lib/nostr/mercury';
  import { cachePutEvent, cacheGetProfilePageSnapshot, cachePutProfilePageSnapshot, peekProfilePageSnapshot, profilePageSnapshotFresh, type ProfilePageSnapshot } from '$lib/nostr/cache';
  import { rememberEvents, memoryFindMetadata } from '$lib/nostr/event-memory';
  import { peekProfileThumb, rememberProfileFromKind0 } from '$lib/profile-cache';
  import { pickLatestReplaceable, isNewerReplaceable } from '$lib/nostr/replaceable';
  import { fetchByAddress, fetchByIds } from '$lib/nostr/fetch';
  import { publicationTargets, isListPublicationLabelEvent } from '$lib/nip32';
  import { publicationTargetsFromDirectory } from '$lib/bookshelf';
  import { referencedLibraryAddress, parseAddress } from '$lib/library-scope';
  import { topLevelPublicationAddress } from '$lib/landing';
  import {
    interactionMarksFromEvents,
    marksForPublication,
    INTERACTION_MARK_LABELS,
    type InteractionMark
  } from '$lib/interaction-marks';
  import { nip19, type Event } from 'nostr-tools';
  import { untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { isAllowedHref } from '$lib/markup';
  import { openMediaViewer } from '$lib/stores/media-viewer';
  import Nip05Badge from '$lib/components/Nip05Badge.svelte';
  import UserStatusBadge from '$lib/components/UserStatusBadge.svelte';
  import { session } from '$lib/stores/session';
  import { trustedAssertions } from '$lib/trusted-assertions';
  import { hasKnownRank } from '$lib/nip85-trusted-assertions';
  import { profileBannerFallbackStyle } from '$lib/profile-banner';
  import {
    activeReadingEntries,
    parseReadingQueue,
    readingProgressPercent,
    type ReadingQueueEntry
  } from '$lib/reading-queue';
  import { readingPrefs } from '$lib/stores/reading-prefs';
  import { localReadingQueue } from '$lib/stores/local-reading-queue';
  import { editionMetadata } from '$lib/publication-metadata';
  import { publicationPath } from '$lib/metadata';
  import { link } from 'svelte-spa-router';
  import ErrorPage from '$lib/components/ErrorPage.svelte';
  import ProfileBlogFeed from '$lib/components/ProfileBlogFeed.svelte';
  import {
    parseKindParam,
    decodeProfileIdSegment,
    resolveProfilePubkey,
    profileKindHeading,
    profileKindPath,
    eventChronologySec
  } from '$lib/profile-route';

  interface Props {
    params?: { id?: string; kind?: string };
  }

  let { params = {} }: Props = $props();

  let pubkey = $state('');
  let npub = $state('');
  /** Path id as opened (npub or nip05) — used for shareable kind URLs. */
  let profilePathId = $state('');
  let kindFilter = $state<number | null>(null);
  let kindInvalid = $state(false);
  let resolveFailed = $state(false);
  let resolving = $state(false);
  let profile = $state<Event | null>(null);
  /** Immediate paint from badge thumb cache when kind-0 is not yet in event-memory. */
  let warmName = $state('');
  let warmPicture = $state('');
  let produced = $state<Event[]>([]);
  let interacted = $state<Event[]>([]);
  let marksByWork = $state<Map<string, InteractionMark[]>>(new Map());
  let statusGeneral = $state<UserStatus | null>(null);
  let statusMusic = $state<UserStatus | null>(null);
  let payments = $state<ReturnType<typeof paymentRows>>([]);
  let pageFilter = $state('');
  let producedPage = $state(1);
  let interactedPage = $state(1);
  let grapevineRank = $state<number | null>(null);
  let viewerFollows = $state(false);
  let readCount = $state(0);
  let readingEntries = $state<ReadingQueueEntry[]>([]);
  let readingTitles = $state<Map<string, string>>(new Map());
  let readingEditions = $state<Map<string, Event>>(new Map());

  const fields = $derived(parseKind0(profile));
  const displayTitle = $derived(fields.title || warmName || 'Unknown');
  const displayPicture = $derived(fields.picture || warmPicture);
  const pageSize = $derived(listingPageSize($listingDensity));
  /** Own profile uses Settings N; others use the client default (their N is not on relays). */
  const isOwnProfile = $derived(
    !!$session.pubkey && !!pubkey && $session.pubkey.toLowerCase() === pubkey.toLowerCase()
  );
  const concurrentLimit = $derived(
    isOwnProfile ? $readingPrefs.concurrent : READING_CONCURRENT_DEFAULT
  );
  const profileActiveReading = $derived(activeReadingEntries(readingEntries, concurrentLimit));
  const isBlogMode = $derived(kindFilter === KIND.LONG_FORM);
  const isKindFiltered = $derived(kindFilter != null);
  const kindHeading = $derived(kindFilter != null ? profileKindHeading(kindFilter) : '');
  const profileShareId = $derived(profilePathId || npub || pubkey);
  const blogPath = $derived(
    profileShareId ? profileKindPath(profileShareId, KIND.LONG_FORM) : ''
  );
  const fullProfilePath = $derived(profileShareId ? `/p/${profileShareId}` : '');
  const filteredProduced = $derived.by(() => {
    let list = filterMuted(produced, $muteState);
    if (kindFilter != null) list = list.filter((e) => e.kind === kindFilter);
    if (isBlogMode) {
      return [...list].sort((a, b) => eventChronologySec(b) - eventChronologySec(a));
    }
    return list;
  });
  const visibleProduced = $derived(filterPageEvents(filteredProduced, pageFilter));
  const visibleInteracted = $derived(
    isKindFiltered ? [] : filterPageEvents(filterMuted(interacted, $muteState), pageFilter)
  );
  const pagedProduced = $derived(visibleProduced.slice((producedPage - 1) * pageSize, producedPage * pageSize));
  const pagedInteracted = $derived(
    visibleInteracted.slice((interactedPage - 1) * pageSize, interactedPage * pageSize)
  );
  /** Produced then interacted, deduped — single table in table view. */
  const allProfileListings = $derived.by(() => {
    const seen = new Set<string>();
    const out: Event[] = [];
    for (const event of [...visibleProduced, ...visibleInteracted]) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      out.push(event);
    }
    return out;
  });

  $effect(() => {
    pageFilter;
    $listingDensity;
    producedPage = 1;
    interactedPage = 1;
  });

  /** Own profile + local-only: show the on-device queue instead of relay 16374. */
  $effect(() => {
    if (!isOwnProfile || !$readingPrefs.localOnly) return;
    readingEntries = $localReadingQueue;
  });

  $effect(() => {
    const pk = pubkey;
    const viewer = $session.pubkey;
    if (!pk || !viewer || viewer.toLowerCase() === pk.toLowerCase()) {
      viewerFollows = false;
      return;
    }
    const unsub = session.metadata.subscribe((events) => {
      viewerFollows = followPubkeysFromMetadata(events).has(pk.toLowerCase());
    });
    return unsub;
  });

  $effect(() => {
    const pk = pubkey;
    if (!pk) {
      grapevineRank = null;
      return;
    }
    let cancelled = false;
    const applyScore = () => {
      if (cancelled) return;
      const score = trustedAssertions.getScore(pk);
      grapevineRank = hasKnownRank(score) ? Math.round(score!.rank as number) : null;
    };
    const unsub = trustedAssertions.subscribe(applyScore);
    applyScore();
    void trustedAssertions
      .resolveProvider(session.getPubkey())
      .then(() => trustedAssertions.requestScoresAndWait([pk]))
      .then(applyScore)
      .catch(() => {});
    return () => {
      cancelled = true;
      unsub();
    };
  });

  function omitNested(events: Event[]): Event[] {
    const pubs = events.filter((e) => e.kind === KIND.PUBLICATION);
    const hasTop = pubs.some((e) => isTopLevel30040(e, pubs));
    if (!hasTop) return events;
    return events.filter((e) => e.kind !== KIND.PUBLICATION || isTopLevel30040(e, pubs));
  }

  async function resolveInteracted(events: Event[]): Promise<Event[]> {
    const coords = new Set<string>();
    const ids = new Set<string>();
    for (const event of events) {
      if (event.kind === KIND.LABEL || event.kind === KIND.BOOKMARK) {
        const t = publicationTargets(event);
        for (const a of t.addresses) coords.add(a);
        for (const id of t.eventIds) ids.add(id);
      }
      if (event.kind === KIND.DIRECTORY) {
        const t = publicationTargetsFromDirectory(event);
        for (const a of t.addresses) coords.add(a);
        for (const id of t.eventIds) ids.add(id);
      }
      const lib = referencedLibraryAddress(event);
      if (lib) coords.add(lib);
      const a = firstTag(event, 'a') ?? firstTag(event, 'A');
      if (a) coords.add(a);
    }
    const fetched = await Promise.all([...coords].slice(0, 40).map((c) => fetchByAddress(c)));
    const byId = await fetchByIds([...ids].slice(0, 20));
    const known = [...fetched.filter((e): e is Event => !!e), ...byId];
    const out = new Map<string, Event>();
    for (const item of known) {
      const parsed = parseAddress(eventAddress(item));
      if (parsed?.kind === KIND.SECTION || (parsed?.kind === KIND.PUBLICATION && !isTopLevel30040(item, known))) {
        const top = topLevelPublicationAddress(eventAddress(item), known);
        if (top) {
          const parent = known.find((e) => eventAddress(e) === top) ?? (await fetchByAddress(top));
          if (parent) {
            out.set(parent.id, parent);
            continue;
          }
        }
      }
      if (
        item.kind === KIND.PUBLICATION ||
        item.kind === KIND.WIKI ||
        item.kind === KIND.SPEC ||
        item.kind === KIND.LONG_FORM
      ) {
        out.set(item.id, item);
      }
    }
    return [...out.values()];
  }

  function applyProfileMeta(meta: Event | null): void {
    if (!meta) return;
    // untrack: this runs inside the profile $effect, which also writes these fields.
    // A tracked read would reschedule the effect until Svelte aborts it.
    const cur = untrack(() => profile);
    if (
      cur &&
      cur.id.toLowerCase() !== meta.id.toLowerCase() &&
      !isNewerReplaceable(meta, cur)
    ) {
      return;
    }
    profile = meta;
    rememberEvents([meta]);
    rememberProfileFromKind0(meta);
    void cachePutEvent(meta);
    const parsed = parseKind0(meta);
    const prevName = untrack(() => warmName);
    const prevPicture = untrack(() => warmPicture);
    warmName = parsed.title || prevName;
    warmPicture = parsed.picture || prevPicture;
    payments = paymentRows(parsed, [], meta);
  }

  function resetProfileListings(): void {
    produced = [];
    interacted = [];
    marksByWork = new Map();
    statusGeneral = null;
    statusMusic = null;
    payments = [];
    readCount = 0;
    readingEntries = [];
    readingTitles = new Map();
    readingEditions = new Map();
    producedPage = 1;
    interactedPage = 1;
    pageFilter = '';
  }

  const MARK_SET = new Set<string>(Object.keys(INTERACTION_MARK_LABELS));

  function applyPageSnapshot(snap: ProfilePageSnapshot): void {
    if (snap.profile) applyProfileMeta(snap.profile);
    produced = omitNested(snap.produced);
    interacted = snap.interacted;
    rememberEvents([...snap.produced, ...snap.interacted, ...snap.readingEditions]);
    const byWork = new Map<string, InteractionMark[]>();
    for (const [id, marks] of Object.entries(snap.marksByWork)) {
      byWork.set(
        id,
        marks.filter((m): m is InteractionMark => MARK_SET.has(m))
      );
    }
    marksByWork = byWork;
    const statuses = selectUserStatuses(snap.statusEvents);
    statusGeneral = statuses.general;
    statusMusic = statuses.music;
    const metaEv = snap.profile ?? untrack(() => profile);
    payments = paymentRows(parseKind0(metaEv), snap.paymentEvents, metaEv);
    readCount = snap.readCount;
    const ownLocal =
      !!get(session).pubkey &&
      get(session).pubkey!.toLowerCase() === snap.pubkey &&
      get(readingPrefs).localOnly;
    if (!ownLocal) {
      readingEntries = snap.readingEntries.map((e) => ({ ...e }));
      const titleMap = new Map<string, string>();
      const editionMap = new Map<string, Event>();
      for (const ed of snap.readingEditions) {
        const addr = eventAddress(ed);
        editionMap.set(addr, ed);
        titleMap.set(addr, editionMetadata(ed).titles[0] || 'Untitled');
      }
      readingTitles = titleMap;
      readingEditions = editionMap;
    }
  }

  /** Reload when the hash `/p/:id` or `/p/:id/:kind` changes — spa-router reuses this component. */
  $effect(() => {
    const raw = params.id ?? '';
    const kindRaw = params.kind;
    let cancelled = false;

    kindInvalid = false;
    resolveFailed = false;
    profilePathId = decodeProfileIdSegment(raw);

    if (kindRaw !== undefined) {
      const parsed = parseKindParam(kindRaw);
      if (parsed === null) {
        kindFilter = null;
        kindInvalid = true;
        pubkey = '';
        npub = '';
        profile = null;
        warmName = '';
        warmPicture = '';
        resolving = false;
        resetProfileListings();
        return;
      }
      kindFilter = parsed;
    } else {
      kindFilter = null;
    }

    const filterKind = kindFilter;
    pubkey = '';
    npub = '';
    profile = null;
    warmName = '';
    warmPicture = '';
    resetProfileListings();
    resolving = true;

    void (async () => {
      const nextPk = await resolveProfilePubkey(raw);
      if (cancelled) return;
      if (!nextPk || !/^[0-9a-f]{64}$/.test(nextPk)) {
        resolving = false;
        resolveFailed = true;
        return;
      }

      pubkey = nextPk;
      resolving = false;
      try {
        npub = nip19.npubEncode(nextPk);
      } catch {
        npub = nextPk;
      }

      // Prefer a verified NIP-05 in the path for shareable blog URLs.
      if (!profilePathId.includes('@')) {
        profilePathId = npub || nextPk;
      }

      // 1) Instant header from event-memory / badge thumb / session metadata.
      const warmMeta =
        memoryFindMetadata(nextPk) ??
        pickLatestReplaceable(session.getMetadata(), KIND.METADATA, nextPk);
      if (warmMeta) {
        applyProfileMeta(warmMeta);
      } else {
        const thumb = peekProfileThumb(nextPk);
        if (thumb) {
          warmName = thumb.name;
          warmPicture = thumb.picture;
        }
      }

      // 2) Medium-term page snapshot — paint listings before relays answer.
      const memSnap = peekProfilePageSnapshot(nextPk);
      if (memSnap) applyPageSnapshot(memSnap);

      const authoredKinds =
        filterKind != null
          ? [filterKind]
          : [KIND.PUBLICATION, KIND.WIKI, KIND.SPEC, KIND.LONG_FORM];
      const authoredFilter = {
        kinds: authoredKinds,
        authors: [nextPk],
        limit: 80
      };
      const creditedFilter = {
        kinds: [KIND.PUBLICATION, KIND.WIKI, KIND.SPEC, KIND.LONG_FORM],
        '#p': [nextPk],
        limit: 40
      };
      const paymentFilter = { kinds: [KIND.PAYMENT], authors: [nextPk], limit: 10 };
      const statusFilter = {
        kinds: [KIND.STATUS],
        authors: [nextPk],
        '#d': ['general', 'music'],
        limit: 10
      };

      let snap = memSnap;
      if (!snap) {
        snap = await cacheGetProfilePageSnapshot(nextPk);
        if (cancelled) return;
        if (snap) applyPageSnapshot(snap);
      }

      // 3) Kind-0 first, priority slot — do not wait on social/document fan-out.
      const kind0Hits = await relayPool.query(
        profileStack(),
        [{ kinds: [KIND.METADATA], authors: [nextPk], limit: 1 }],
        4000,
        5,
        undefined,
        { priority: true }
      );
      if (cancelled) return;
      const fresh =
        pickLatestReplaceable(kind0Hits, KIND.METADATA, nextPk) ?? kind0Hits[0] ?? null;
      if (fresh) applyProfileMeta(fresh);

      // Prefer nip05 from kind-0 for shareable paths when the URL used npub.
      if (fresh && !decodeProfileIdSegment(raw).includes('@')) {
        const nip = parseKind0(fresh).nip05List[0];
        if (nip) profilePathId = nip;
      }

      // Within TTL: keep the cached page; only kind-0 was refreshed above.
      // Kind-filtered views always re-query so arbitrary kinds are not missed.
      if (profilePageSnapshotFresh(snap) && filterKind == null) return;

      let statusEventsAcc: Event[] = snap?.statusEvents ?? [];
      let paymentEventsAcc: Event[] = snap?.paymentEvents ?? [];

      // 4) Everything else in parallel; paint as each group finishes.
      const docsP =
        filterKind != null
          ? (() => {
              const docKinds = [
                KIND.PUBLICATION,
                KIND.WIKI,
                KIND.SPEC,
                KIND.LONG_FORM,
                KIND.SECTION
              ];
              const relays = (docKinds as number[]).includes(filterKind)
                ? documentStack()
                : [...new Set([...socialStack(), ...documentStack()])];
              return relayPool
                .query(relays, [authoredFilter], 8000, 5, undefined, { priority: true })
                .then((authored) => {
                  if (cancelled) return;
                  const byId = new Map<string, Event>();
                  for (const e of untrack(() => produced)) {
                    if (e.kind === filterKind) byId.set(e.id, e);
                  }
                  for (const e of authored) byId.set(e.id, e);
                  produced = [...byId.values()];
                  rememberEvents(produced);
                });
            })()
          : Promise.all([
              relayPool.query(documentStack(), [authoredFilter], 8000, 5, undefined, {
                priority: true
              }),
              mercuryFilter(creditedFilter).then(async (m) =>
                m.length
                  ? m
                  : relayPool.query(documentStack(), [creditedFilter], 8000, 5, undefined, {
                      priority: true
                    })
              )
            ]).then(([authored, credited]) => {
              if (cancelled) return;
              const byId = new Map<string, Event>();
              for (const e of [...authored, ...credited]) byId.set(e.id, e);
              produced = omitNested([...byId.values()]);
              rememberEvents(produced);
            });

      const statusP = Promise.all([
        relayPool.query(socialStack(), [statusFilter], 5000, 4),
        relayPool.query(profileStack(), [statusFilter], 5000, 4)
      ]).then(([statusSocial, statusProfile]) => {
        if (cancelled) return;
        const statusById = new Map<string, Event>();
        for (const e of [...statusSocial, ...statusProfile]) statusById.set(e.id, e);
        statusEventsAcc = [...statusById.values()];
        const statuses = selectUserStatuses(statusEventsAcc);
        statusGeneral = statuses.general;
        statusMusic = statuses.music;
      });

      const payP = Promise.all([
        relayPool.query(socialStack(), [paymentFilter], 5000, 4),
        relayPool.query(profileStack(), [paymentFilter], 5000, 4)
      ]).then(([paySocial, payProfile]) => {
        if (cancelled) return;
        const payById = new Map<string, Event>();
        for (const e of [...paySocial, ...payProfile]) payById.set(e.id, e);
        paymentEventsAcc = [...payById.values()];
        payments = paymentRows(parseKind0(profile), paymentEventsAcc, profile);
      });

      const readsP =
        filterKind != null
          ? Promise.resolve()
          : countReadsByAuthor(nextPk).then((n) => {
              if (!cancelled) readCount = n;
            });

      const queueP =
        filterKind != null
          ? Promise.resolve()
          : relayPool
              .query(
                socialStack(),
                [{ kinds: [KIND.READING_QUEUE], authors: [nextPk], limit: 5 }],
                4000,
                2
              )
              .then(async (queueHits) => {
                if (cancelled) return;
                const queueEv = latestReplaceable(queueHits, KIND.READING_QUEUE);
                const own =
                  !!get(session).pubkey &&
                  get(session).pubkey!.toLowerCase() === nextPk.toLowerCase();
                readingEntries =
                  own && get(readingPrefs).localOnly
                    ? get(localReadingQueue)
                    : parseReadingQueue(queueEv);
                const titleMap = new Map<string, string>();
                const editionMap = new Map<string, Event>();
                const n = own ? get(readingPrefs).concurrent : READING_CONCURRENT_DEFAULT;
                await Promise.all(
                  activeReadingEntries(readingEntries, n).map(async (entry) => {
                    const pub = await fetchByAddress(entry.a);
                    if (cancelled || !pub) return;
                    rememberEvents([pub]);
                    editionMap.set(entry.a, pub);
                    titleMap.set(entry.a, editionMetadata(pub).titles[0] || 'Untitled');
                  })
                );
                if (cancelled) return;
                readingTitles = titleMap;
                readingEditions = editionMap;
              });

      const interactP =
        filterKind != null
          ? Promise.resolve()
          : Promise.all([
              relayPool.query(
                socialStack(),
                [{ kinds: [KIND.LABEL], authors: [nextPk], limit: 50 }],
                8000,
                4
              ),
              relayPool.query(
                socialStack(),
                [{ kinds: [KIND.BOOKMARK], authors: [nextPk], limit: 5 }],
                5000,
                4
              ),
              relayPool.query(
                documentStack(),
                [{ kinds: [KIND.DIRECTORY], authors: [nextPk], limit: 40 }],
                8000,
                4
              ),
              relayPool.query(
                socialStack(),
                [{ kinds: [KIND.HIGHLIGHT], authors: [nextPk], limit: 40 }],
                8000,
                4
              ),
              relayPool.query(
                socialStack(),
                [{ kinds: [KIND.COMMENT], authors: [nextPk], limit: 40 }],
                8000,
                4
              ),
              relayPool.query(
                socialStack(),
                [{ kinds: [KIND.RATING], authors: [nextPk], limit: 40 }],
                8000,
                4
              )
            ]).then(async ([labels, bookmarks, dirs, highs, comms, rates]) => {
              if (cancelled) return;
              const interactionEvents = [
                ...labels.filter(isListPublicationLabelEvent),
                ...bookmarks,
                ...dirs,
                ...highs,
                ...comms,
                ...rates
              ];
              const works = await resolveInteracted(interactionEvents);
              if (cancelled) return;
              interacted = works;
              rememberEvents(works);
              const markMap = interactionMarksFromEvents(interactionEvents);
              const byWork = new Map<string, InteractionMark[]>();
              for (const work of works) {
                byWork.set(work.id, marksForPublication(markMap, work));
              }
              marksByWork = byWork;
            });

      await Promise.allSettled([docsP, statusP, payP, readsP, queueP, interactP]);
      if (cancelled) return;

      // Kind-filtered views skip the full-page snapshot write (partial listings).
      if (filterKind != null) return;

      const marksObj: Record<string, string[]> = {};
      for (const [id, marks] of marksByWork) marksObj[id] = [...marks];
      void cachePutProfilePageSnapshot({
        pubkey: nextPk,
        savedAt: Date.now(),
        profile: untrack(() => profile),
        produced: untrack(() => produced),
        interacted: untrack(() => interacted),
        marksByWork: marksObj,
        statusEvents: statusEventsAcc,
        paymentEvents: paymentEventsAcc,
        readingEntries: untrack(() => readingEntries),
        readingEditions: [...untrack(() => readingEditions).values()],
        readCount: untrack(() => readCount)
      });
    })();

    return () => {
      cancelled = true;
    };
  });

  let shareCopied = $state(false);
  let shareTimer = 0;

  async function copyKindLink(): Promise<void> {
    if (kindFilter == null) return;
    const path = profileKindPath(profilePathId || npub || pubkey, kindFilter);
    const url = `${window.location.origin}/#${path}`;
    try {
      await navigator.clipboard.writeText(url);
      shareCopied = true;
      clearTimeout(shareTimer);
      shareTimer = window.setTimeout(() => {
        shareCopied = false;
      }, 2000);
    } catch {
      /* ignore */
    }
  }
</script>

<TopBar />
<main class="shell" class:profile-blog-shell={isBlogMode}>
  {#if kindInvalid}
    <ErrorPage title="Page not found" message="That is not a valid Nostr kind number." />
  {:else if resolveFailed}
    <ErrorPage title="Profile not found" message="This address could not be resolved to a pubkey." />
  {:else}
    <header class="page-header" class:profile-blog-page-header={isBlogMode}>
      <p class="page-kicker">{isBlogMode ? 'Blog' : 'Reader'}</p>
      <h1>
        {#if isBlogMode}
          {fields.title || warmName || 'Blog'}
        {:else if isKindFiltered}
          {kindHeading}
        {:else}
          Profile
        {/if}
      </h1>
    </header>
    {#if !isKindFiltered || isBlogMode}
      <div class="profile-filter-row">
        {#if !isKindFiltered}
          <PageFilter bind:value={pageFilter} />
        {:else}
          <span class="profile-filter-row-spacer" aria-hidden="true"></span>
        {/if}
        {#if profileShareId}
          {#if isBlogMode}
            <a class="btn profile-view-toggle" href={`#${fullProfilePath}`} use:link
              >View the full profile</a
            >
          {:else}
            <a class="btn profile-view-toggle" href={`#${blogPath}`} use:link>View the blog</a>
          {/if}
        {/if}
      </div>
    {/if}
    {#if resolving && !pubkey}
      <p class="loading-hint">Looking up profile…</p>
    {/if}
    {#if pubkey}
    <div class="card profile-card" class:profile-card-blog={isBlogMode} style="margin-bottom:1rem">
      <div class="profile-hero">
        {#if fields.banner && isAllowedHref(fields.banner)}
          <img class="profile-banner" src={toNostrBuildThumbUrl(fields.banner)} alt="" />
        {:else}
          <div
            class="profile-banner profile-banner-empty"
            style={profileBannerFallbackStyle(pubkey)}
            aria-hidden="true"
          ></div>
        {/if}
        {#if displayPicture && isAllowedHref(displayPicture)}
          <button
            type="button"
            class="profile-avatar profile-avatar-zoom"
            title="View profile picture"
            aria-label={`View profile picture of ${displayTitle}`}
            onclick={() =>
              openMediaViewer({
                url: displayPicture,
                title: displayTitle
              })}
          >
            <img src={toNostrBuildThumbUrl(displayPicture)} alt="" />
          </button>
        {/if}
      </div>
      <div class="profile-header">
        <div class="profile-header-text">
          <div class="profile-title-row">
            <h2>
              {#if isKindFiltered}
                <a class="profile-title-link" href={`#/p/${npub || pubkey}`} use:link>{displayTitle}</a>
              {:else}
                {displayTitle}
              {/if}
            </h2>
            {#if grapevineRank != null || viewerFollows || readCount > 0}
              <div class="profile-badges">
                {#if grapevineRank != null}
                  <span class="profile-badge profile-badge-rank" title="GrapeRank score">
                    GrapeRank {grapevineRank}
                  </span>
                {/if}
                {#if viewerFollows}
                  <span class="profile-badge profile-badge-following">Following</span>
                {/if}
                {#if readCount > 0 && npub && !isKindFiltered}
                  <a
                    class="profile-badge profile-read-link"
                    href={`#/search?read=${encodeURIComponent(npub)}`}
                    title={`${readCount} marked as read`}
                  >
                    <img class="profile-read-icon" src="/read-mark.png" alt="" aria-hidden="true" />
                    <span class="profile-read-count">{readCount}</span>
                  </a>
                {/if}
              </div>
            {/if}
          </div>
          <UserStatusBadge general={statusGeneral} music={statusMusic} />
          {#if fields.displayName && fields.name && fields.name !== fields.displayName}
            <p class="muted">{fields.name}</p>
          {/if}
          <p class="profile-npub muted">{npub || pubkey}</p>
        </div>
      </div>
      {#if fields.about}
        <div class="profile-about">
          {@html aboutHtml(fields.about)}
        </div>
      {/if}
      {#if fields.websites.length}
        <ul class="profile-tag-list">
          {#each fields.websites as url}
            {#if isAllowedHref(url)}
              <li><a href={url} rel="noopener noreferrer">{url}</a></li>
            {/if}
          {/each}
        </ul>
      {/if}
      {#if fields.nip05List.length}
        <ul class="profile-tag-list profile-nip05-list">
          {#each fields.nip05List as n}
            <li><Nip05Badge nip05={n} {pubkey} /></li>
          {/each}
        </ul>
      {/if}
      {#each Object.entries(fields.extra) as [key, value]}
        <p class="muted">{key}: {value}</p>
      {/each}
      {#each fields.extraTags as tag}
        <p class="muted">{tag.name}: {tag.value}</p>
      {/each}
      {#if payments.length}
        <h3>Payment targets</h3>
        <table class="profile-payments">
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Address</th>
            </tr>
          </thead>
          <tbody>
            {#each payments as row}
              <tr>
                <td>{paymentTypeLabel(row.type)}</td>
                <td>
                  <a href={row.href} rel="noopener noreferrer" title={row.label}>
                    {cropPaymentAddress(row.label)}
                  </a>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
    {#if !isKindFiltered && (profileActiveReading.length || readingEntries.length)}
      <section class="profile-reading" aria-label="Reading now">
        <h3 class="profile-reading-heading">
          Reading now
          <span class="muted profile-reading-counts">
            {profileActiveReading.length}
            {#if readingEntries.length > profileActiveReading.length}
              of {readingEntries.length} queued
            {/if}
          </span>
        </h3>
        {#if profileActiveReading.length}
          <ul class="profile-reading-list">
            {#each profileActiveReading as entry (entry.a)}
              {@const pct = readingProgressPercent(entry)}
              {@const edition = readingEditions.get(entry.a)}
              <li class="profile-reading-row">
                {#if edition}
                  <a class="profile-reading-title" href={`#${publicationPath(edition)}`} use:link>
                    {readingTitles.get(entry.a) || 'Untitled'}
                  </a>
                {:else}
                  <span class="profile-reading-title">{readingTitles.get(entry.a) || 'Loading…'}</span>
                {/if}
                <div
                  class="reading-progress"
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <span class="reading-progress-fill" style={`width:${pct}%`}></span>
                </div>
                <span class="muted profile-reading-pct">{pct}%</span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="muted">Queue has {readingEntries.length} waiting — none in the active set yet.</p>
        {/if}
      </section>
    {/if}
  {/if}

  {#if isBlogMode && pubkey}
    <section class="profile-blog" aria-label="Blog">
      <div class="profile-blog-toolbar">
        <h2 class="profile-blog-heading">Posts</h2>
        <button class="btn profile-blog-share" type="button" onclick={() => void copyKindLink()}>
          {shareCopied ? 'Link copied' : 'Copy blog link'}
        </button>
      </div>
      {#if visibleProduced.length}
        <ProfileBlogFeed events={pagedProduced} />
        <Pager page={producedPage} total={visibleProduced.length} {pageSize} onPage={(p) => (producedPage = p)} />
      {:else}
        <p class="muted profile-blog-empty">No long-form articles yet.</p>
      {/if}
    </section>
  {:else if isKindFiltered && pubkey}
    <section class="profile-kind-feed" aria-label={kindHeading}>
      <div class="profile-blog-toolbar">
        <h2 class="section-title" style="margin:0">{kindHeading}</h2>
        <button class="btn profile-blog-share" type="button" onclick={() => void copyKindLink()}>
          {shareCopied ? 'Link copied' : 'Copy link'}
        </button>
      </div>
      {#if visibleProduced.length}
        <div class="card-grid card-grid-results">
          {#each pagedProduced as event (event.id)}
            <EventCard {event} />
          {/each}
        </div>
        <Pager page={producedPage} total={visibleProduced.length} {pageSize} onPage={(p) => (producedPage = p)} />
      {:else}
        <p class="muted">Nothing of this kind yet.</p>
      {/if}
    </section>
  {:else}
    {#if visibleProduced.length || visibleInteracted.length}
      <div class="listing-toolbar listing-toolbar-section">
        <ListingViewToggle label="Profile listings" />
      </div>
    {/if}
    {#if $listingDensity === 'table'}
      {#if allProfileListings.length}
        <EventsTable events={allProfileListings} />
      {/if}
    {:else}
      {#if visibleProduced.length}
        <h2 class="section-title">Produced</h2>
        <div class="card-grid card-grid-results">
          {#each pagedProduced as event (event.id)}
            <EventCard {event} />
          {/each}
        </div>
        <Pager page={producedPage} total={visibleProduced.length} {pageSize} onPage={(p) => (producedPage = p)} />
      {/if}
      {#if visibleInteracted.length}
        <h2 class="section-title">Interacted with</h2>
        <div class="card-grid card-grid-results">
          {#each pagedInteracted as event (event.id)}
            <div class="interacted-card">
              <EventCard {event} />
              {#if marksByWork.get(event.id)?.length}
                <p class="interaction-marks muted">
                  {#each marksByWork.get(event.id) ?? [] as mark, i}
                    {#if i > 0}<span>·</span>{/if}
                    <span>{INTERACTION_MARK_LABELS[mark]}</span>
                  {/each}
                </p>
              {/if}
            </div>
          {/each}
        </div>
        <Pager page={interactedPage} total={visibleInteracted.length} {pageSize} onPage={(p) => (interactedPage = p)} />
      {/if}
    {/if}
  {/if}
  {/if}
</main>
