<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import UserBadge from '$lib/components/UserBadge.svelte';
  import EventCard from '$lib/components/EventCard.svelte';
  import Pager from '$lib/components/Pager.svelte';
  import PageFilter from '$lib/components/PageFilter.svelte';
  import { KIND } from '$lib/constants';
  import { relayPool } from '$lib/nostr/pool';
  import { documentStack, socialStack } from '$lib/nostr/selector';
  import { firstTag, eventAddress, isTopLevel30040 } from '$lib/nostr/verify';
  import { toNostrBuildThumbUrl } from '$lib/nostr-build';
  import { hexPubkey } from '$lib/search';
  import { parseKind0, paymentRows, activeStatus } from '$lib/profile-fields';
  import { muteState, filterMuted } from '$lib/mute';
  import { filterPageEvents } from '$lib/page-filter';
  import { mercuryFilter } from '$lib/nostr/mercury';
  import { fetchByAddress, fetchByIds } from '$lib/nostr/fetch';
  import { publicationTargets, isPublicationLabelEvent } from '$lib/nip32';
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

  interface Props {
    params?: { id?: string };
  }

  let { params = {} }: Props = $props();

  let pubkey = $state('');
  let profile = $state<Event | null>(null);
  let produced = $state<Event[]>([]);
  let interacted = $state<Event[]>([]);
  let marksByWork = $state<Map<string, InteractionMark[]>>(new Map());
  let status = $state<Event | null>(null);
  let payments = $state<ReturnType<typeof paymentRows>>([]);
  let pageFilter = $state('');
  let extraJson = $state<Record<string, string>>({});
  let producedPage = $state(1);
  let interactedPage = $state(1);
  const pageSize = 25;

  const fields = $derived(parseKind0(profile));
  const visibleProduced = $derived(filterPageEvents(filterMuted(produced, $muteState), pageFilter));
  const visibleInteracted = $derived(filterPageEvents(filterMuted(interacted, $muteState), pageFilter));
  const pagedProduced = $derived(visibleProduced.slice((producedPage - 1) * pageSize, producedPage * pageSize));
  const pagedInteracted = $derived(
    visibleInteracted.slice((interactedPage - 1) * pageSize, interactedPage * pageSize)
  );

  $effect(() => {
    pageFilter;
    producedPage = 1;
    interactedPage = 1;
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
    const [p, authored, credited, statusEv, payEv, labels, bookmarks, dirs, highs, comms, rates] =
      await Promise.all([
        relayPool.query(socialStack(), [{ kinds: [0], authors: [pubkey], limit: 1 }]),
        relayPool.query(documentStack(), [authoredFilter]),
        mercuryFilter(creditedFilter).then(async (m) =>
          m.length ? m : relayPool.query(documentStack(), [creditedFilter])
        ),
        relayPool.query(socialStack(), [{ kinds: [KIND.STATUS], authors: [pubkey], limit: 10 }]),
        relayPool.query(socialStack(), [{ kinds: [KIND.PAYMENT], authors: [pubkey], limit: 10 }]),
        relayPool.query(socialStack(), [{ kinds: [KIND.LABEL], authors: [pubkey], limit: 50 }]),
        relayPool.query(socialStack(), [{ kinds: [KIND.BOOKMARK], authors: [pubkey], limit: 5 }]),
        relayPool.query(documentStack(), [{ kinds: [KIND.DIRECTORY], authors: [pubkey], limit: 40 }]),
        relayPool.query(socialStack(), [{ kinds: [KIND.HIGHLIGHT], authors: [pubkey], limit: 40 }]),
        relayPool.query(socialStack(), [{ kinds: [KIND.COMMENT], authors: [pubkey], limit: 40 }]),
        relayPool.query(socialStack(), [{ kinds: [KIND.RATING], authors: [pubkey], limit: 40 }])
      ]);
    profile = p[0] ?? null;
    const parsed = parseKind0(profile);
    extraJson = parsed.extra;
    payments = paymentRows(parsed, payEv);
    status = activeStatus(statusEv);
    const byId = new Map<string, Event>();
    for (const e of [...authored, ...credited]) byId.set(e.id, e);
    produced = omitNested([...byId.values()]);
    const interactionEvents = [
      ...labels.filter(isPublicationLabelEvent),
      ...bookmarks,
      ...dirs,
      ...highs,
      ...comms,
      ...rates
    ];
    const works = await resolveInteracted(interactionEvents);
    interacted = works;
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
    <div class="card" style="margin-bottom:1rem">
      {#if fields.banner && isAllowedHref(fields.banner)}
        <img class="profile-banner" src={toNostrBuildThumbUrl(fields.banner)} alt="" />
      {/if}
      {#if fields.picture}
        <img src={toNostrBuildThumbUrl(fields.picture)} alt="" style="width:4rem;height:4rem;border-radius:999px" />
      {/if}
      <h2>{fields.displayName || fields.name || 'Unknown'}</h2>
      {#if fields.displayName && fields.name && fields.name !== fields.displayName}
        <p class="muted">{fields.name}</p>
      {/if}
      {#if fields.about}<p class="muted">{fields.about}</p>{/if}
      {#if fields.website && isAllowedHref(fields.website)}
        <p><a href={fields.website} rel="noopener noreferrer">{fields.website}</a></p>
      {/if}
      {#if fields.nip05}<p class="muted">{fields.nip05}</p>{/if}
      <p><UserBadge {pubkey} /></p>
      {#each Object.entries(extraJson) as [key, value]}
        <p class="muted">{key}: {value}</p>
      {/each}
      {#if status}
        <p>
          Status: {status.content}
          {#if firstTag(status, 'r') && isAllowedHref(firstTag(status, 'r')!)}
            <a href={firstTag(status, 'r')} rel="noopener noreferrer">link</a>
          {/if}
        </p>
      {/if}
      {#if payments.length}
        <h3>Payments</h3>
        <ul>
          {#each payments as row}
            <li><a href={row.href} rel="noopener noreferrer">{row.label}</a></li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
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
</main>
