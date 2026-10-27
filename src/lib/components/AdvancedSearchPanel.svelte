<script lang="ts">
  import { push } from 'svelte-spa-router';
  import type { Filter } from 'nostr-tools';
  import {
    ADVANCED_SEARCH_MAX_LIMIT,
    clampAdvancedLimit,
    datetimeLocalToUnix,
    defaultAdvancedSearchRelays,
    encodeAdvancedSearch,
    inferAdvancedSearchMode,
    parseKindsInput,
    unixToDatetimeLocal,
    type AdvancedSearchMode,
    type AdvancedSearchRequest,
    type MercurySearchFields
  } from '$lib/advanced-search';
  import { hexPubkey } from '$lib/metadata';
  import { parseEventIdToken } from '$lib/advanced-search';
  import { validateRelaysInput } from '$lib/search-pointer';
  import StringListRows from './StringListRows.svelte';
  import ComposeEventTagRows from './ComposeEventTagRows.svelte';

  interface Props {
    /** When set, accordion opens and fields hydrate from this request. */
    initial?: AdvancedSearchRequest | null;
    open?: boolean;
  }

  let { initial = null, open = false }: Props = $props();

  let detailsOpen = $state(false);
  let mode = $state<AdvancedSearchMode>('relays');
  let kinds = $state<string[]>(['']);
  let authors = $state<string[]>(['']);
  let ids = $state<string[]>(['']);
  let search = $state('');
  let sinceLocal = $state('');
  let untilLocal = $state('');
  let limit = $state(ADVANCED_SEARCH_MAX_LIMIT);
  let tagE = $state<string[]>(['']);
  let tagP = $state<string[]>(['']);
  let tagD = $state<string[]>(['']);
  let tagH = $state<string[]>(['']);
  let tagA = $state<string[]>(['']);
  let tagT = $state<string[]>(['']);
  let tagTT = $state<string[]>(['']);
  let tagK = $state<string[]>(['']);
  let extraTags = $state<string[][]>([['', '']]);
  let mercuryQ = $state('');
  let mercuryTitle = $state('');
  let mercuryAuthor = $state('');
  let mercuryLanguage = $state('');
  let mercurySubject = $state('');
  let mercuryD = $state('');
  let mercuryIdentifier = $state('');
  let mercuryLimit = $state(ADVANCED_SEARCH_MAX_LIMIT);
  let relays = $state<string[]>(['']);
  let relaysDirty = $state(false);
  let error = $state('');

  function asRows(values: string[] | undefined): string[] {
    return values?.length ? [...values] : [''];
  }

  function cleaned(rows: string[]): string[] {
    return rows.map((s) => s.trim()).filter(Boolean);
  }

  function currentKindsFilter(): Filter {
    const ks = parseKindsInput(cleaned(kinds).join(','));
    return ks.length ? { kinds: ks } : {};
  }

  function syncDefaultRelays(): void {
    if (relaysDirty) return;
    const next = defaultAdvancedSearchRelays(currentKindsFilter());
    relays = next.length ? [...next] : [''];
  }

  function resetRelayFields(): void {
    kinds = [''];
    authors = [''];
    ids = [''];
    search = '';
    sinceLocal = '';
    untilLocal = '';
    limit = ADVANCED_SEARCH_MAX_LIMIT;
    tagE = tagP = tagD = tagH = tagA = tagT = tagTT = tagK = [''];
    extraTags = [['', '']];
    relaysDirty = false;
    syncDefaultRelays();
  }

  function resetMercuryFields(): void {
    mercuryQ = mercuryTitle = mercuryAuthor = mercuryLanguage = '';
    mercurySubject = mercuryD = mercuryIdentifier = '';
    mercuryLimit = ADVANCED_SEARCH_MAX_LIMIT;
  }

  function hydrate(req: AdvancedSearchRequest | null): void {
    if (!req) {
      mode = 'relays';
      resetRelayFields();
      resetMercuryFields();
      return;
    }
    mode = inferAdvancedSearchMode(req);
    const f = req.filter ?? {};
    kinds = asRows((f.kinds ?? []).map(String));
    authors = asRows(f.authors);
    ids = asRows(f.ids);
    search = f.search ?? '';
    sinceLocal = unixToDatetimeLocal(f.since);
    untilLocal = unixToDatetimeLocal(f.until);
    limit = clampAdvancedLimit(f.limit ?? ADVANCED_SEARCH_MAX_LIMIT);
    mercuryLimit = clampAdvancedLimit(f.limit ?? ADVANCED_SEARCH_MAX_LIMIT);
    const tags = f as Record<string, string[] | undefined>;
    tagE = asRows(tags['#e']);
    tagP = asRows(tags['#p']);
    tagD = asRows(tags['#d']);
    tagH = asRows(tags['#h']);
    tagA = asRows(tags['#a']);
    tagT = asRows(tags['#t']);
    tagTT = asRows(tags['#T']);
    tagK = asRows(tags['#k']);
    const known = new Set(['#e', '#p', '#d', '#h', '#a', '#t', '#T', '#k']);
    const extras: string[][] = [];
    for (const [key, values] of Object.entries(tags)) {
      if (!key.startsWith('#') || known.has(key) || !Array.isArray(values)) continue;
      const name = key.slice(1);
      for (const value of values) extras.push([name, value]);
    }
    extraTags = extras.length ? extras : [['', '']];
    const m = req.mercury ?? {};
    mercuryQ = m.q ?? '';
    mercuryTitle = m.title ?? '';
    mercuryAuthor = m.author ?? '';
    mercuryLanguage = m.language ?? '';
    mercurySubject = m.subject ?? '';
    mercuryD = m.d ?? '';
    mercuryIdentifier = m.identifier ?? '';
    relays = asRows(req.relays?.length ? req.relays : defaultAdvancedSearchRelays(f));
    relaysDirty = true;
  }

  $effect(() => {
    void open;
    void initial;
    detailsOpen = open || Boolean(initial);
    if (initial) hydrate(initial);
    else if (!relaysDirty) syncDefaultRelays();
  });

  $effect(() => {
    void kinds;
    if (mode === 'relays' && !relaysDirty) syncDefaultRelays();
  });

  function setMode(next: AdvancedSearchMode): void {
    mode = next;
    error = '';
    if (next === 'relays' && !relaysDirty) syncDefaultRelays();
  }

  function buildRelayRequest(): AdvancedSearchRequest | null {
    const filter: Filter = {};
    const ks = parseKindsInput(cleaned(kinds).join(','));
    if (ks.length) filter.kinds = ks;

    const authorParts = cleaned(authors);
    if (authorParts.length) filter.authors = authorParts;

    const idParts = cleaned(ids)
      .map((p) => parseEventIdToken(p))
      .filter((x): x is string => !!x);
    if (idParts.length) filter.ids = idParts;

    if (search.trim()) filter.search = search.trim();
    const since = datetimeLocalToUnix(sinceLocal);
    const until = datetimeLocalToUnix(untilLocal);
    if (since != null) filter.since = since;
    if (until != null) filter.until = until;
    filter.limit = clampAdvancedLimit(limit);

    const putTag = (name: string, rows: string[]) => {
      const values = cleaned(rows);
      if (!values.length) return;
      (filter as Record<string, string[]>)[`#${name}`] = values.map((v) => {
        if (name === 'e') return parseEventIdToken(v) ?? v;
        if (name === 'p') return hexPubkey(v) ?? v;
        return v;
      });
    };
    putTag('e', tagE);
    putTag('p', tagP);
    putTag('d', tagD);
    putTag('h', tagH);
    putTag('a', tagA);
    putTag('t', tagT);
    putTag('T', tagTT);
    putTag('k', tagK);

    for (const row of extraTags) {
      const name = (row[0] ?? '').trim().replace(/^#/, '');
      const value = (row[1] ?? '').trim();
      if (!name || !value) continue;
      if (!/^[a-zA-Z0-9_]+$/.test(name)) {
        error = `Invalid tag name “${name}”`;
        return null;
      }
      const key = `#${name}`;
      const list = ((filter as Record<string, string[]>)[key] ??= []);
      list.push(value);
    }

    const relayCheck = validateRelaysInput(cleaned(relays).join('\n'));
    if (!relayCheck.ok) {
      error = relayCheck.error;
      return null;
    }
    if (!relayCheck.value.length) {
      error = 'Add at least one relay';
      return null;
    }

    const hasFilter =
      !!filter.kinds?.length ||
      !!filter.authors?.length ||
      !!filter.ids?.length ||
      !!filter.search ||
      filter.since != null ||
      filter.until != null ||
      Object.keys(filter).some((k) => k.startsWith('#'));
    if (!hasFilter) {
      error = 'Set at least one filter field';
      return null;
    }

    return { filter, relays: relayCheck.value };
  }

  function buildMercuryRequest(): AdvancedSearchRequest | null {
    const mercury: MercurySearchFields = {};
    if (mercuryQ.trim()) mercury.q = mercuryQ.trim();
    if (mercuryTitle.trim()) mercury.title = mercuryTitle.trim();
    if (mercuryAuthor.trim()) mercury.author = mercuryAuthor.trim();
    if (mercuryLanguage.trim()) mercury.language = mercuryLanguage.trim();
    if (mercurySubject.trim()) mercury.subject = mercurySubject.trim();
    if (mercuryD.trim()) mercury.d = mercuryD.trim();
    if (mercuryIdentifier.trim()) mercury.identifier = mercuryIdentifier.trim();
    if (!Object.keys(mercury).length) {
      error = 'Set at least one Mercury field';
      return null;
    }
    return {
      mercury,
      filter: { limit: clampAdvancedLimit(mercuryLimit) },
      relays: []
    };
  }

  function onSubmit(e: Event): void {
    e.preventDefault();
    error = '';
    const req = mode === 'mercury' ? buildMercuryRequest() : buildRelayRequest();
    if (!req) return;
    void push(`/search?adv=${encodeAdvancedSearch(req)}`);
  }
</script>

<details class="accordion advanced-search-panel" bind:open={detailsOpen}>
  <summary>Advanced Search</summary>
  <form class="advanced-search-form" onsubmit={onSubmit}>
    <div class="advanced-search-modes" role="tablist" aria-label="Search backend">
      <button
        type="button"
        role="tab"
        class="advanced-search-mode"
        class:active={mode === 'relays'}
        aria-selected={mode === 'relays'}
        onclick={() => setMode('relays')}
      >
        Relays
      </button>
      <button
        type="button"
        role="tab"
        class="advanced-search-mode"
        class:active={mode === 'mercury'}
        aria-selected={mode === 'mercury'}
        onclick={() => setMode('mercury')}
      >
        Mercury
      </button>
    </div>

    {#if mode === 'relays'}
      <p class="muted advanced-search-lede">
        Build a NIP-01 filter and query the relays listed below (nak-style).
      </p>

      <fieldset class="advanced-search-fieldset">
        <legend>Filter</legend>
        <StringListRows
          bind:values={kinds}
          label="Kinds"
          placeholder="1 or wiki"
          addLabel="Add kind"
          removeLabel="Remove kind"
        />
        <StringListRows
          bind:values={authors}
          label="Authors"
          placeholder="npub… / hex / naddr…"
          addLabel="Add author"
          removeLabel="Remove author"
          mono
        />
        <StringListRows
          bind:values={ids}
          label="Ids"
          placeholder="hex / note1 / nevent1"
          addLabel="Add id"
          removeLabel="Remove id"
          mono
        />
        <label>
          <span>NIP-50 search</span>
          <input
            type="text"
            bind:value={search}
            placeholder="relay must support search"
            autocomplete="off"
          />
        </label>
        <div class="advanced-search-row">
          <label>
            <span>Since</span>
            <input type="datetime-local" bind:value={sinceLocal} />
          </label>
          <label>
            <span>Until</span>
            <input type="datetime-local" bind:value={untilLocal} />
          </label>
          <label>
            <span>Limit</span>
            <input type="number" min="1" max={ADVANCED_SEARCH_MAX_LIMIT} bind:value={limit} />
          </label>
        </div>
        <p class="muted advanced-search-hint">Cap is {ADVANCED_SEARCH_MAX_LIMIT} events per request.</p>
        <div class="advanced-search-tag-lists">
          <StringListRows bind:values={tagE} label="#e" placeholder="event id" addLabel="Add #e" removeLabel="Remove #e" mono />
          <StringListRows bind:values={tagP} label="#p" placeholder="pubkey" addLabel="Add #p" removeLabel="Remove #p" mono />
          <StringListRows bind:values={tagD} label="#d" placeholder="d tag" addLabel="Add #d" removeLabel="Remove #d" />
          <StringListRows bind:values={tagH} label="#h" placeholder="group h" addLabel="Add #h" removeLabel="Remove #h" />
          <StringListRows bind:values={tagA} label="#a" placeholder="kind:pk:d" addLabel="Add #a" removeLabel="Remove #a" mono />
          <StringListRows bind:values={tagT} label="#t" placeholder="t value" addLabel="Add #t" removeLabel="Remove #t" />
          <StringListRows bind:values={tagTT} label="#T" placeholder="T value" addLabel="Add #T" removeLabel="Remove #T" />
          <StringListRows bind:values={tagK} label="#k" placeholder="k value" addLabel="Add #k" removeLabel="Remove #k" />
        </div>
        <ComposeEventTagRows
          bind:tags={extraTags}
          label="Extra tags"
          hint="One row per tag. Add parts for multi-value tags."
          addRowLabel="Add extra tag"
          removeRowLabel="Remove extra tag"
        />
      </fieldset>

      <fieldset class="advanced-search-fieldset">
        <legend>Relays</legend>
        <StringListRows
          bind:values={relays}
          label="Relays"
          hint="These relays will be queried; edit freely."
          placeholder="wss://…"
          addLabel="Add relay"
          removeLabel="Remove relay"
          inputType="url"
          mono
          onChange={() => {
            relaysDirty = true;
          }}
        />
      </fieldset>
    {:else}
      <p class="muted advanced-search-lede">
        Search GitCitadel Mercury by title, author, language, and related document fields.
      </p>

      <fieldset class="advanced-search-fieldset">
        <legend>Mercury fields</legend>
        <div class="advanced-search-row">
          <label><span>q</span><input type="text" bind:value={mercuryQ} placeholder="full-text" /></label>
          <label><span>title</span><input type="text" bind:value={mercuryTitle} /></label>
          <label><span>author</span><input type="text" bind:value={mercuryAuthor} /></label>
          <label><span>language</span><input type="text" bind:value={mercuryLanguage} /></label>
          <label><span>subject</span><input type="text" bind:value={mercurySubject} /></label>
          <label><span>d</span><input type="text" bind:value={mercuryD} /></label>
          <label><span>identifier</span><input type="text" bind:value={mercuryIdentifier} /></label>
          <label>
            <span>Limit</span>
            <input type="number" min="1" max={ADVANCED_SEARCH_MAX_LIMIT} bind:value={mercuryLimit} />
          </label>
        </div>
        <p class="muted advanced-search-hint">
          Runs publication, wiki, and section searches on Mercury (no relay list).
        </p>
      </fieldset>
    {/if}

    {#if error}
      <p class="advanced-search-error" role="alert">{error}</p>
    {/if}
    <button type="submit" class="btn btn-primary">
      {mode === 'mercury' ? 'Search Mercury' : 'Search relays'}
    </button>
  </form>
</details>
