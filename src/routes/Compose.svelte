<script lang="ts">
  import type { Event as NostrEvent } from 'nostr-tools';
  import { push, querystring } from 'svelte-spa-router';
  import TopBar from '$lib/components/TopBar.svelte';
  import { feedThreadPath } from '$lib/feed';
  import { warmNavEvent } from '$lib/nav-warm';
  import EventBody from '$lib/components/EventBody.svelte';
  import ComposeGrammarTextarea from '$lib/components/ComposeGrammarTextarea.svelte';
  import ComposeHashtagRows from '$lib/components/ComposeHashtagRows.svelte';
  import ComposeEventTagRows from '$lib/components/ComposeEventTagRows.svelte';
  import ComposePublicationAuthorsEditor from '$lib/components/ComposePublicationAuthorsEditor.svelte';
  import ComposePublishedOnField from '$lib/components/ComposePublishedOnField.svelte';
  import ComposeUnixTimestampField from '$lib/components/ComposeUnixTimestampField.svelte';
  import ComposePublicationSectionsEditor from '$lib/components/ComposePublicationSectionsEditor.svelte';
  import ComposePublicationIdentifiersEditor from '$lib/components/ComposePublicationIdentifiersEditor.svelte';
  import ComposeSpecKindsEditor from '$lib/components/ComposeSpecKindsEditor.svelte';
  import ComposePaytoEditor from '$lib/components/ComposePaytoEditor.svelte';
  import ComposeRelayListEditor from '$lib/components/ComposeRelayListEditor.svelte';
  import ComposeKind0Editor from '$lib/components/ComposeKind0Editor.svelte';
  import { emptyKind0TagRows } from '$lib/compose-kind0';
  import { isUnixTimestampField } from '$lib/compose-unix-timestamp';
  import { session } from '$lib/stores/session';
  import { openLoginDialog } from '$lib/stores/login-ui';
  import { signAndPublish, signUnsigned, consumeSignFailure, withClientTag } from '$lib/sign';
  import { showNotice, showPublishResult } from '$lib/stores/toast';
  import {
    composerFieldSpecs,
    getKind,
    supportsHashtags,
    allowExtraTags,
    eventClassIds,
    getEventClass,
    kindMatchesClass,
    kindPickerLabel,
    customFormForClass,
    isCatalogued
  } from '@silberengel/kind-compose-catalog';
  import type { EventClassId, FieldDef } from '@silberengel/kind-compose-catalog';
  import {
    OTHER_KIND_SENTINEL,
    COMPOSE_DOCUMENT_PRESETS,
    COMPOSE_METADATA_KINDS,
    composePickerGroups,
    composeKindLabel,
    showContentBox,
    isMetadataComposeKind
  } from '$lib/compose-presets';
  import {
    loadComposeDraft,
    saveComposeDraft,
    deleteComposeDraft,
    listComposeDrafts,
    isComposeDraftEmpty
  } from '$lib/compose-drafts';
  import { buildComposePartial, validateComposeForm } from '$lib/compose-build';
  import {
    pickLatestByKind,
    shouldPreloadMetadata,
    valuesFromMetadataEvent
  } from '$lib/compose-preload';
  import {
    canEditAsShortNote,
    eventToComposeDraft
  } from '$lib/event-compose-preload';
  import {
    baselineContentForEdit,
    ingestShortNoteEdit,
    shortNoteEditDraft,
    shortNoteEditState
  } from '$lib/short-note-edits';
  import {
    checkGrammar,
    defaultGrammarLanguageToolCode,
    grammarLanguageOptions,
    languageToolCodeFrom,
    type GrammarIssue
  } from '$lib/compose-grammar';
  import {
    blossomServersFromTags,
    mergeBlossomServers,
    uploadToBlossomServers,
    imetaTagFromUpload
  } from '$lib/blossom';
  import { lruGet, lruSet } from '$lib/compose-lru';
  import { relayPool } from '$lib/nostr/pool';
  import { profileStack } from '$lib/nostr/selector';
  import { memoryGetEvent } from '$lib/nostr/event-memory';
  import { cacheGetEvent } from '$lib/nostr/cache';
  import { fetchById } from '$lib/nostr/fetch';
  import { KIND } from '$lib/constants';

  const groups = composePickerGroups();
  const classIds = eventClassIds();

  let pickerValue = $state<number>(1);
  let otherMode = $state(false);
  let otherClass = $state<EventClassId>('regular');
  let otherKindText = $state('');
  let otherError = $state('');
  let otherLocked = $state(false);

  let kind = $state(1);
  let content = $state('');
  let values = $state<Record<string, string>>({});
  let hashtagRows = $state<string[]>(['']);
  let imetaTags = $state<string[][]>([]);
  let freeformTags = $state<string[][]>([['', '']]);
  let kind0Tags = $state<string[][]>(emptyKind0TagRows());
  let existingKind0 = $state<Record<string, unknown>>({});

  let grammarOn = $state(true);
  let grammarLang = $state(defaultGrammarLanguageToolCode());
  let grammarIssues = $state<GrammarIssue[]>([]);
  let grammarCheckedSource = $state('');
  let grammarBusy = $state(false);
  const grammarLangChoices = $derived(grammarLanguageOptions(grammarLang));

  let previewGen = $state(0);
  let previewEvent = $state<NostrEvent | null>(null);
  let previewJson = $state('');
  let formError = $state('');
  let posting = $state(false);
  let uploading = $state(false);
  let draftListOpen = $state(false);
  /** Bumped when sessionStorage drafts change so the list re-reads. */
  let draftRevision = $state(0);
  type EditorTab = 'edit' | 'preview' | 'json';
  let editorTab = $state<EditorTab>('edit');
  /** Own kind-1 being revised as NIP-41 kind 1010 (null = normal compose / copy). */
  let shortNoteEditSource = $state<NostrEvent | null>(null);
  /** Last `?copy=` / `?edit=` id we applied, so the effect does not loop. */
  let appliedIntentKey = $state<string | null>(null);

  const fields = $derived.by((): FieldDef[] => {
    if (isCatalogued(kind)) return composerFieldSpecs(kind);
    const form = customFormForClass(otherClass);
    return (form?.fields ?? []).filter((f) => f.composer !== false) as FieldDef[];
  });
  const contentMeta = $derived(getKind(kind)?.content);
  const showBody = $derived(showContentBox(kind) || (!isCatalogued(kind) && otherLocked));
  const showHashtags = $derived(
    !shortNoteEditSource && (isCatalogued(kind) ? supportsHashtags(kind) : true)
  );
  const showFreeform = $derived(
    !shortNoteEditSource && kind !== 0 && (isCatalogued(kind) ? allowExtraTags(kind) : true)
  );
  const showGrammar = $derived(grammarOn && kind !== 9802 && showBody);
  const draftItems = $derived.by(() => {
    void draftRevision;
    return $session.pubkey ? listComposeDrafts($session.pubkey) : [];
  });

  function refreshDraftList(): void {
    draftRevision += 1;
  }

  function emptyValuesFor(nextKind: number): Record<string, string> {
    const out: Record<string, string> = {};
    const specs = isCatalogued(nextKind) ? composerFieldSpecs(nextKind) : [];
    for (const f of specs) {
      if (f.default != null) out[f.id] = String(f.default);
      else out[f.id] = '';
    }
    return out;
  }

  function cleanedHashtags(rows: string[]): string[] {
    return rows.map((t) => t.replace(/^#/, '').trim()).filter(Boolean);
  }

  function cleanedFreeformTags(rows: string[][]): string[][] {
    return rows
      .map((row) => row.map((c) => c.trim()).filter((c, i) => i === 0 || c.length > 0))
      .filter((row) => row.length >= 1 && row[0]!.length > 0)
      .map((row) => {
        // Drop trailing empty parts but keep intentional empty middle slots? Keep non-empty only after name.
        const name = row[0]!;
        const rest = row.slice(1).filter(Boolean);
        return [name, ...rest];
      });
  }

  function snapshotDraft() {
    return {
      kind,
      content,
      values: { ...values },
      hashtags: cleanedHashtags(hashtagRows),
      imetaTags: imetaTags.map((t) => [...t]),
      freeformTags: cleanedFreeformTags(freeformTags),
      kind0Tags: kind0Tags.map((t) => [...t]),
      updatedAt: Date.now()
    };
  }

  function applyDraft(d: {
    kind: number;
    content: string;
    values: Record<string, string>;
    hashtags: string[];
    imetaTags: string[][];
    freeformTags: string[][];
    kind0Tags?: string[][];
  }) {
    kind = d.kind;
    pickerValue = d.kind;
    otherMode = false;
    otherLocked = false;
    content = d.content;
    values = { ...emptyValuesFor(d.kind), ...d.values };
    hashtagRows = d.hashtags.length ? [...d.hashtags] : [''];
    imetaTags = d.imetaTags.map((t) => [...t]);
    freeformTags = d.freeformTags.length
      ? d.freeformTags.map((t) => (t.length >= 2 ? [...t] : [t[0] ?? '', '']))
      : [['', '']];
    kind0Tags =
      d.kind === 0 && d.kind0Tags?.length
        ? d.kind0Tags.map((t) => [...t])
        : emptyKind0TagRows();
  }

  function persistCurrent() {
    const pk = $session.pubkey;
    if (!pk || otherMode || shortNoteEditSource) return;
    const draft = snapshotDraft();
    if (isComposeDraftEmpty(draft, emptyValuesFor(draft.kind))) {
      deleteComposeDraft(pk, draft.kind);
    } else {
      saveComposeDraft(pk, draft);
    }
    refreshDraftList();
  }

  /** Wipe the form and return the kind picker to the default short note. */
  function clearForm(): void {
    const pk = $session.pubkey;
    const previousKind = kind;
    if (pk) {
      deleteComposeDraft(pk, previousKind);
      if (previousKind !== 1) deleteComposeDraft(pk, 1);
      refreshDraftList();
    }
    otherMode = false;
    otherLocked = false;
    otherError = '';
    otherKindText = '';
    otherClass = 'regular';
    kind = 1;
    pickerValue = 1;
    content = '';
    values = emptyValuesFor(1);
    hashtagRows = [''];
    imetaTags = [];
    freeformTags = [['', '']];
    kind0Tags = emptyKind0TagRows();
    existingKind0 = {};
    formError = '';
    grammarIssues = [];
    grammarCheckedSource = '';
    editorTab = 'edit';
    shortNoteEditSource = null;
    appliedIntentKey = null;
    bumpPreview();
  }

  async function resolveIntentEvent(id: string): Promise<NostrEvent | null> {
    const hex = id.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hex)) return null;
    return (
      memoryGetEvent(hex) ??
      (await cacheGetEvent(hex).catch(() => null)) ??
      (await fetchById(hex)) ??
      null
    );
  }

  async function applyCopyIntent(source: NostrEvent): Promise<void> {
    persistCurrent();
    shortNoteEditSource = null;
    const draft = eventToComposeDraft(source);
    applyDraft(draft);
    formError = '';
    editorTab = 'edit';
    bumpPreview();
  }

  async function applyEditIntent(source: NostrEvent): Promise<void> {
    const pk = $session.pubkey;
    if (!canEditAsShortNote(source, pk)) {
      formError = 'Only your own kind 1 notes can be edited this way.';
      return;
    }
    persistCurrent();
    const edits = await shortNoteEditState(source);
    const baseline = baselineContentForEdit(source, edits.latestAuthorEdit);
    shortNoteEditSource = source;
    applyDraft({
      kind: KIND.TEXT_NOTE,
      content: baseline,
      values: {},
      hashtags: [],
      imetaTags: [],
      freeformTags: []
    });
    formError = '';
    editorTab = 'edit';
    bumpPreview();
  }

  async function loadKind(nextKind: number) {
    persistCurrent();
    const pk = $session.pubkey;
    const saved = pk ? loadComposeDraft(pk, nextKind) : null;
    kind = nextKind;
    pickerValue = nextKind;
    otherMode = false;
    otherLocked = false;
    otherError = '';
    formError = '';
    grammarIssues = [];
    if (saved) {
      applyDraft(saved);
      bumpPreview();
      return;
    }
    content = '';
    values = emptyValuesFor(nextKind);
    hashtagRows = [''];
    imetaTags = [];
    freeformTags = [['', '']];
    kind0Tags = emptyKind0TagRows();
    existingKind0 = {};
    if (pk && shouldPreloadMetadata(nextKind)) {
      const live = pickLatestByKind(session.getMetadata(), nextKind);
      if (live) {
        const pre = valuesFromMetadataEvent(live);
        content = pre.content;
        values = { ...emptyValuesFor(nextKind), ...pre.values };
        if (pre.existingKind0) existingKind0 = pre.existingKind0;
        if (pre.kind0Tags) kind0Tags = pre.kind0Tags.map((t) => [...t]);
      } else if (isMetadataComposeKind(nextKind)) {
        // Fetch once if login metadata missed this kind.
        try {
          const hits = await relayPool.query(
            profileStack(),
            [{ authors: [pk], kinds: [nextKind], limit: 1 }],
            4000,
            2
          );
          const hit = hits[0];
          if (hit) {
            const pre = valuesFromMetadataEvent(hit);
            content = pre.content;
            values = { ...emptyValuesFor(nextKind), ...pre.values };
            if (pre.existingKind0) existingKind0 = pre.existingKind0;
            if (pre.kind0Tags) kind0Tags = pre.kind0Tags.map((t) => [...t]);
          }
        } catch {
          /* ignore */
        }
      }
    }
    bumpPreview();
  }

  function onPickerChange() {
    const selected = Number(pickerValue);
    pickerValue = selected;
    if (selected === OTHER_KIND_SENTINEL) {
      persistCurrent();
      otherMode = true;
      otherLocked = false;
      otherKindText = '';
      otherError = '';
      return;
    }
    void loadKind(selected);
  }

  function validateOtherKind() {
    otherError = '';
    // type=number bind may yield a number; never call string methods on it.
    const raw = String(otherKindText ?? '').trim();
    const n = Number(raw);
    if (!raw || !Number.isInteger(n) || n < 0 || n > 65535) {
      otherError = 'Enter a kind number from 0 to 65535.';
      return;
    }
    if (!kindMatchesClass(n, otherClass)) {
      otherError = `Kind ${n} is not in the ${getEventClass(otherClass).label} class.`;
      return;
    }
    otherLocked = true;
    otherMode = false;
    kind = n;
    pickerValue = OTHER_KIND_SENTINEL;
    content = '';
    values = emptyValuesFor(n);
    if (!isCatalogued(n)) {
      const form = customFormForClass(otherClass);
      for (const f of form?.fields ?? []) {
        if (f.composer === false) continue;
        values[f.id] = f.default != null ? String(f.default) : '';
      }
    }
    hashtagRows = [''];
    imetaTags = [];
    freeformTags = [['', '']];
    kind0Tags = emptyKind0TagRows();
    editorTab = 'edit';
    formError = '';
    bumpPreview();
  }

  function formState() {
    return {
      kind,
      content,
      values,
      hashtags: cleanedHashtags(hashtagRows),
      imetaTags,
      freeformTags: cleanedFreeformTags(freeformTags),
      kind0Tags: kind0Tags.map((t) => [...t]),
      existingKind0
    };
  }

  function bumpPreview() {
    const gen = ++previewGen;
    const pk = $session.pubkey ?? '0'.repeat(64);
    const partial = shortNoteEditSource
      ? (() => {
          const draft = shortNoteEditDraft(shortNoteEditSource, content);
          return { ...draft, tags: withClientTag(draft.tags) };
        })()
      : buildComposePartial(formState());
    previewJson = JSON.stringify(
      {
        kind: partial.kind,
        content: partial.content,
        tags: partial.tags,
        pubkey: pk,
        created_at: Math.floor(Date.now() / 1000)
      },
      null,
      2
    );
    previewEvent = {
      id: '',
      sig: '',
      pubkey: pk,
      created_at: Math.floor(Date.now() / 1000),
      kind: partial.kind,
      content: partial.content,
      tags: partial.tags
    };
    void gen;
  }

  $effect(() => {
    void kind;
    void content;
    void shortNoteEditSource;
    // Deep-read proxies: `void values` alone does not re-run on values[id] = … /
    // bind:value={values[id]} (e.g. 30040 title), so drafts never saved.
    void JSON.stringify(values);
    void JSON.stringify(hashtagRows);
    void JSON.stringify(imetaTags);
    void JSON.stringify(freeformTags);
    void JSON.stringify(kind0Tags);
    const t = setTimeout(() => {
      bumpPreview();
      persistCurrent();
    }, 200);
    return () => clearTimeout(t);
  });

  // When the catalog publication-language field changes, seed the dropdown.
  // Do not override a manual dropdown pick while that field stays the same.
  let lastPublicationLanguage = $state<string | null>(null);
  $effect(() => {
    const pub = values.publication_language?.trim() || '';
    if (pub === (lastPublicationLanguage ?? '')) return;
    lastPublicationLanguage = pub;
    if (!pub) return;
    grammarLang = languageToolCodeFrom(pub);
  });

  $effect(() => {
    if (!showGrammar) {
      grammarIssues = [];
      grammarCheckedSource = '';
      grammarBusy = false;
      return;
    }
    const text = content;
    const lang = grammarLang;
    let cancelled = false;
    const t = setTimeout(() => {
      grammarBusy = true;
      void checkGrammar(text, lang)
        .then((issues) => {
          if (cancelled) return;
          grammarIssues = issues;
          grammarCheckedSource = text;
        })
        .finally(() => {
          if (!cancelled) grammarBusy = false;
        });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
      grammarBusy = false;
    };
  });

  function applyGrammarFix(issue: GrammarIssue, replacement: string) {
    const before = content.slice(0, issue.offset);
    const after = content.slice(issue.offset + issue.length);
    content = `${before}${replacement}${after}`;
    grammarIssues = [];
    grammarCheckedSource = '';
  }

  function fieldOptions(field: FieldDef): string[] {
    const options = (field as FieldDef & { options?: string[] }).options;
    return Array.isArray(options) ? options : [];
  }

  async function blossomServerList(): Promise<string[]> {
    const pk = $session.pubkey;
    const cacheKey = pk ? `blossom-servers:${pk}` : '';
    if (cacheKey) {
      const cached = lruGet<string[]>(cacheKey);
      if (cached?.length) return mergeBlossomServers(cached);
    }
    let user: string[] = [];
    if (pk) {
      try {
        const hits = await relayPool.query(
          profileStack(),
          [{ authors: [pk], kinds: [10063], limit: 1 }],
          4000,
          2
        );
        const ev = hits[0];
        if (ev) {
          user = blossomServersFromTags(ev.tags);
          if (cacheKey) lruSet(cacheKey, user);
        }
      } catch {
        /* presets only */
      }
    }
    return mergeBlossomServers(user);
  }

  async function onFilePicked(ev: { currentTarget: HTMLInputElement }) {
    const file = ev.currentTarget.files?.[0];
    ev.currentTarget.value = '';
    if (!file) return;
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    uploading = true;
    formError = '';
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const servers = await blossomServerList();
      const result = await uploadToBlossomServers({
        servers,
        bytes,
        mimeType: file.type || undefined,
        signAuth: async (partial) => signUnsigned(partial)
      });
      let width: number | undefined;
      let height: number | undefined;
      if (file.type.startsWith('image/')) {
        try {
          const bmp = await createImageBitmap(file);
          width = bmp.width;
          height = bmp.height;
          bmp.close();
        } catch {
          /* ignore */
        }
      }
      const tag = imetaTagFromUpload({
        url: result.url,
        mime: file.type || undefined,
        sha256: result.sha256,
        width,
        height
      });
      imetaTags = [...imetaTags, tag];
      if (showBody && !content.includes(result.url)) {
        content = content ? `${content.trimEnd()}\n\n${result.url}` : result.url;
      }
    } catch (err) {
      formError = err instanceof Error ? err.message : 'Upload failed.';
      const signFail = consumeSignFailure();
      if (signFail) formError = signFail;
    } finally {
      uploading = false;
    }
  }

  function removeImeta(i: number) {
    imetaTags = imetaTags.filter((_, idx) => idx !== i);
  }

  async function publish() {
    formError = '';
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    posting = true;
    try {
      if (shortNoteEditSource) {
        const text = content.trim();
        if (!text) {
          formError = 'Edited notes need some content.';
          return;
        }
        const partial = shortNoteEditDraft(shortNoteEditSource, text);
        const signed = await signAndPublish(partial);
        if (!signed) {
          formError = consumeSignFailure() ?? 'Could not sign or publish.';
          showPublishResult(false);
          return;
        }
        const editedNote = shortNoteEditSource;
        ingestShortNoteEdit(signed, editedNote);
        deleteComposeDraft($session.pubkey, KIND.TEXT_NOTE);
        refreshDraftList();
        showPublishResult(true);
        showNotice('Edit published.');
        shortNoteEditSource = null;
        appliedIntentKey = null;
        content = '';
        warmNavEvent(editedNote);
        void push(feedThreadPath(editedNote));
        return;
      }

      const state = formState();
      const gate = validateComposeForm(state);
      if (!gate.ok) {
        formError = gate.error;
        return;
      }
      const partial = buildComposePartial(state);
      const signed = await signAndPublish(partial);
      if (!signed) {
        formError = consumeSignFailure() ?? 'Could not sign or publish.';
        showPublishResult(false);
        return;
      }
      deleteComposeDraft($session.pubkey, kind);
      refreshDraftList();
      showPublishResult(true);
      showNotice('Published.');
      content = showBody ? '' : content;
      if (!isMetadataComposeKind(kind)) {
        values = emptyValuesFor(kind);
        hashtagRows = [''];
        imetaTags = [];
        freeformTags = [['', '']];
        kind0Tags = emptyKind0TagRows();
      }
      bumpPreview();
    } finally {
      posting = false;
    }
  }

  let bootstrappedFor = $state<string | null>(null);
  $effect(() => {
    const pk = $session.pubkey;
    if (!pk || bootstrappedFor === pk) return;
    bootstrappedFor = pk;
    const params = new URLSearchParams($querystring ?? '');
    if (params.get('copy') || params.get('edit')) return;
    const rawKind = params.get('kind');
    const qKind =
      rawKind != null && rawKind.trim() !== '' ? Number(rawKind.trim()) : Number.NaN;
    const allowed = new Set<number>([
      ...COMPOSE_DOCUMENT_PRESETS,
      ...COMPOSE_METADATA_KINDS,
      ...groups.flatMap((g) => g.kinds)
    ]);
    const start = Number.isInteger(qKind) && allowed.has(qKind) ? qKind : kind;
    void loadKind(start);
  });

  $effect(() => {
    const pk = $session.pubkey;
    const params = new URLSearchParams($querystring ?? '');
    const copyId = (params.get('copy') ?? '').trim().toLowerCase();
    const editId = (params.get('edit') ?? '').trim().toLowerCase();
    const intentKey = copyId ? `copy:${copyId}` : editId ? `edit:${editId}` : '';
    if (!pk || !intentKey) return;
    if (appliedIntentKey === intentKey) return;
    let cancelled = false;
    void (async () => {
      const id = copyId || editId;
      const source = await resolveIntentEvent(id);
      if (cancelled) return;
      if (!source) {
        formError = 'That event could not be loaded for compose.';
        appliedIntentKey = intentKey;
        return;
      }
      appliedIntentKey = intentKey;
      if (copyId) await applyCopyIntent(source);
      else await applyEditIntent(source);
    })();
    return () => {
      cancelled = true;
    };
  });
