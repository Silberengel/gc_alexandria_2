<script lang="ts">
  import { untrack } from 'svelte';
  import { push } from 'svelte-spa-router';
  import type { Filter } from 'nostr-tools';
  import {
    ADVANCED_SEARCH_MAX_LIMIT,
    clampAdvancedLimit,
    datetimeLocalToUnix,
    defaultAdvancedSearchRelays,
    encodeAdvancedSearch,
    inferAdvancedSearchMode,
    mercuryMinQLength,
    normalizeMercuryTarget,
    parseKindsInput,
    unixToDatetimeLocal,
    type AdvancedSearchMode,
    type AdvancedSearchRequest,
    type MercurySearchFields,
    type MercurySearchTarget
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
  type MercuryDraft = {
    q: string;
    title: string;
    author: string;
    d: string;
    T: string;
    s: string;
    i: string;
    limit: number;
  };

  function blankMercuryDraft(): MercuryDraft {
    return {
      q: '',
      title: '',
      author: '',
      d: '',
      T: '',
      s: '',
      i: '',
      limit: ADVANCED_SEARCH_MAX_LIMIT
    };
  }

  let mercuryTarget = $state<MercurySearchTarget>('publications');
  let mercuryQ = $state('');
  let mercuryTitle = $state('');
  let mercuryAuthor = $state('');
  let mercuryD = $state('');
  let mercuryT = $state('');
  let mercuryS = $state('');
  let mercuryI = $state('');
  let mercuryLimit = $state(ADVANCED_SEARCH_MAX_LIMIT);
  /** Per-endpoint drafts so Publications / Sections / Wiki fields stay exclusive. */
  let mercuryDrafts = $state<Record<MercurySearchTarget, MercuryDraft>>({
    publications: blankMercuryDraft(),
    sections: blankMercuryDraft(),
    wiki: blankMercuryDraft()
  });
  let relays = $state<string[]>(['']);
  let relaysDirty = $state(false);
  let error = $state('');

  const mercuryQMin = $derived(mercuryMinQLength(mercuryTarget));
  const showMercuryAuthor = $derived(mercuryTarget === 'publications');
  const showMercuryS = $derived(mercuryTarget === 'publications' || mercuryTarget === 'wiki');
  const showMercuryI = $derived(mercuryTarget === 'publications' || mercuryTarget === 'wiki');
  const mercuryQRequired = $derived(mercuryQMin > 0);

  function snapshotMercuryDraft(): MercuryDraft {
    return {
      q: mercuryQ,
      title: mercuryTitle,
      author: mercuryAuthor,
      d: mercuryD,
      T: mercuryT,
      s: mercuryS,
      i: mercuryI,
      limit: mercuryLimit
    };
  }

  function applyMercuryDraft(draft: MercuryDraft): void {
    mercuryQ = draft.q;
    mercuryTitle = draft.title;
    mercuryAuthor = draft.author;
    mercuryD = draft.d;
    mercuryT = draft.T;
    mercuryS = draft.s;
    mercuryI = draft.i;
    mercuryLimit = draft.limit;
  }

  function persistMercuryDraft(target: MercurySearchTarget = mercuryTarget): void {
    mercuryDrafts = { ...mercuryDrafts, [target]: snapshotMercuryDraft() };
  }

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
    mercuryDrafts = {
      publications: blankMercuryDraft(),
      sections: blankMercuryDraft(),
      wiki: blankMercuryDraft()
    };
    mercuryTarget = 'publications';
    applyMercuryDraft(blankMercuryDraft());
  }

  function clearCurrentMercuryDraft(): void {
    const blank = blankMercuryDraft();
    mercuryDrafts = { ...mercuryDrafts, [mercuryTarget]: blank };
    applyMercuryDraft(blank);
  }

  function hydrate(req: AdvancedSearchRequest): void {
    mode = inferAdvancedSearchMode(req);
    const f = req.filter ?? {};
    kinds = asRows((f.kinds ?? []).map(String));
    authors = asRows(f.authors);
    ids = asRows(f.ids);
    search = f.search ?? '';
    sinceLocal = unixToDatetimeLocal(f.since);
    untilLocal = unixToDatetimeLocal(f.until);
    limit = clampAdvancedLimit(f.limit ?? ADVANCED_SEARCH_MAX_LIMIT);
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
    const target = normalizeMercuryTarget(m.target);
    const draft: MercuryDraft = {
      q: m.q ?? '',
      title: m.title ?? '',
      author: m.author ?? '',
      d: m.d ?? '',
      T: m.T ?? '',
      s: m.s ?? '',
      i: m.i ?? m.identifier ?? '',
      limit: clampAdvancedLimit(f.limit ?? ADVANCED_SEARCH_MAX_LIMIT)
    };
    mercuryTarget = target;
    mercuryDrafts = { ...mercuryDrafts, [target]: draft };
    applyMercuryDraft(draft);
    relays = asRows(req.relays?.length ? req.relays : defaultAdvancedSearchRelays(f));
    relaysDirty = true;
  }

  // Open + hydrate from URL props. Never force-close (that collapsed the accordion on kinds edits).
  // Read props outside untrack (identity deps only); write/hydrate inside so mercuryDrafts can't loop.
  $effect(() => {
    const req = initial;
    const isOpen = open;
    untrack(() => {
      if (isOpen || req) detailsOpen = true;
      if (req) hydrate(req);
    });
  });

  $effect(() => {
    void kinds;
    untrack(() => {
      if (mode === 'relays' && !relaysDirty) syncDefaultRelays();
    });
  });

  function setMode(next: AdvancedSearchMode): void {
    mode = next;
    error = '';
    if (next === 'relays' && !relaysDirty) syncDefaultRelays();
  }

  function setMercuryTarget(next: MercurySearchTarget): void {
    if (next === mercuryTarget) return;
    error = '';
    persistMercuryDraft(mercuryTarget);
    mercuryTarget = next;
    applyMercuryDraft(mercuryDrafts[next] ?? blankMercuryDraft());
    // Drop results from another Mercury endpoint so cards stay exclusive to the active API.
    const liveTarget = initial?.mercury
      ? normalizeMercuryTarget(initial.mercury.target)
      : null;
    if (liveTarget && liveTarget !== next) {
      void push('/search');
    }
  }

  function clearActiveMode(): void {
    error = '';
    if (mode === 'mercury') clearCurrentMercuryDraft();
    else resetRelayFields();
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
    persistMercuryDraft();
    const mercury: MercurySearchFields = { target: mercuryTarget };
    if (mercuryQ.trim()) mercury.q = mercuryQ.trim();
    if (mercuryTitle.trim()) mercury.title = mercuryTitle.trim();
    if (showMercuryAuthor && mercuryAuthor.trim()) mercury.author = mercuryAuthor.trim();
    if (mercuryD.trim()) mercury.d = mercuryD.trim();
    if (mercuryT.trim()) mercury.T = mercuryT.trim();
    if (showMercuryS && mercuryS.trim()) mercury.s = mercuryS.trim();
    if (showMercuryI && mercuryI.trim()) mercury.i = mercuryI.trim();

    const minQ = mercuryMinQLength(mercuryTarget);
    if (minQ > 0 && (mercury.q?.length ?? 0) < minQ) {
      error =
        mercuryTarget === 'sections'
          ? 'Sections search needs a query of at least 4 characters.'
          : 'Wiki search needs a query of at least 2 characters.';
      return null;
    }

    const searchable = Object.entries(mercury).filter(
      ([k, v]) => k !== 'target' && typeof v === 'string' && v.trim()
    );
    if (!searchable.length) {
      error = 'Set at least one Mercury search field';
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
        <label class="advanced-search-field">
          <span>NIP-50 search</span>
          <span class="advanced-search-field-control">
            <input
              type="text"
              bind:value={search}
              placeholder="relay must support search"
              autocomplete="off"
            />
            {#if search}
              <button
                type="button"
                class="advanced-search-field-clear"
                aria-label="Clear NIP-50 search"
                onclick={() => (search = '')}
              >×</button>
            {/if}
          </span>
        </label>
        <div class="advanced-search-row">
          <label class="advanced-search-field">
            <span>Since</span>
            <span class="advanced-search-field-control">
              <input type="datetime-local" bind:value={sinceLocal} />
              {#if sinceLocal}
                <button
                  type="button"
                  class="advanced-search-field-clear"
                  aria-label="Clear since"
                  onclick={() => (sinceLocal = '')}
                >×</button>
              {/if}
            </span>
          </label>
          <label class="advanced-search-field">
            <span>Until</span>
            <span class="advanced-search-field-control">
              <input type="datetime-local" bind:value={untilLocal} />
              {#if untilLocal}
                <button
                  type="button"
                  class="advanced-search-field-clear"
                  aria-label="Clear until"
                  onclick={() => (untilLocal = '')}
                >×</button>
              {/if}
            </span>
          </label>
          <label class="advanced-search-field">
            <span>Limit</span>
            <span class="advanced-search-field-control">
              <input type="number" min="1" max={ADVANCED_SEARCH_MAX_LIMIT} bind:value={limit} />
              {#if limit !== ADVANCED_SEARCH_MAX_LIMIT}
                <button
                  type="button"
                  class="advanced-search-field-clear"
                  aria-label="Reset limit"
                  onclick={() => (limit = ADVANCED_SEARCH_MAX_LIMIT)}
                >×</button>
              {/if}
            </span>
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
        Query GitCitadel Mercury’s typed search APIs (no relay list). Pick a target — each maps to one
        endpoint and only its accepted fields.
      </p>

      <div class="advanced-search-modes" role="tablist" aria-label="Mercury search target">
        <button
          type="button"
          role="tab"
          class="advanced-search-mode"
          class:active={mercuryTarget === 'publications'}
          aria-selected={mercuryTarget === 'publications'}
          onclick={() => setMercuryTarget('publications')}
        >
          Publications
        </button>
        <button
          type="button"
          role="tab"
          class="advanced-search-mode"
          class:active={mercuryTarget === 'sections'}
          aria-selected={mercuryTarget === 'sections'}
          onclick={() => setMercuryTarget('sections')}
        >
          Sections
        </button>
        <button
          type="button"
          role="tab"
          class="advanced-search-mode"
          class:active={mercuryTarget === 'wiki'}
          aria-selected={mercuryTarget === 'wiki'}
          onclick={() => setMercuryTarget('wiki')}
        >
          Wiki
        </button>
      </div>

      <fieldset class="advanced-search-fieldset">
        <legend>
          {#if mercuryTarget === 'publications'}
            /api/publications/search
          {:else if mercuryTarget === 'sections'}
            /api/publications/sections/search
          {:else}
            /api/wiki/search
          {/if}
        </legend>
        <p class="muted advanced-search-hint">
          {#if mercuryTarget === 'publications'}
            Kind 30040 indexes — <code>d</code>/<code>T</code>/<code>N</code>/<code>s</code>/<code>i</code>
            plus <code>title</code>/<code>author</code>.
          {:else if mercuryTarget === 'sections'}
            Kind 30041 sections — body search requires <code>q</code> (min 4 chars), plus
            <code>d</code>/<code>T</code>/<code>title</code>.
          {:else}
            Kind 30818 wiki — content search requires <code>q</code> (min 2 chars), plus
            <code>d</code>/<code>T</code>/<code>s</code>/<code>i</code>/<code>title</code>.
          {/if}
        </p>
        <div class="advanced-search-row">
          <label class="advanced-search-field">
            <span>q{#if mercuryQRequired}*{/if}</span>
            <span class="advanced-search-field-control">
              <input
                type="text"
                bind:value={mercuryQ}
                placeholder={mercuryTarget === 'sections'
                  ? 'body text (min 4)'
                  : mercuryTarget === 'wiki'
                    ? 'content (min 2)'
                    : 'optional full-text'}
                minlength={mercuryQMin || undefined}
                required={mercuryQRequired}
                autocomplete="off"
              />
              {#if mercuryQ}
                <button
                  type="button"
                  class="advanced-search-field-clear"
                  aria-label="Clear q"
                  onclick={() => (mercuryQ = '')}
                >×</button>
              {/if}
            </span>
          </label>
          <label class="advanced-search-field">
            <span>title</span>
            <span class="advanced-search-field-control">
              <input type="text" bind:value={mercuryTitle} autocomplete="off" />
              {#if mercuryTitle}
                <button
                  type="button"
                  class="advanced-search-field-clear"
                  aria-label="Clear title"
                  onclick={() => (mercuryTitle = '')}
                >×</button>
              {/if}
            </span>
          </label>
          {#if showMercuryAuthor}
            <label class="advanced-search-field">
              <span>author</span>
              <span class="advanced-search-field-control">
                <input type="text" bind:value={mercuryAuthor} placeholder="name" autocomplete="off" />
                {#if mercuryAuthor}
                  <button
                    type="button"
                    class="advanced-search-field-clear"
                    aria-label="Clear author"
                    onclick={() => (mercuryAuthor = '')}
                  >×</button>
                {/if}
              </span>
            </label>
          {/if}
          <label class="advanced-search-field">
            <span>d</span>
            <span class="advanced-search-field-control">
              <input type="text" bind:value={mercuryD} placeholder="d-tag" autocomplete="off" />
              {#if mercuryD}
                <button
                  type="button"
                  class="advanced-search-field-clear"
                  aria-label="Clear d"
                  onclick={() => (mercuryD = '')}
                >×</button>
              {/if}
            </span>
          </label>
          <label class="advanced-search-field">
            <span>T</span>
            <span class="advanced-search-field-control">
              <input type="text" bind:value={mercuryT} placeholder="#T type" autocomplete="off" />
              {#if mercuryT}
                <button
                  type="button"
                  class="advanced-search-field-clear"
                  aria-label="Clear T"
                  onclick={() => (mercuryT = '')}
                >×</button>
              {/if}
            </span>
          </label>
          {#if showMercuryS}
            <label class="advanced-search-field">
              <span>s</span>
              <span class="advanced-search-field-control">
                <input type="text" bind:value={mercuryS} placeholder="#s source URL" autocomplete="off" />
                {#if mercuryS}
                  <button
                    type="button"
                    class="advanced-search-field-clear"
                    aria-label="Clear s"
                    onclick={() => (mercuryS = '')}
                  >×</button>
                {/if}
              </span>
            </label>
          {/if}
          {#if showMercuryI}
            <label class="advanced-search-field">
              <span>i</span>
              <span class="advanced-search-field-control">
                <input
                  type="text"
                  bind:value={mercuryI}
                  placeholder="#i id (e.g. gutenberg:1184)"
                  autocomplete="off"
                />
                {#if mercuryI}
                  <button
                    type="button"
                    class="advanced-search-field-clear"
                    aria-label="Clear i"
                    onclick={() => (mercuryI = '')}
                  >×</button>
                {/if}
              </span>
            </label>
          {/if}
          <label class="advanced-search-field">
            <span>Limit</span>
            <span class="advanced-search-field-control">
              <input type="number" min="1" max={ADVANCED_SEARCH_MAX_LIMIT} bind:value={mercuryLimit} />
              {#if mercuryLimit !== ADVANCED_SEARCH_MAX_LIMIT}
                <button
                  type="button"
                  class="advanced-search-field-clear"
                  aria-label="Reset limit"
                  onclick={() => (mercuryLimit = ADVANCED_SEARCH_MAX_LIMIT)}
                >×</button>
              {/if}
            </span>
          </label>
        </div>
      </fieldset>
    {/if}

    {#if error}
      <p class="advanced-search-error" role="alert">{error}</p>
    {/if}
    <div class="advanced-search-actions">
      <button type="button" class="btn btn-ghost" onclick={clearActiveMode}>Clear</button>
      <button type="submit" class="btn btn-primary">
        {mode === 'mercury' ? 'Search Mercury' : 'Search relays'}
      </button>
    </div>
  </form>
</details>
