<script lang="ts">
  import TopBar from '$lib/components/TopBar.svelte';
  import LoadingHint from '$lib/components/LoadingHint.svelte';
  import EventCard from '$lib/components/EventCard.svelte';
  import Pager from '$lib/components/Pager.svelte';
  import PageFilter from '$lib/components/PageFilter.svelte';
  import ListingViewToggle from '$lib/components/ListingViewToggle.svelte';
  import EventsTable from '$lib/components/EventsTable.svelte';
  import { listingDensity } from '$lib/stores/listing-density';
  import { listingPageSize } from '$lib/listing-table';
  import { KIND, READING_CONCURRENT_DEFAULT } from '$lib/constants';
  import { relayPool } from '$lib/nostr/pool';
  import { authorMailboxes, withPreferredRelays } from '$lib/nostr/mailboxes';
  import { documentStack, foreignRelaysAllowed, profileStack, socialStack } from '$lib/nostr/selector';
  import { firstTag, eventAddress, isTopLevel30040 } from '$lib/nostr/verify';
  import { toNostrBuildThumbUrl } from '$lib/nostr-build';
  import { countReadsByAuthor } from '$lib/search';
  import { cropRenderedUrl } from '$lib/crop-url';
  import { parseKind0, paymentRows, paymentTypeLabel, cropPaymentAddress, aboutHtml } from '$lib/profile-fields';
  import { selectUserStatuses, type UserStatus } from '$lib/nip38-user-status';
  import { muteState, filterMuted, followPubkeysFromMetadata, latestReplaceable } from '$lib/mute';
  import { deletionRevision, filterDeletedEvents } from '$lib/deletions';
  import { filterPageEvents } from '$lib/page-filter';
  import { mercuryFilter } from '$lib/nostr/mercury';
  import { cachePutEvent, cacheGetProfilePageSnapshot, cachePutProfilePageSnapshot, peekProfilePageSnapshot, profilePageSnapshotFresh, type ProfilePageSnapshot } from '$lib/nostr/cache';
  import { rememberEvents, memoryFindMetadata } from '$lib/nostr/event-memory';
  import { cachedIdentityEvent } from '$lib/nostr/identity-cache';
  import { peekProfileThumb, rememberProfileFromKind0 } from '$lib/profile-cache';
  import { pickLatestReplaceable, isNewerReplaceable, pruneToLatestReplaceables } from '$lib/nostr/replaceable';
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
  import GrapevineProfileStats from '$lib/components/GrapevineProfileStats.svelte';
  import { session } from '$lib/stores/session';
  import {
    activeReadingEntries,
    parseReadingQueue,
    readingProgressPercent,
    waitingReadingEntries,
    type ReadingQueueEntry
  } from '$lib/reading-queue';
  import { isPublicationRatingEvent, ratingAddress } from '$lib/ratings';
  import { readingPrefs } from '$lib/stores/reading-prefs';
  import { localReadingQueue } from '$lib/stores/local-reading-queue';
  import { editionMetadata } from '$lib/publication-metadata';
  import { publicationPath } from '$lib/metadata';
  import { link, push } from 'svelte-spa-router';
  import ErrorPage from '$lib/components/ErrorPage.svelte';
  import {
    parseKindParam,
    decodeProfileIdSegment,
    resolveProfilePubkey,
    profileKindHeading,
    profileKindPath
  } from '$lib/profile-route';
  import { feedAuthorRepliesPath } from '$lib/feed';
  import {
    PROFILE_PINBOARD_LIMIT,
    PROFILE_PINBOARD_OP_KINDS,
    composeProfilePinboardSlips,
    pickPinList,
    resolvePinnedNotes,
    samePinnedNoteIds
  } from '$lib/profile-pins';
  import PinSlip from '$lib/components/PinSlip.svelte';
  import Cover from '$lib/components/Cover.svelte';
  import CopyPointerButton from '$lib/components/CopyPointerButton.svelte';
  import { coverAuthor, coverTitle } from '$lib/cover-fallback';
  import { warmNavEvent } from '$lib/nav-warm';
  import { shelfWheel } from '$lib/shelf-wheel';

  interface Props {
    params?: { id?: string; kind?: string };
  }

  let { params = {} }: Props = $props();

  let pubkey = $state('');
  let npub = $state('');
  /** Path id as opened (npub or nip05) — used for shareable kind URLs. */
  let profilePathId = $state('');
  let kindFilter = $state<number | null>(null);
  /** Draft for the kind jump field (kept in sync when the route kind changes). */
  let kindDraft = $state('');
  let kindInvalid = $state(false);
  let resolveFailed = $state(false);
  let resolving = $state(false);
  let listingsLoading = $state(false);
  let profile = $state<Event | null>(null);
  /** Immediate paint from badge thumb cache when kind-0 is not yet in event-memory. */
  let warmName = $state('');
  let warmPicture = $state('');
  let produced = $state<Event[]>([]);
  let interacted = $state<Event[]>([]);
  let marksByWork = $state<Map<string, InteractionMark[]>>(new Map());
  let statusGeneral = $state<UserStatus | null>(null);
  let statusMusic = $state<UserStatus | null>(null);
  /** Kind 10133 payment events — kept across kind-0 refreshes so targets do not flash away. */
  let paymentEvents = $state<Event[]>([]);
  let pageFilter = $state('');
  let producedPage = $state(1);
  let interactedPage = $state(1);
  let viewerFollows = $state(false);
  let readCount = $state(0);
  let readingEntries = $state<ReadingQueueEntry[]>([]);
  let readingTitles = $state<Map<string, string>>(new Map());
  let readingEditions = $state<Map<string, Event>>(new Map());
  /** Newest publication ratings resolved to editions (desk fill). */
  let ratedEditions = $state<Event[]>([]);
  /** Profile pinboard slips (pins first, then latest OPs). */
  let pinboardSlips = $state<Event[]>([]);
  /** True when the board includes at least one kind-10001 pin. */
  let pinboardHasPins = $state(false);
  const pinboardHeading = $derived(pinboardHasPins ? 'Pinned' : 'Latest');

  /** Max covers on the profile reading desk. */
  const PROFILE_DESK_LIMIT = 12;

  type DeskItem = {
    source: 'reading' | 'queue' | 'rated';
    pub: Event;
    entry?: ReadingQueueEntry;
  };

  const fields = $derived(parseKind0(profile));
  const payments = $derived(paymentRows(fields, paymentEvents, profile));
  const hasProfileDetails = $derived(
    fields.websites.length > 0 ||
      fields.nip05List.length > 0 ||
      Object.keys(fields.extra).length > 0 ||
      fields.extraTags.length > 0 ||
      payments.length > 0
  );
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
  const isKindFiltered = $derived(kindFilter != null);
  const profileActiveReading = $derived(activeReadingEntries(readingEntries, concurrentLimit));
  const profileWaitingReading = $derived(waitingReadingEntries(readingEntries, concurrentLimit));
  const deskItems = $derived.by((): DeskItem[] => {
    const out: DeskItem[] = [];
    const seen = new Set<string>();
    const take = (item: DeskItem) => {
      const key = (eventAddress(item.pub) || item.pub.id).toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(item);
    };
    for (const entry of profileActiveReading) {
      const pub = readingEditions.get(entry.a);
      if (pub) take({ source: 'reading', pub, entry });
    }
    for (const entry of profileWaitingReading) {
      const pub = readingEditions.get(entry.a);
      if (pub) take({ source: 'queue', pub, entry });
    }
    for (const pub of ratedEditions) take({ source: 'rated', pub });
    return out.slice(0, PROFILE_DESK_LIMIT);
  });
  const showReadingDesk = $derived(!isKindFiltered && deskItems.length > 0);
  const isBlogMode = $derived(kindFilter === KIND.LONG_FORM);
  const kindHeading = $derived(kindFilter != null ? profileKindHeading(kindFilter) : '');
  const profileShareId = $derived(profilePathId || npub || pubkey);
  const blogPath = $derived(profileShareId ? profileKindPath(profileShareId, KIND.LONG_FORM) : '');
  const feedPath = $derived(pubkey ? feedAuthorRepliesPath(pubkey) : '');
  const fullProfilePath = $derived(profileShareId ? `/p/${profileShareId}` : '');
  const profileShareUrl = $derived.by(() => {
    if (!profileShareId || typeof window === 'undefined') return '';
    return `${window.location.origin}/#/p/${profileShareId}`;
  });

  $effect(() => {
    if (kindFilter != null) kindDraft = String(kindFilter);
  });

  function continueReadingHref(entry: ReadingQueueEntry, edition: Event): string {
    const base = `#${publicationPath(edition)}`;
    const q = new URLSearchParams();
    q.set('read', '1');
    const sid = (entry.sectionId ?? '').trim();
    if (sid) q.set('section', sid);
    if (Number.isFinite(entry.pos) && entry.pos >= 0) q.set('pos', String(Math.floor(entry.pos)));
    return `${base}?${q.toString()}`;
  }

  function submitKindJump(e: SubmitEvent): void {
    e.preventDefault();
    const parsed = parseKindParam(kindDraft.trim());
    if (parsed === null) return;
    const id = profileShareId;
    if (!id || parsed === kindFilter) return;
    void push(profileKindPath(id, parsed));
  }
  const filteredProduced = $derived.by(() => {
    $deletionRevision;
    let list = filterDeletedEvents(filterMuted(produced, $muteState));
    if (kindFilter != null) list = list.filter((e) => e.kind === kindFilter);
    return list;
  });
  const visibleProduced = $derived(filterPageEvents(filteredProduced, pageFilter));
  const visibleInteracted = $derived.by(() => {
    $deletionRevision;
    if (isKindFiltered) return [];
    return filterPageEvents(filterDeletedEvents(filterMuted(interacted, $muteState)), pageFilter);
  });
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

  /** Fill missing desk covers when the queue grows (local edits, late relay paint). */
  $effect(() => {
    const need = readingEntries
      .slice(0, PROFILE_DESK_LIMIT)
      .filter((entry) => !readingEditions.has(entry.a))
      .map((entry) => entry.a);
    if (!need.length) return;
    let cancelled = false;
    void (async () => {
      const editionMap = new Map(untrack(() => readingEditions));
      const titleMap = new Map(untrack(() => readingTitles));
      let changed = false;
      await Promise.all(
        need.map(async (addr) => {
          const pub = await fetchByAddress(addr);
          if (cancelled || !pub) return;
          rememberEvents([pub]);
          editionMap.set(addr, pub);
          titleMap.set(addr, editionMetadata(pub).titles[0] || 'Untitled');
          changed = true;
        })
      );
      if (cancelled || !changed) return;
      readingEditions = editionMap;
      readingTitles = titleMap;
    })();
    return () => {
      cancelled = true;
    };
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
    return pruneToLatestReplaceables([...out.values()]);
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
  }

  function resetProfileListings(): void {
    produced = [];
    interacted = [];
    marksByWork = new Map();
    statusGeneral = null;
    statusMusic = null;
    paymentEvents = [];
    readCount = 0;
    readingEntries = [];
    readingTitles = new Map();
    readingEditions = new Map();
    ratedEditions = [];
    pinboardSlips = [];
    pinboardHasPins = false;
    producedPage = 1;
    interactedPage = 1;
    pageFilter = '';
  }

  const MARK_SET = new Set<string>(Object.keys(INTERACTION_MARK_LABELS));

  function applyPageSnapshot(snap: ProfilePageSnapshot): void {
    if (snap.profile) applyProfileMeta(snap.profile);
    produced = omitNested(pruneToLatestReplaceables(snap.produced));
    interacted = pruneToLatestReplaceables(snap.interacted);
    if (kindFilter == null && (produced.length || interacted.length)) listingsLoading = false;
    rememberEvents([
      ...snap.produced,
      ...snap.interacted,
      ...snap.readingEditions,
      ...(snap.pinnedNotes ?? [])
    ]);
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
    const snapPayments = pruneToLatestReplaceables([...snap.paymentEvents]);
    if (snapPayments.length) paymentEvents = snapPayments;
    readCount = snap.readCount;
    if (snap.pinnedNotes?.length) {
      pinboardSlips = [...snap.pinnedNotes].slice(0, PROFILE_PINBOARD_LIMIT);
      pinboardHasPins = snap.pinboardHasPins === true;
    }
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
        listingsLoading = false;
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
    listingsLoading = false;

    void (async () => {
      const nextPk = await resolveProfilePubkey(raw);
      if (cancelled) return;
      if (!nextPk || !/^[0-9a-f]{64}$/.test(nextPk)) {
        resolving = false;
        listingsLoading = false;
        resolveFailed = true;
        return;
      }

      pubkey = nextPk;
      resolving = false;
      listingsLoading = true;
      try {
        npub = nip19.npubEncode(nextPk);
      } catch {
        npub = nextPk;
      }

      // Prefer a verified NIP-05 in the path for shareable kind URLs.
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
        const cachedMeta = cachedIdentityEvent(KIND.METADATA, nextPk);
        if (cachedMeta) applyProfileMeta(cachedMeta);
        else {
          const thumb = peekProfileThumb(nextPk);
          if (thumb) {
            warmName = thumb.name;
            warmPicture = thumb.picture;
          }
        }
      }
      const cachedPay = cachedIdentityEvent(KIND.PAYMENT, nextPk);
      if (cachedPay) paymentEvents = [cachedPay];

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

      // Their NIP-65 outbox, only when Outboxes is on. Otherwise stay on our relays and the viewer's.
      const mailboxesP = foreignRelaysAllowed()
        ? authorMailboxes(nextPk)
        : Promise.resolve({ inbox: [] as string[], outbox: [] as string[] });

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

      const loadPinboard = async (
        query: (
          base: string[],
          filters: Parameters<typeof relayPool.query>[1],
          timeout: number,
          baseMax: number
        ) => Promise<Event[]>
      ): Promise<boolean> => {
        if (filterKind != null) return false;
        try {
          // Prefer a dedicated kind-1 REQ — multi-kind author filters often under-fill on relays.
          const [pinHits, noteHits, otherHits] = await Promise.all([
            query(socialStack(), [{ kinds: [KIND.PIN], authors: [nextPk], limit: 5 }], 4000, 2),
            query(
              socialStack(),
              [{ kinds: [KIND.TEXT_NOTE], authors: [nextPk], limit: 40 }],
              5000,
              3
            ),
            query(
              socialStack(),
              [
                {
                  kinds: PROFILE_PINBOARD_OP_KINDS.filter((k) => k !== KIND.TEXT_NOTE),
                  authors: [nextPk],
                  limit: 20
                }
              ],
              4000,
              2
            )
          ]);
          if (cancelled) return false;
          const opHits = [...noteHits, ...otherHits];
          rememberEvents(opHits);
          const list = pickPinList(pinHits, nextPk);
          let pins: Event[] = [];
          if (list) {
            rememberEvents([list]);
            pins = await resolvePinnedNotes(list, { limit: PROFILE_PINBOARD_LIMIT });
            if (cancelled) return false;
          }
          // Always recompose — fill remaining slots with newest OPs (pins first).
          const board = composeProfilePinboardSlips(pins, opHits, PROFILE_PINBOARD_LIMIT);
          if (!board.slips.length) return false;
          const prev = untrack(() => pinboardSlips);
          const prevHas = untrack(() => pinboardHasPins);
          if (samePinnedNoteIds(prev, board.slips) && prevHas === board.hasPins) return false;
          pinboardSlips = board.slips;
          pinboardHasPins = board.hasPins;
          return true;
        } catch {
          return false;
        }
      };

      // Within TTL: keep the cached page; only kind-0 was refreshed above.
      // Kind-filtered views always re-query so arbitrary kinds are not missed.
      // Refresh the pinboard when empty or short of five slips (do not block paint).
      if (profilePageSnapshotFresh(snap) && filterKind == null) {
        listingsLoading = false;
        const boardShort = (snap?.pinnedNotes?.length ?? 0) < PROFILE_PINBOARD_LIMIT;
        if (boardShort) {
          void loadPinboard((base, filters, timeout, baseMax) =>
            relayPool.query(base, filters, timeout, baseMax)
          ).then((changed) => {
            if (cancelled || !changed || !snap) return;
            void cachePutProfilePageSnapshot({
              ...snap,
              pinnedNotes: untrack(() => pinboardSlips),
              pinboardHasPins: untrack(() => pinboardHasPins)
            });
          });
        }
        return;
      }

      const authorOutbox = (await mailboxesP).outbox;
      if (cancelled) return;
      if (!fresh && authorOutbox.length) {
        const fromOutbox = await relayPool.query(
          authorOutbox,
          [{ kinds: [KIND.METADATA], authors: [nextPk], limit: 1 }],
          4000,
          Math.min(authorOutbox.length, 4),
          undefined,
          { priority: true }
        );
        if (cancelled) return;
        const meta = pickLatestReplaceable(fromOutbox, KIND.METADATA, nextPk);
        if (meta) applyProfileMeta(meta);
      }

      const queryAuthored = (
        base: string[],
        filters: Parameters<typeof relayPool.query>[1],
        timeout: number,
        baseMax: number,
        opts?: { priority?: boolean }
      ) => {
        const scope = withPreferredRelays(base, authorOutbox, baseMax);
        return relayPool.query(scope.relays, filters, timeout, scope.maxRelays, undefined, opts);
      };

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
              return queryAuthored(relays, [authoredFilter], 8000, 5, { priority: true }).then(
                (authored) => {
                  if (cancelled) return;
                  const byId = new Map<string, Event>();
                  for (const e of untrack(() => produced)) {
                    if (e.kind === filterKind) byId.set(e.id, e);
                  }
                  for (const e of authored) byId.set(e.id, e);
                  produced = pruneToLatestReplaceables([...byId.values()]);
                  rememberEvents(produced);
                }
              );
            })()
          : Promise.all([
              queryAuthored(documentStack(), [authoredFilter], 8000, 5, { priority: true }),
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
              produced = omitNested(pruneToLatestReplaceables([...byId.values()]));
              rememberEvents(produced);
            });

      const statusP = Promise.all([
        queryAuthored(socialStack(), [statusFilter], 5000, 4),
        queryAuthored(profileStack(), [statusFilter], 5000, 4)
      ]).then(([statusSocial, statusProfile]) => {
        if (cancelled) return;
        const statusById = new Map<string, Event>();
        for (const e of [...statusSocial, ...statusProfile]) statusById.set(e.id, e);
        statusEventsAcc = pruneToLatestReplaceables([...statusById.values()]);
        const statuses = selectUserStatuses(statusEventsAcc);
        statusGeneral = statuses.general;
        statusMusic = statuses.music;
      });

      const payP = Promise.all([
        queryAuthored(socialStack(), [paymentFilter], 5000, 4),
        queryAuthored(profileStack(), [paymentFilter], 5000, 4)
      ]).then(([paySocial, payProfile]) => {
        if (cancelled) return;
        const payById = new Map<string, Event>();
        for (const e of untrack(() => paymentEvents)) payById.set(e.id, e);
        for (const e of [...paySocial, ...payProfile]) payById.set(e.id, e);
        paymentEventsAcc = pruneToLatestReplaceables([...payById.values()]);
        paymentEvents = paymentEventsAcc;
        for (const event of paymentEventsAcc) void cachePutEvent(event);
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
          : queryAuthored(
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
                const deskEntries = readingEntries.slice(0, PROFILE_DESK_LIMIT);
                await Promise.all(
                  deskEntries.map(async (entry) => {
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
              queryAuthored(socialStack(), [{ kinds: [KIND.LABEL], authors: [nextPk], limit: 50 }], 8000, 4),
              queryAuthored(socialStack(), [{ kinds: [KIND.BOOKMARK], authors: [nextPk], limit: 5 }], 5000, 4),
              queryAuthored(
                documentStack(),
                [{ kinds: [KIND.DIRECTORY], authors: [nextPk], limit: 40 }],
                8000,
                4
              ),
              queryAuthored(
                socialStack(),
                [{ kinds: [KIND.HIGHLIGHT], authors: [nextPk], limit: 40 }],
                8000,
                4
              ),
              queryAuthored(socialStack(), [{ kinds: [KIND.COMMENT], authors: [nextPk], limit: 40 }], 8000, 4),
              queryAuthored(socialStack(), [{ kinds: [KIND.RATING], authors: [nextPk], limit: 40 }], 8000, 4)
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

              const ratedCoords: string[] = [];
              const seenRated = new Set<string>();
              const sortedRates = [...rates]
                .filter(isPublicationRatingEvent)
                .sort((a, b) => b.created_at - a.created_at);
              for (const rate of sortedRates) {
                const coord = ratingAddress(rate);
                if (!coord) continue;
                const key = coord.toLowerCase();
                if (seenRated.has(key)) continue;
                seenRated.add(key);
                ratedCoords.push(coord);
                if (ratedCoords.length >= PROFILE_DESK_LIMIT) break;
              }
              const ratedHits = await Promise.all(
                ratedCoords.map((coord) => fetchByAddress(coord))
              );
              if (cancelled) return;
              const ratedPubs = ratedHits.filter((e): e is Event => !!e);
              rememberEvents(ratedPubs);
              ratedEditions = ratedPubs;
            });

      const pinboardP = loadPinboard((base, filters, timeout, baseMax) =>
        queryAuthored(base, filters, timeout, baseMax)
      );

      await Promise.allSettled([docsP, statusP, payP, readsP, queueP, interactP, pinboardP]);
      if (cancelled) return;
      listingsLoading = false;

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
        pinnedNotes: untrack(() => pinboardSlips),
        pinboardHasPins: untrack(() => pinboardHasPins),
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
<main class="shell profile-page" class:profile-page-compact={!showReadingDesk && !isKindFiltered}>
  {#if kindInvalid}
    <ErrorPage title="Page not found" message="That is not a valid Nostr kind number." />
  {:else if resolveFailed}
    <ErrorPage title="Profile not found" message="This address could not be resolved to a pubkey." />
  {:else}
    {#if isKindFiltered}
      <header class="page-header">
        <p class="page-kicker">Kind</p>
        <h1>{kindHeading}</h1>
        <form class="profile-kind-jump" onsubmit={submitKindJump}>
          <label class="profile-kind-jump-label" for="profile-kind-input">Kind</label>
          <input
            id="profile-kind-input"
            class="profile-kind-jump-input"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            spellcheck="false"
            bind:value={kindDraft}
            aria-label="Kind number"
          />
          <button
            type="submit"
            class="btn btn-icon profile-kind-jump-go"
            title="Show this kind"
            aria-label="Show this kind"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="6.5"></circle>
              <path d="M16.5 16.5 21 21"></path>
            </svg>
          </button>
        </form>
      </header>
    {/if}
    {#if isBlogMode}
      <div class="profile-filter-row">
        <span class="profile-filter-row-spacer" aria-hidden="true"></span>
        {#if profileShareId}
          <div class="profile-view-toggles">
            <a class="btn profile-view-toggle" href={`#${fullProfilePath}`} use:link
              >View the full profile</a
            >
          </div>
        {/if}
      </div>
    {/if}
    {#if resolving && !pubkey}
      <LoadingHint message="Looking up profile…" />
    {/if}
    {#if pubkey}
    <div class="card profile-card">
      <div class="profile-card-topbar">
        <p class="page-kicker profile-card-kicker">Reader profile</p>
      </div>
      <div class="profile-identity">
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
        <div class="profile-header-text">
          <div class="profile-title-row">
            <h2>
              {#if isKindFiltered}
                <a class="profile-title-link" href={`#/p/${npub || pubkey}`} use:link>{displayTitle}</a>
              {:else}
                {displayTitle}
              {/if}
            </h2>
            {#if viewerFollows || readCount > 0}
              <div class="profile-badges">
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
          {#if fields.displayName && fields.name && fields.name !== fields.displayName}
            <p class="muted profile-name-line">{fields.name}</p>
          {/if}
          {#if fields.about}
            <div class="profile-about">
              {@html aboutHtml(fields.about)}
            </div>
          {/if}
        </div>
        {#if !isKindFiltered && (feedPath || blogPath || isOwnProfile)}
          <nav class="profile-side-actions" aria-label="Profile links">
            {#if feedPath}
              <a class="btn profile-card-action" href={`#${feedPath}`} use:link>View feed</a>
            {/if}
            {#if blogPath}
              <a class="btn profile-card-action" href={`#${blogPath}`} use:link>View blog</a>
            {/if}
            {#if isOwnProfile}
              <a class="btn profile-card-action" href="#/compose?kind=0" use:link>Edit profile</a>
            {/if}
          </nav>
        {/if}
      </div>
      <UserStatusBadge general={statusGeneral} music={statusMusic} />
      <div class="details-panel-wrap profile-details-wrap">
        {#if profile}
          <div class="details-toolbar">
            <CopyPointerButton
              event={profile}
              class="details-more-menu"
              shareUrl={profileShareUrl}
            />
          </div>
        {/if}
        <details class="accordion details-panel profile-details">
          <summary>Details</summary>
          {#if pubkey}
            <GrapevineProfileStats {pubkey} />
          {/if}
          {#if hasProfileDetails}
            {#if fields.websites.length}
              <ul class="profile-tag-list">
                {#each fields.websites as url}
                  {#if isAllowedHref(url)}
                    <li><a href={url} rel="noopener noreferrer" title={url}>{cropRenderedUrl(url)}</a></li>
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
              <p class="muted profile-detail-rich">{key}: {@html aboutHtml(value)}</p>
            {/each}
            {#each fields.extraTags as tag}
              <p class="muted profile-detail-rich">{tag.name}: {@html aboutHtml(tag.value)}</p>
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
                          {row.label.startsWith('http://') ||
                          row.label.startsWith('https://') ||
                          row.label.startsWith('ws://') ||
                          row.label.startsWith('wss://')
                            ? cropRenderedUrl(row.label)
                            : cropPaymentAddress(row.label)}
                        </a>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
          {:else}
            <p class="muted">No websites, NIP-05, or payment targets listed.</p>
          {/if}
        </details>
      </div>
    </div>
    {#if showReadingDesk}
      <section class="landing-shelf profile-reading-desk" aria-label="Reading desk">
        <div class="shelf-heading profile-desk-heading">
          <p class="page-kicker profile-desk-kicker">Currently reading</p>
          <h2 class="section-title profile-desk-title">On the reading desk</h2>
        </div>
        <div class="shelf-track" use:shelfWheel>
          <div class="shelf-bar">
            {#each deskItems as item (item.pub.id)}
              {@const tipTitle = coverTitle(item.pub)}
              {@const tipAuthor = coverAuthor(item.pub)}
              {@const tip = tipAuthor ? `${tipTitle} — ${tipAuthor}` : tipTitle}
              {@const pct = item.entry ? readingProgressPercent(item.entry) : 0}
              {@const href =
                item.entry && item.source === 'reading'
                  ? continueReadingHref(item.entry, item.pub)
                  : `#${publicationPath(item.pub)}`}
              {@const label =
                item.source === 'reading'
                  ? `${tip} — ${pct}% read`
                  : item.source === 'queue'
                    ? `${tip} — queued`
                    : `${tip} — rated`}
              <a
                class="cover"
                {href}
                use:link
                title={label}
                aria-label={label}
                onpointerdown={() => warmNavEvent(item.pub)}
                onclick={() => warmNavEvent(item.pub)}
              >
                <Cover event={item.pub} />
              </a>
            {/each}
          </div>
        </div>
      </section>
    {/if}
    {#if !isKindFiltered && pinboardSlips.length}
      <section class="profile-pinboard" aria-label={pinboardHeading}>
        <h3 class="profile-reading-heading">{pinboardHeading}</h3>
        <div class="profile-pinboard-board">
          {#each pinboardSlips as event, i (event.id)}
            <PinSlip {event} hero={i === 0} />
          {/each}
        </div>
      </section>
    {/if}
    {#if !isKindFiltered}
      <div class="profile-filter-row profile-filter-row-after-card">
        <PageFilter bind:value={pageFilter} />
      </div>
    {/if}
  {/if}

  {#if isKindFiltered && pubkey}
    <section class="profile-kind-feed" aria-label={kindHeading}>
      <div class="profile-kind-toolbar">
        <h2 class="section-title" style="margin:0">{kindHeading}</h2>
        <button class="btn profile-kind-share" type="button" onclick={() => void copyKindLink()}>
          {shareCopied ? 'Link copied' : 'Copy link'}
        </button>
      </div>
      {#if listingsLoading && !visibleProduced.length}
        <LoadingHint message="Loading publications…" />
      {:else if visibleProduced.length}
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
    {#if pubkey && listingsLoading && !visibleProduced.length && !visibleInteracted.length}
      <LoadingHint message="Loading publications…" />
    {/if}
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