</script>

<TopBar />
<main class="shell reading-body compose-page">
  <header class="page-header">
    <p class="page-kicker">Publish</p>
    <h1>{shortNoteEditSource ? 'Edit note' : 'Compose'}</h1>
    <p class="page-lede muted">
      {#if shortNoteEditSource}
        Publishing saves a kind {KIND.SHORT_NOTE_EDIT} revision (NIP-41) for your original note. Your
        pubkey, a fresh timestamp, and the Alexandria client tag are set when you sign.
      {:else}
        Fields and tags come from the kind catalog. Drafts stay in this browser tab until you publish
        or sign out. Copying an event preloads its fields as you — id, signature, and client tag are
        reminted on publish.
      {/if}
    </p>
  </header>

  {#if !$session.pubkey}
    <p class="muted">
      <button type="button" class="btn btn-primary" onclick={() => openLoginDialog()}>Sign in</button>
      to compose and publish.
    </p>
  {:else}
    <div class="compose-toolbar">
      <label class="compose-kind">
        <span>Kind</span>
        {#if shortNoteEditSource}
          <p class="compose-kind-fixed" title={`Editing note ${shortNoteEditSource.id}`}>
            {KIND.SHORT_NOTE_EDIT} – Short-note edit (NIP-41)
            <span class="muted compose-kind-fixed-target"
              >target {shortNoteEditSource.id.slice(0, 12)}…</span
            >
          </p>
        {:else}
          <select bind:value={pickerValue} onchange={onPickerChange}>
            {#each groups as group}
              <optgroup label={group.label}>
                {#each group.kinds as k}
                  <option value={k}>{composeKindLabel(k)}</option>
                {/each}
              </optgroup>
            {/each}
            <option value={OTHER_KIND_SENTINEL}>Other…</option>
          </select>
        {/if}
      </label>
      {#if otherLocked && !shortNoteEditSource}
        <span class="muted other-summary"
          >{kind} · {getEventClass(otherClass).label} · {isCatalogued(kind)
            ? kindPickerLabel(kind)
            : 'Custom'}</span
        >
      {/if}
      {#if !shortNoteEditSource}
        <button type="button" class="btn" onclick={() => (draftListOpen = !draftListOpen)}>
          Drafts ({draftItems.length})
        </button>
      {/if}
    </div>

    {#if draftListOpen && draftItems.length}
      <ul class="compose-drafts">
        {#each draftItems as item}
          <li>
            <button type="button" class="btn" onclick={() => void loadKind(item.kind)}>
              Restore {composeKindLabel(item.kind)}
            </button>
            <button
              type="button"
              class="btn"
              onclick={() => {
                const pk = $session.pubkey;
                if (!pk) return;
                deleteComposeDraft(pk, item.kind, item.mode);
                refreshDraftList();
                draftListOpen = listComposeDrafts(pk).length > 0;
              }}>Delete</button
            >
          </li>
        {/each}
      </ul>
    {/if}

    {#if otherMode}
      <section class="card compose-other">
        <p class="muted">Pick a NIP-01 event class, enter a kind number, then validate.</p>
        <fieldset class="compose-classes">
          <legend>Event class</legend>
          {#each classIds as id}
            <label>
              <input type="radio" name="event-class" value={id} bind:group={otherClass} />
              <span>
                <strong>{getEventClass(id).label}</strong>
                {#if getEventClass(id).description}
                  <span class="muted"> — {getEventClass(id).description}</span>
                {/if}
              </span>
            </label>
          {/each}
        </fieldset>
        <label>
          Kind number
          <input
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            autocomplete="off"
            placeholder="e.g. 1111"
            bind:value={otherKindText}
          />
        </label>
        {#if otherError}
          <p class="compose-error">{otherError}</p>
        {/if}
        <button type="button" class="btn btn-primary" onclick={validateOtherKind}>Validate</button>
      </section>
    {:else}
      <form
        class="card compose-form"
        onsubmit={(e) => {
          e.preventDefault();
          void publish();
        }}
      >
        <div class="compose-tabs" role="tablist" aria-label="Editor view">
          <button
            type="button"
            role="tab"
            class="compose-tab"
            class:active={editorTab === 'edit'}
            aria-selected={editorTab === 'edit'}
            onclick={() => (editorTab = 'edit')}>Edit</button
          >
          <button
            type="button"
            role="tab"
            class="compose-tab"
            class:active={editorTab === 'preview'}
            aria-selected={editorTab === 'preview'}
            onclick={() => (editorTab = 'preview')}>Preview</button
          >
          <button
            type="button"
            role="tab"
            class="compose-tab"
            class:active={editorTab === 'json'}
            aria-selected={editorTab === 'json'}
            onclick={() => (editorTab = 'json')}>Json</button
          >
        </div>

        {#if editorTab === 'edit'}
          <div class="compose-tab-panel" role="tabpanel">
            {#if kind === 0}
              <div class="compose-field">
                <ComposeKind0Editor bind:tags={kind0Tags} />
              </div>
            {:else}
              {#each fields as field (field.id)}
                {#if field.id === 'publication_author'}
                  <div class="compose-field">
                    <ComposePublicationAuthorsEditor
                      bind:value={values[field.id]}
                      label={field.label}
                      required={!!field.required}
                      help={field.help ?? ''}
                    />
                  </div>
                {:else if field.id === 'published_on'}
                  <ComposePublishedOnField
                    bind:value={values[field.id]}
                    label={field.label}
                    required={!!field.required}
                    help={field.help ?? 'Date as dd.mm.yyyy'}
                  />
                {:else if field.id === 'sections'}
                  <div class="compose-field">
                    <ComposePublicationSectionsEditor
                      bind:value={values[field.id]}
                      label={field.label}
                      required={!!field.required}
                      help={field.help ?? ''}
                    />
                  </div>
                {:else if field.id === 'publication_identifiers'}
                  <div class="compose-field">
                    <ComposePublicationIdentifiersEditor
                      bind:value={values[field.id]}
                      label={field.label}
                      required={!!field.required}
                      help={field.help ?? ''}
                    />
                  </div>
                {:else if field.id === 'spec_kinds'}
                  <div class="compose-field">
                    <ComposeSpecKindsEditor
                      bind:value={values[field.id]}
                      label={field.label}
                      required={!!field.required}
                      help={field.help ?? ''}
                    />
                  </div>
                {:else if field.id === 'payto'}
                  <div class="compose-field">
                    <ComposePaytoEditor
                      bind:value={values[field.id]}
                      label={field.label}
                      required={!!field.required}
                      help={field.help ?? ''}
                    />
                  </div>
                {:else if field.id === 'relays'}
                  <div class="compose-field">
                    <ComposeRelayListEditor
                      bind:value={values[field.id]}
                      label={field.label}
                      required={!!field.required}
                      help={field.help ?? ''}
                      withMarkers={field.emit === 'relay_list_rw'}
                      placeholder={kind === 10243 ? 'https://…' : 'wss://…'}
                    />
                  </div>
                {:else if isUnixTimestampField(field, kind)}
                  <ComposeUnixTimestampField
                    bind:value={values[field.id]}
                    label={field.label}
                    required={!!field.required}
                    help={field.help ?? 'Unix timestamp (seconds)'}
                  />
                {:else}
                  <label class="compose-field">
                    <span
                      >{field.label}{#if field.required}*{/if}</span
                    >
                    {#if field.widget === 'textarea' || field.multiline}
                      <textarea rows="3" bind:value={values[field.id]}></textarea>
                    {:else if field.widget === 'select'}
                      {@const opts = fieldOptions(field)}
                      {#if opts.length > 0 && opts.length <= 4}
                        <div
                          class="compose-option-group"
                          role="radiogroup"
                          aria-label={field.label}
                        >
                          {#each opts as opt}
                            <label class="compose-option">
                              <input
                                type="radio"
                                name={`compose-${kind}-${field.id}`}
                                value={opt}
                                checked={(values[field.id] || field.default || '') === opt}
                                onchange={() => {
                                  values[field.id] = opt;
                                }}
                              />
                              <span>{opt}</span>
                            </label>
                          {/each}
                        </div>
                      {:else}
                        <select bind:value={values[field.id]}>
                          <option value="">—</option>
                          {#each opts as opt}
                            <option value={opt}>{opt}</option>
                          {/each}
                        </select>
                      {/if}
                    {:else if field.widget === 'checkbox'}
                      <input
                        type="checkbox"
                        checked={values[field.id] === 'true'}
                        onchange={(e) => {
                          values[field.id] = e.currentTarget.checked ? 'true' : '';
                        }}
                      />
                    {:else}
                      <input
                        type={field.widget === 'url' ? 'url' : 'text'}
                        bind:value={values[field.id]}
                      />
                    {/if}
                    {#if field.help}
                      <small class="muted">{field.help}</small>
                    {/if}
                  </label>
                {/if}
              {/each}
            {/if}

            {#if showBody}
              <div class="compose-content-block">
                <label class="compose-field">
                  <span>{contentMeta?.label ?? 'Content'}{#if contentMeta?.required}*{/if}</span>
                  {#if kind !== 9802}
                    <ComposeGrammarTextarea
                      bind:value={content}
                      rows={10}
                      placeholder={contentMeta?.placeholder ?? ''}
                      issues={grammarIssues}
                      checkedSource={grammarCheckedSource}
                      enabled={showGrammar}
                      onApply={applyGrammarFix}
                    />
                  {:else}
                    <textarea
                      rows="10"
                      bind:value={content}
                      placeholder={contentMeta?.placeholder ?? ''}
                    ></textarea>
                  {/if}
                </label>
                {#if kind !== 9802}
                  <div class="compose-grammar-tools">
                    <label class="compose-grammar-check">
                      <input type="checkbox" bind:checked={grammarOn} />
                      <span>Grammar{#if grammarOn && grammarBusy}…{/if}</span>
                    </label>
                    <label class="compose-grammar-lang">
                      <span class="visually-hidden">Language</span>
                      <select bind:value={grammarLang} disabled={!grammarOn} aria-label="Language">
                        {#each grammarLangChoices as opt (opt.languageToolCode)}
                          <option value={opt.languageToolCode}>{opt.label}</option>
                        {/each}
                      </select>
                    </label>
                  </div>
                {/if}
              </div>
            {/if}

            {#if showHashtags}
              <ComposeHashtagRows bind:tags={hashtagRows} />
            {/if}

            {#if showFreeform}
              <ComposeEventTagRows bind:tags={freeformTags} />
            {/if}

            {#if imetaTags.length}
              <div class="compose-media">
                {#each imetaTags as tag, i}
                  <span class="compose-chip">
                    {tag.find((p) => p.startsWith('url '))?.slice(4) ?? 'attachment'}
                    <button type="button" onclick={() => removeImeta(i)} aria-label="Remove"
                      >×</button
                    >
                  </span>
                {/each}
              </div>
            {/if}
          </div>
        {:else if editorTab === 'preview'}
          <div class="compose-tab-panel compose-tab-preview" role="tabpanel">
            {#key `${previewGen}-${kind}`}
              {#if previewEvent}
                <EventBody event={previewEvent} showEmbeds />
              {:else}
                <p class="muted">Nothing to preview yet.</p>
              {/if}
            {/key}
          </div>
        {:else}
          <div class="compose-tab-panel compose-tab-json" role="tabpanel">
            <pre>{previewJson}</pre>
          </div>
        {/if}

        {#if formError}
          <p class="compose-error">{formError}</p>
        {/if}

        <div class="compose-actions">
          <button class="btn btn-primary" type="submit" disabled={posting || uploading}>
            {#if posting}
              Publishing…
            {:else if shortNoteEditSource}
              Publish edit
            {:else}
              Publish
            {/if}
          </button>
          <button
            class="btn"
            type="button"
            disabled={posting || uploading}
            onclick={clearForm}
          >
            Clear
          </button>
          {#if !shortNoteEditSource}
          <label
            class="btn btn-icon compose-upload-btn"
            class:is-busy={uploading}
            title={uploading ? 'Uploading…' : 'Upload'}
            aria-label={uploading ? 'Uploading…' : 'Upload'}
          >
            {#if uploading}
              <span class="jump-busy-spinner" aria-hidden="true"></span>
            {:else}
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.75"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M12 15V4m0 0L8 8m4-4 4 4M5 16.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1.5"
                />
              </svg>
            {/if}
            <input
              type="file"
              accept="image/*,video/*,audio/*"
              hidden
              disabled={uploading}
              onchange={(e) => void onFilePicked(e)}
            />
          </label>
          {/if}
        </div>
      </form>
    {/if}
  {/if}
</main>

<style>
  .compose-kind-fixed {
    margin: 0;
    padding: 0.45rem 0.65rem;
    border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent);
    border-radius: 0.4rem;
    background: color-mix(in srgb, var(--paper) 70%, var(--paper-light));
    font-size: 0.95rem;
    line-height: 1.35;
  }
  .compose-kind-fixed-target {
    display: block;
    margin-top: 0.15rem;
    font-size: 0.8rem;
  }
  .compose-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: end;
    margin-bottom: 1rem;
  }
  .compose-kind {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: min(100%, 22rem);
  }
  .compose-kind select {
    width: 100%;
  }
  .compose-form,
  .compose-other {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    margin-bottom: 1.5rem;
  }
  .compose-tabs {
    display: flex;
    gap: 0.15rem;
    margin: -0.15rem 0 0.25rem;
    border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent);
  }
  .compose-tab {
    appearance: none;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    padding: 0.45rem 0.85rem;
    font: inherit;
    cursor: pointer;
    color: color-mix(in srgb, currentColor 65%, transparent);
  }
  .compose-tab:hover {
    color: inherit;
  }
  .compose-tab.active {
    color: inherit;
    border-bottom-color: var(--accent, currentColor);
    font-weight: 600;
  }
  .compose-tab-panel {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    min-height: 12rem;
  }
  .compose-tab-preview,
  .compose-tab-json {
    padding-top: 0.25rem;
  }
  .compose-tab-json pre {
    margin: 0;
    overflow: auto;
    max-height: 32rem;
    font-size: 0.8rem;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .compose-field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .compose-option-group {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1.25rem;
    align-items: center;
  }
  .compose-option {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.95rem;
    cursor: pointer;
  }
  .compose-classes {
    border: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .compose-classes label {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
  }
  .compose-media {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }
  .compose-chip {
    display: inline-flex;
    gap: 0.35rem;
    align-items: center;
    max-width: 100%;
    padding: 0.25rem 0.5rem;
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    border-radius: 4px;
    font-size: 0.85rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .compose-chip button {
    border: none;
    background: none;
    cursor: pointer;
    font: inherit;
  }
  .compose-error {
    color: var(--danger, #a33);
  }
  .compose-drafts {
    list-style: none;
    padding: 0;
    margin: 0 0 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .compose-drafts li {
    display: flex;
    gap: 0.5rem;
  }
  .other-summary {
    font-size: 0.9rem;
  }
  .compose-content-block {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .compose-grammar-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem 0.85rem;
    align-items: center;
    color: color-mix(in srgb, currentColor 52%, transparent);
    font-size: 0.78rem;
  }
  .compose-grammar-check {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    cursor: pointer;
    user-select: none;
  }
  .compose-grammar-check input {
    width: auto;
    margin: 0;
    transform: scale(0.9);
    transform-origin: center left;
    accent-color: color-mix(in srgb, currentColor 55%, transparent);
  }
  .compose-grammar-lang select {
    width: auto;
    min-width: 6.5rem;
    max-width: 9rem;
    padding: 0.15rem 0.35rem;
    font-size: 0.78rem;
    color: inherit;
    background: transparent;
    border-color: color-mix(in srgb, currentColor 22%, transparent);
  }
  .compose-grammar-lang select:disabled {
    opacity: 0.55;
  }
  .compose-actions {
    display: flex;
    flex-wrap: nowrap;
    gap: 0.4rem;
    align-items: center;
    min-width: 0;
  }
  .compose-actions .btn-primary {
    flex: 0 0 auto;
    padding: 0.4rem 0.7rem;
    white-space: nowrap;
  }
  .compose-upload-btn {
    cursor: pointer;
    flex: 0 0 auto;
    width: 2.2rem;
    height: 2.2rem;
  }
  .compose-upload-btn.is-busy {
    pointer-events: none;
    opacity: 0.7;
  }
  .compose-upload-btn :global(svg) {
    display: block;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
