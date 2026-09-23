<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import EventCard from '$lib/components/EventCard.svelte';
  import Pager from '$lib/components/Pager.svelte';
  import PageFilter from '$lib/components/PageFilter.svelte';
  import ListingViewToggle from '$lib/components/ListingViewToggle.svelte';
  import EventsTable from '$lib/components/EventsTable.svelte';
  import { listingDensity } from '$lib/stores/listing-density';
  import { listingPageSize } from '$lib/listing-table';
  import { KIND } from '$lib/constants';
  import { relayPool } from '$lib/nostr/pool';
  import { documentStack, profileStack, socialStack } from '$lib/nostr/selector';
  import { firstTag, eventAddress, isTopLevel30040 } from '$lib/nostr/verify';
  import { toNostrBuildThumbUrl } from '$lib/nostr-build';
  import { countReadsByAuthor, hexPubkey } from '$lib/search';
  import { parseKind0, paymentRows, paymentTypeLabel, cropPaymentAddress, aboutHtml } from '$lib/profile-fields';
  import { selectUserStatuses, type UserStatus } from '$lib/nip38-user-status';
  import { muteState, filterMuted, followPubkeysFromMetadata } from '$lib/mute';
  import { filterPageEvents } from '$lib/page-filter';
  import { mercuryFilter } from '$lib/nostr/mercury';
  import { cachePutEvent } from '$lib/nostr/cache';
  import { rememberEvents, memoryFindMetadata } from '$lib/nostr/event-memory';
  import { rememberProfileFromKind0 } from '$lib/profile-cache';
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
  import { isAllowedHref } from '$lib/markup';
  import Nip05Badge from '$lib/components/Nip05Badge.svelte';
  import UserStatusBadge from '$lib/components/UserStatusBadge.svelte';
  import { session } from '$lib/stores/session';
  import { trustedAssertions } from '$lib/trusted-assertions';
  import { hasKnownRank } from '$lib/nip85-trusted-assertions';
  import { profileBannerFallbackStyle } from '$lib/profile-banner';

  interface Props {
    params?: { id?: string };
  }

  let { params = {} }: Props = $props();

  let pubkey = $state('');
  let npub = $state('');
  let profile = $state<Event | null>(null);
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

  const fields = $derived(parseKind0(profile));
  const pageSize = $derived(listingPageSize($listingDensity));
  const visibleProduced = $derived(filterPageEvents(filterMuted(produced, $muteState), pageFilter));
  const visibleInteracted = $derived(filterPageEvents(filterMuted(interacted, $muteState), pageFilter));
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
        item.kind === KIND.SPEC
      ) {
        out.set(item.id, item);
      }
    }
    return [...out.values()];
  }

  onMount(async () => {
    const raw = params.id ?? '';
    try {
      const decoded = nip19.decode(raw);
      if (decoded.type === 'npub') pubkey = decoded.data;
      else if (decoded.type === 'nprofile') pubkey = decoded.data.pubkey;
    } catch {
      pubkey = hexPubkey(raw) ?? raw;
    }
    if (!pubkey) return;
    try {
      npub = nip19.npubEncode(pubkey);
    } catch {
      npub = pubkey;
    }
    readCount = 0;

    // Badge / prior page already had kind-0 — paint header before relay round-trips.
    const warmMeta = memoryFindMetadata(pubkey);
    if (warmMeta) {
      profile = warmMeta;
      rememberProfileFromKind0(warmMeta);
    }

    const authoredFilter = {
      kinds: [KIND.PUBLICATION, KIND.WIKI, KIND.SPEC],
      authors: [pubkey],
      limit: 80
    };
    const creditedFilter = {
      kinds: [KIND.PUBLICATION, KIND.WIKI, KIND.SPEC],
      '#p': [pubkey],
      limit: 40
    };
    const paymentFilter = { kinds: [KIND.PAYMENT], authors: [pubkey], limit: 10 };
    const statusFilter = {
      kinds: [KIND.STATUS],
      authors: [pubkey],
      '#d': ['general', 'music'],
      limit: 10
    };
    const [p, authored, credited, statusSocial, statusProfile, paySocial, payProfile, labels, bookmarks, dirs, highs, comms, rates, reads] =
      await Promise.all([
        relayPool.query(profileStack(), [{ kinds: [0], authors: [pubkey], limit: 1 }]),
        relayPool.query(documentStack(), [authoredFilter]),
        mercuryFilter(creditedFilter).then(async (m) =>
          m.length ? m : relayPool.query(documentStack(), [creditedFilter])
        ),
        relayPool.query(socialStack(), [statusFilter]),
        relayPool.query(profileStack(), [statusFilter]),
        relayPool.query(socialStack(), [paymentFilter]),
        relayPool.query(profileStack(), [paymentFilter]),
        relayPool.query(socialStack(), [{ kinds: [KIND.LABEL], authors: [pubkey], limit: 50 }]),
        relayPool.query(socialStack(), [{ kinds: [KIND.BOOKMARK], authors: [pubkey], limit: 5 }]),
        relayPool.query(documentStack(), [{ kinds: [KIND.DIRECTORY], authors: [pubkey], limit: 40 }]),
        relayPool.query(socialStack(), [{ kinds: [KIND.HIGHLIGHT], authors: [pubkey], limit: 40 }]),
        relayPool.query(socialStack(), [{ kinds: [KIND.COMMENT], authors: [pubkey], limit: 40 }]),
        relayPool.query(socialStack(), [{ kinds: [KIND.RATING], authors: [pubkey], limit: 40 }]),
        countReadsByAuthor(pubkey)
      ]);
    profile = p[0] ?? profile;
    if (profile) {
      rememberEvents([profile]);
      rememberProfileFromKind0(profile);
      void cachePutEvent(profile);
    }
    const parsed = parseKind0(profile);
    const payById = new Map<string, Event>();
    for (const e of [...paySocial, ...payProfile]) payById.set(e.id, e);
    payments = paymentRows(parsed, [...payById.values()], profile);
    const statusById = new Map<string, Event>();
    for (const e of [...statusSocial, ...statusProfile]) statusById.set(e.id, e);
    const statuses = selectUserStatuses([...statusById.values()]);
    statusGeneral = statuses.general;
    statusMusic = statuses.music;
    const byId = new Map<string, Event>();
    for (const e of [...authored, ...credited]) byId.set(e.id, e);
    produced = omitNested([...byId.values()]);
    rememberEvents(produced);
    readCount = reads;
    const interactionEvents = [
      ...labels.filter(isListPublicationLabelEvent),
      ...bookmarks,
      ...dirs,
      ...highs,
      ...comms,
      ...rates
    ];
    const works = await resolveInteracted(interactionEvents);
    interacted = works;
    rememberEvents(works);
    const markMap = interactionMarksFromEvents(interactionEvents);
    const byWork = new Map<string, InteractionMark[]>();
    for (const work of works) {
      byWork.set(work.id, marksForPublication(markMap, work));
    }
    marksByWork = byWork;
  });
</script>

<TopBar />
<main class="shell">
  <h1>Profile</h1>
  <PageFilter bind:value={pageFilter} />
  {#if pubkey}
    <div class="card profile-card" style="margin-bottom:1rem">
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
        {#if fields.picture && isAllowedHref(fields.picture)}
          <img class="profile-avatar" src={toNostrBuildThumbUrl(fields.picture)} alt="" />
        {/if}
      </div>
      <div class="profile-header">
        <div class="profile-header-text">
          <div class="profile-title-row">
            <h2>{fields.title || 'Unknown'}</h2>
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
                {#if readCount > 0 && npub}
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
      <div
        class:card-grid={$listingDensity === 'full'}
        class:card-grid-results={$listingDensity === 'full'}
        class:listing-list={$listingDensity === 'list'}
      >
        {#each pagedProduced as event (event.id)}
          <EventCard {event} density={$listingDensity} />
        {/each}
      </div>
      <Pager page={producedPage} total={visibleProduced.length} {pageSize} onPage={(p) => (producedPage = p)} />
    {/if}
    {#if visibleInteracted.length}
      <h2 class="section-title">Interacted with</h2>
      <div
        class:card-grid={$listingDensity === 'full'}
        class:card-grid-results={$listingDensity === 'full'}
        class:listing-list={$listingDensity === 'list'}
      >
        {#each pagedInteracted as event (event.id)}
          <div class="interacted-card">
            <EventCard {event} density={$listingDensity} />
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
</main>
