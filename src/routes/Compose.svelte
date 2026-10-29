<script lang="ts">
  import type { Event as NostrEvent } from 'nostr-tools';
  import { push, querystring } from 'svelte-spa-router';
  import { feedThreadPath } from '$lib/feed';
  import { warmNavEvent } from '$lib/nav-warm';
  import EventBody from '$lib/components/EventBody.svelte';
  import ComposeGrammarTextarea from '$lib/components/ComposeGrammarTextarea.svelte';
  import AdvancedMarkupEditor from '$lib/components/AdvancedMarkupEditor.svelte';
  import PublicationAsciidocSplitEditor from '$lib/components/PublicationAsciidocSplitEditor.svelte';
  import ComposeHashtagRows from '$lib/components/ComposeHashtagRows.svelte';
  import ComposeEventTagRows from '$lib/components/ComposeEventTagRows.svelte';
  import ComposePublicationAuthorsEditor from '$lib/components/ComposePublicationAuthorsEditor.svelte';
  import ComposePublishedOnField from '$lib/components/ComposePublishedOnField.svelte';
  import ComposeUnixTimestampField from '$lib/components/ComposeUnixTimestampField.svelte';
  import ComposePublicationSectionsEditor from '$lib/components/ComposePublicationSectionsEditor.svelte';
  import {
    DEFAULT_INDEX_DEPTH,
    type PublicationIndexDepth
  } from '$lib/publication-asciidoc-split';
  import {
    publishPublicationEvent,
    publishPublicationSplit,
    retryPublicationEvents,
    type PublishProgress
  } from '$lib/publication-publish';
  import {
    publicationPublishContinueEvents,
    publicationPublishRetryEvents,
    publicationPublishRootD,
    publicationPublishRootFromEvents
  } from '$lib/publication-publish-ui';
  import {
    clearStagedManuscript,
    deleteManuscript,
    deleteManuscriptsForPubkey,
    ensureManuscriptDb,
    clampManuscriptIndexDepth,
    flushStagedManuscript,
    getManuscriptResult,
    listManuscriptMetas,
    localDraftMatchesManuscript,
    newManuscriptId,
    onManuscriptFlushed,
    onManuscriptPersistError,
    putManuscript,
    scheduleManuscriptPersist,
    type PublicationManuscript,
    type PublicationManuscriptMeta
  } from '$lib/publication-manuscripts';
  import { libraryDocumentPath } from '$lib/metadata';
  import ComposePublicationIdentifiersEditor from '$lib/components/ComposePublicationIdentifiersEditor.svelte';
  import ComposeSpecKindsEditor from '$lib/components/ComposeSpecKindsEditor.svelte';
  import ComposePaytoEditor from '$lib/components/ComposePaytoEditor.svelte';
  import ComposeRelayListEditor from '$lib/components/ComposeRelayListEditor.svelte';
  import ComposePeopleListEditor from '$lib/components/ComposePeopleListEditor.svelte';
  import ComposeMuteListEditor from '$lib/components/ComposeMuteListEditor.svelte';
  import ComposeDirectoryMembersEditor from '$lib/components/ComposeDirectoryMembersEditor.svelte';
  import ComposeTextUserBadges from '$lib/components/ComposeTextUserBadges.svelte';
  import MentionControl from '$lib/components/MentionControl.svelte';
  import ComposeKind0Editor from '$lib/components/ComposeKind0Editor.svelte';
  import { fieldHoldsPubkeys } from '$lib/compose-field-pubkeys';
  import {
    isComposePointerTagName,
    normalizeComposeTagRow,
    normalizeComposeTagValue
  } from '$lib/compose-tag-normalize';
  import PrivateRelayListModal from '$lib/components/PrivateRelayListModal.svelte';
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
  import {
    deleteDraftWrap,
    fetchCheckpoints,
    fetchDraftWraps,
    fetchPrivateRelayListEvent,
    normalizePrivateRelayUrls,
    parsePrivateRelayList,
    privateStorageRelays,
    publishPrivateRelayList,
    saveDraftWrap,
    signerSupportsNip44,
    type DecryptedCheckpoint,
    type DecryptedDraftWrap
  } from '$lib/nip37';
  import type { EventClassId, FieldDef } from '@silberengel/kind-compose-catalog';
  import {
    OTHER_KIND_SENTINEL,
    COMPOSE_DOCUMENT_PRESETS,
    COMPOSE_METADATA_KINDS,
    composePickerGroups,
    composeKindLabel,
    composeMarkupFormat,
    showContentBox,
    isMetadataComposeKind
  } from '$lib/compose-presets';
  import {
    loadComposeDraft,
    saveComposeDraft,
    deleteComposeDraft,
    listComposeDrafts,
    clearComposeDraftsForPubkey,
    isComposeDraftEmpty,
    localDraftMatchesEncrypted,
    stageComposeDraft,
    clearStagedComposeDraft,
    flushStagedComposeDraft,
    type ComposeDraftState
  } from '$lib/compose-drafts';
  import { buildComposePartial, validateComposeForm } from '$lib/compose-build';
  import {
    pickLatestByKind,
    shouldPreloadReplaceable,
    valuesFromReplaceableEvent
  } from '$lib/compose-preload';
  import {
    canEditAsShortNote,
    canForkWikiEvent,
    eventToComposeDraft
  } from '$lib/event-compose-preload';
  import { wikiForkDraftFrom } from '$lib/wiki-fork';
  import { wikiMergeRequestDraftFromFork } from '$lib/wiki-merge';
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
  import {
    scrubClipboardTextPaste,
    scrubProseText,
    scrubTrackingUrlsInText
  } from '$lib/clean-url';
  import {
    fetchRemoteMediaFile,
    looksLikeMediaUrl,
    mediaFilesFromDataTransfer
  } from '$lib/media-paste';
  import { lruGet, lruSet } from '$lib/compose-lru';
  import { relayPool } from '$lib/nostr/pool';
  import { profileStack, writeStack } from '$lib/nostr/selector';
  import { memoryGetEvent } from '$lib/nostr/event-memory';
  import { cacheGetEvent } from '$lib/nostr/cache';
  import { fetchById } from '$lib/nostr/fetch';
  import { KIND } from '$lib/constants';
  import { buildMuteListPayload, mutedRawFromTags } from '$lib/compose-mute-list';
  import {
    applyMuteList,
    decryptPrivateMuteTags,
    looksLikeNip04Ciphertext,
    looksLikeNip44Ciphertext,
    parseMuteList
  } from '$lib/mute';

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

  /** Off by default — GrammarTool would see draft text, including later-encrypted bodies. */
  let grammarOn = $state(false);
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
  let encryptedDrafts = $state<DecryptedDraftWrap[]>([]);
  let privateRelayModalOpen = $state(false);
  let savingDraft = $state(false);
  let deletingAllDrafts = $state(false);
  let jsonCopied = $state(false);
  let jsonCopyTimer = 0;
  /** Stable NIP-37 `d` for the current compose session (re-saves replace the same wrap). */
  let activeDraftD = $state<string | null>(null);
  let draftCheckpoints = $state<DecryptedCheckpoint[]>([]);
  type EditorTab = 'edit' | 'preview' | 'json';
  let editorTab = $state<EditorTab>('edit');
  let advancedOpen = $state(false);
  /** Markup for the advanced editor. Follows the kind until the toggle changes it. */
  let editorMarkup = $state<'djot' | 'asciidoc' | null>(null);
  /** Kind 30040: link existing section pointers vs split one AsciiDoc manuscript. */
  let publicationSectionsMode = $state<'link' | 'split'>('link');
  let publicationAsciiDoc = $state('');
  /** IndexedDB id for the durable AsciiDoc manuscript (split mode). */
  let publicationManuscriptId = $state<string | null>(null);
  /** Stable `updatedAt` for the optimistic Drafts book row (avoids sort churn). */
  let publicationManuscriptListedAt = $state(0);
  let publicationIndexDepth = $state<PublicationIndexDepth>(DEFAULT_INDEX_DEPTH);
  let publicationSplitOpen = $state(false);
  let splitProgress = $state<PublishProgress | null>(null);
  /** Last split-publish attempt — Retry failed republishes missingEvents. */
  let splitRetryEvents = $state<NostrEvent[]>([]);
  /** Mid-batch sign failure — next Publish resumes with these already-signed events. */
  let splitContinueEvents = $state<NostrEvent[]>([]);
  /** Tree inputs when publish-failure state was captured — invalidate on edit. */
  let splitFailureFingerprint = $state('');
  let splitMissingDTags = $state<string[]>([]);
  /** Root 30040 from the original publish batch — used after retrying only misses. */
  let splitPublishNavRoot = $state<NostrEvent | null>(null);
  /** Full signed-batch size for success notices after a verify-only retry. */
  let splitPublishEventCount = $state(0);

  function splitPublishResumeFingerprint(): string {
    return JSON.stringify({
      source: publicationAsciiDoc,
      depth: publicationIndexDepth,
      title: values.title?.trim() || '',
      d: values.d?.trim() || ''
    });
  }

  function clearSplitContinueResume(): void {
    splitContinueEvents = [];
  }

  /** Drop retry/continue/nav state when the split tree no longer matches the failed attempt. */
  function clearSplitPublishFailureState(): void {
    splitRetryEvents = [];
    clearSplitContinueResume();
    splitMissingDTags = [];
    splitPublishNavRoot = null;
    splitPublishEventCount = 0;
    splitFailureFingerprint = '';
    formError = '';
  }
  /** Named manuscript metas from IndexedDB (Drafts list — bodies loaded on open). */
  let manuscriptDrafts = $state<PublicationManuscriptMeta[]>([]);
  /** Own kind-1 being revised as NIP-41 kind 1010 (null = normal compose / copy). */
  let shortNoteEditSource = $state<NostrEvent | null>(null);
  /** Last `?copy=` / `?edit=` id we applied, so the effect does not loop. */
  let appliedIntentKey = $state<string | null>(null);
  /** True when the form was filled from the viewer's newest replaceable of this kind. */
  let replaceablePreloaded = $state(false);
  /** Fingerprint of the pristine preload; drafts stay off until the form diverges. */
  let preloadBaseline = $state<string | null>(null);
  /**
   * While a replaceable preload is in flight the form is non-empty but the
   * baseline is not sealed yet — suppress autosave so the $effect flush cannot
   * treat the live event as a new tab draft.
   */
  let draftPersistSuspended = $state(false);
  /**
   * When a mute list has ciphertext we could not decrypt, keep it on republish so
   * private mutes are not wiped by a public-only edit.
   */
  let mutePreserveCipher = $state('');
  /**
   * Contact (and similar) lists: composer only edits public tags. Pass through any
   * existing `.content` (NIP-51 private ciphertext) so replace does not wipe it.
   */
  let contactPreserveContent = $state('');
  const documentKindSet = new Set<number>(COMPOSE_DOCUMENT_PRESETS);
  const showSaveToDraft = $derived(
    !shortNoteEditSource && !otherMode && documentKindSet.has(kind)
  );

  const fields = $derived.by((): FieldDef[] => {
    if (isCatalogued(kind)) return composerFieldSpecs(kind);
    const form = customFormForClass(otherClass);
    return (form?.fields ?? []).filter((f) => f.composer !== false) as FieldDef[];
  });
  const contentMeta = $derived(getKind(kind)?.content);
  const showBody = $derived(showContentBox(kind) || (!isCatalogued(kind) && otherLocked));
  const showHashtags = $derived(
    !shortNoteEditSource &&
      !isMetadataComposeKind(kind) &&
      (isCatalogued(kind) ? supportsHashtags(kind) : true)
  );
  const showFreeform = $derived(
    !shortNoteEditSource && kind !== 0 && (isCatalogued(kind) ? allowExtraTags(kind) : true)
  );
  const showGrammar = $derived(grammarOn && kind !== 9802 && showBody);
  const markupFormat = $derived(
    showBody ? composeMarkupFormat(kind, content, previewEvent?.tags) : null
  );
  type DraftListItem = {
    source: 'local' | 'encrypted' | 'manuscript';
    kind: number;
    mode?: string;
    /** Wrap `d`, or local form `values.d` / inner draft d. */
    d: string;
    title: string;
    label: string;
    updatedAt: number;
    wrap?: DecryptedDraftWrap;
    manuscriptId?: string;
  };

  function draftTitleFromTags(tags: string[][] | undefined): string {
    if (!tags?.length) return '';
    return (
      tags.find((t) => t[0] === 'title')?.[1]?.trim() ||
      tags.find((t) => t[0] === 'name')?.[1]?.trim() ||
      ''
    );
  }

  function formatDraftWhen(ms: number): string {
    if (!ms) return '—';
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(new Date(ms));
    } catch {
      return new Date(ms).toLocaleString();
    }
  }

  function draftDisplayName(item: DraftListItem): string {
    if (item.title) return item.title;
    if (item.source === 'encrypted') return 'Encrypted draft';
    if (item.source === 'manuscript') return 'Untitled manuscript';
    return 'Tab autosave';
  }

  const draftItems = $derived.by((): DraftListItem[] => {
    void draftRevision;
    const pk = $session.pubkey;
    const listedIds = new Set(manuscriptDrafts.map((m) => m.id));
    const manuscripts: DraftListItem[] = manuscriptDrafts.map((m) => ({
      source: 'manuscript' as const,
      kind: KIND.PUBLICATION,
      d: m.dTag,
      title: m.title,
      label: composeKindLabel(KIND.PUBLICATION),
      updatedAt: m.updatedAt,
      manuscriptId: m.id
    }));
    // Optimistic book row while the first IDB flush is still in flight.
    const liveMsId = publicationManuscriptId?.trim() ?? '';
    if (
      liveMsId &&
      publicationManuscriptListedAt > 0 &&
      !listedIds.has(liveMsId) &&
      (publicationAsciiDoc.trim() || publicationComposeHasMeta()) &&
      kind === KIND.PUBLICATION &&
      publicationSectionsMode === 'split'
    ) {
      manuscripts.push({
        source: 'manuscript',
        kind: KIND.PUBLICATION,
        d: values.d?.trim() || '',
        title: values.title?.trim() || 'Untitled manuscript',
        label: composeKindLabel(KIND.PUBLICATION),
        updatedAt: publicationManuscriptListedAt,
        manuscriptId: liveMsId
      });
      listedIds.add(liveMsId);
    }
    const local: DraftListItem[] = pk
      ? listComposeDrafts(pk)
          .flatMap((item) => {
            const draft = loadComposeDraft(pk, item.kind, item.mode);
            if (!draft) return [];
            // Hide only the autosave that mirrors a specific encrypted wrap (same d / body).
            if (encryptedDrafts.some((wrap) => localDraftMatchesEncrypted(draft, wrap))) {
              return [];
            }
            // Hide thin tab shell covered by a book row (IDB list or live optimistic).
            const mid = String(draft.publicationManuscriptId ?? '').trim();
            if (mid && listedIds.has(mid)) return [];
            const d = String(draft.values.d ?? '').trim();
            const title = String(draft.values.title ?? draft.values.name ?? '').trim();
            return [
              {
                source: 'local' as const,
                kind: item.kind,
                mode: item.mode,
                d,
                title,
                label: composeKindLabel(item.kind),
                updatedAt: item.updatedAt
              }
            ];
          })
      : [];
    const encrypted: DraftListItem[] = encryptedDrafts.map((wrap) => {
      const innerD =
        wrap.draft?.tags.find((t) => t[0] === 'd')?.[1]?.trim() ?? '';
      const d = wrap.d.trim() || innerD;
      return {
        source: 'encrypted' as const,
        kind: wrap.draftKind,
        d,
        title: draftTitleFromTags(wrap.draft?.tags),
        label: composeKindLabel(wrap.draftKind),
        updatedAt: wrap.updatedAt,
        wrap
      };
    });
    return [...manuscripts, ...encrypted, ...local].sort((a, b) => b.updatedAt - a.updatedAt);
  });

  const revisionHistory = $derived(
    draftCheckpoints.map((cp) => ({
      created_at: cp.created_at,
      content: cp.content,
      id: cp.event.id,
      kind: cp.draft?.kind
    }))
  );

  function refreshDraftList(): void {
    draftRevision += 1;
  }

  async function refreshManuscriptDrafts(): Promise<void> {
    const pk = $session.pubkey;
    if (!pk) {
      manuscriptDrafts = [];
      refreshDraftList();
      return;
    }
    try {
      manuscriptDrafts = await listManuscriptMetas(pk);
    } catch {
      manuscriptDrafts = [];
    }
    refreshDraftList();
  }

  async function refreshEncryptedDrafts(): Promise<void> {
    if (!$session.pubkey) {
      encryptedDrafts = [];
      return;
    }
    try {
      encryptedDrafts = await fetchDraftWraps();
    } catch {
      encryptedDrafts = [];
    }
    await refreshManuscriptDrafts();
    refreshDraftList();
  }

  /** True when split-mode catalog fields differ from kind defaults / empty shell. */
  function publicationComposeHasMeta(): boolean {
    const baseline = emptyValuesFor(KIND.PUBLICATION);
    for (const [id, raw] of Object.entries(values)) {
      const v = String(raw ?? '').trim();
      if (!v) continue;
      if (v !== String(baseline[id] ?? '').trim()) return true;
    }
    if (content.trim()) return true;
    if (cleanedHashtags(hashtagRows).length) return true;
    if (imetaTags.some((t) => t.some((c) => String(c).trim()))) return true;
    if (cleanedFreeformTags(freeformTags).length) return true;
    return false;
  }

  /** Pure snapshot of the live split manuscript (does not mutate reactive state). */
  function manuscriptSnapshot(): PublicationManuscript | null {
    const pk = $session.pubkey;
    if (!pk) return null;
    if (kind !== KIND.PUBLICATION || publicationSectionsMode !== 'split') return null;
    const existingId = publicationManuscriptId?.trim() || '';
    const body = publicationAsciiDoc;
    // Allow meta-only rows (authors/summary before AsciiDoc) and empty-body clears
    // once an id exists; do not mint a blank manuscript with no metadata.
    if (!body.trim() && !existingId && !publicationComposeHasMeta()) return null;
    const hashtags = cleanedHashtags(hashtagRows);
    const freeform = cleanedFreeformTags(freeformTags);
    const imeta = imetaTags
      .map((t) => [...t])
      .filter((t) => t.some((c) => String(c).trim()));
    return {
      id: existingId || newManuscriptId(),
      pubkey: pk,
      title: values.title?.trim() || 'Untitled manuscript',
      dTag: values.d?.trim() || '',
      source: body,
      maxIndexLevel: publicationIndexDepth,
      updatedAt: Date.now(),
      composeValues: { ...values },
      ...(content.trim() ? { composeContent: content } : {}),
      ...(hashtags.length ? { composeHashtags: hashtags } : {}),
      ...(imeta.length ? { composeImetaTags: imeta } : {}),
      ...(freeform.length ? { composeFreeformTags: freeform } : {})
    };
  }

  function persistManuscript(opts?: { immediate?: boolean }): void {
    const snap = manuscriptSnapshot();
    if (!snap) return;
    // Commit a newly minted id here — not inside the pure snapshot.
    if (!publicationManuscriptId?.trim()) {
      publicationManuscriptId = snap.id;
      publicationManuscriptListedAt = snap.updatedAt;
    } else if (!publicationManuscriptListedAt) {
      publicationManuscriptListedAt = snap.updatedAt;
    }
    if (opts?.immediate) {
      clearStagedManuscript();
      void putAndRefreshManuscript(snap);
      return;
    }
    scheduleManuscriptPersist(snap);
  }

  /** Drop a listed meta that has no body (corrupt / mid-migrate ghost). */
  async function purgeOrphanManuscript(id: string): Promise<void> {
    if (!id.trim()) return;
    try {
      await deleteManuscript(id);
    } catch (err) {
      showNotice(
        err instanceof Error
          ? err.message
          : 'Could not remove the damaged manuscript from local storage.'
      );
      return;
    }
    await refreshManuscriptDrafts();
  }

  async function putAndRefreshManuscript(snap: PublicationManuscript): Promise<boolean> {
    try {
      await putManuscript(snap);
      await refreshManuscriptDrafts();
      return true;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not save the AsciiDoc manuscript locally.';
      showNotice(message);
      return false;
    }
  }

  async function loadCheckpointsFor(d: string | null): Promise<void> {
    if (!d || !$session.pubkey) {
      draftCheckpoints = [];
      return;
    }
    try {
      draftCheckpoints = await fetchCheckpoints(d);
    } catch {
      draftCheckpoints = [];
    }
  }

  function newDraftId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `draft-${Date.now().toString(36)}`;
  }

  function resolveDraftD(): string {
    const fromForm = values.d?.trim();
    if (fromForm) return fromForm;
    // Keep an explicit empty `d` (e.g. Primal wraps) so re-saves replace the same addressable.
    if (activeDraftD != null) return activeDraftD;
    const id = newDraftId();
    activeDraftD = id;
    return id;
  }

  async function ensurePrivateRelaysOrPrompt(): Promise<boolean> {
    const existing = await fetchPrivateRelayListEvent();
    if (existing) {
      const urls = await privateStorageRelays();
      if (urls.length) return true;
    }
    privateRelayModalOpen = true;
    return false;
  }

  async function saveToDraft(): Promise<void> {
    formError = '';
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    if (!signerSupportsNip44()) {
      formError = 'Your signer does not support NIP-44 encryption (required for drafts).';
      return;
    }
    if (!(await ensurePrivateRelaysOrPrompt())) return;

    savingDraft = true;
    try {
      const state = formState();
      const partial = buildComposePartial(state);
      const d = resolveDraftD();
      if (!values.d?.trim() && isCatalogued(kind)) {
        // Keep addressable forms aligned with the wrap d when the field was empty.
        const specs = composerFieldSpecs(kind);
        if (specs.some((f) => f.id === 'd' || f.tag === 'd')) {
          values = { ...values, d };
        }
      }
      const draftEvent = {
        kind: partial.kind,
        content: partial.content,
        tags: partial.tags,
        created_at: Math.floor(Date.now() / 1000)
      };
      const result = await saveDraftWrap({
        draftEvent,
        d
      });
      if (!result) {
        formError = consumeSignFailure() ?? 'Could not save draft.';
        return;
      }
      activeDraftD = d;
      // Drop the tab autosave for this kind — the encrypted wrap is the draft of record.
      deleteComposeDraft($session.pubkey, draftEvent.kind);
      // Paint the lock-badge row immediately from the signed wrap (relay round-trip may lag).
      const optimistic: DecryptedDraftWrap = {
        wrap: result.wrap,
        d,
        draftKind: draftEvent.kind,
        draft: draftEvent,
        deleted: false,
        updatedAt: result.wrap.created_at * 1000
      };
      encryptedDrafts = [
        optimistic,
        ...encryptedDrafts.filter((w) => w.d !== d)
      ];
      refreshDraftList();
      draftListOpen = true;
      showNotice('Draft saved.', true);
      await refreshEncryptedDrafts();
      await loadCheckpointsFor(d);
    } catch (err) {
      formError = err instanceof Error ? err.message : String(err);
    } finally {
      savingDraft = false;
    }
  }

  function restoreEncryptedDraft(wrap: DecryptedDraftWrap): void {
    if (!wrap.draft) {
      formError = 'Could not decrypt that draft.';
      return;
    }
    markReplaceablePreloaded(false);
    const synthetic = {
      id: wrap.wrap.id,
      pubkey: wrap.wrap.pubkey,
      created_at: wrap.wrap.created_at,
      kind: wrap.draft.kind,
      tags: wrap.draft.tags,
      content: wrap.draft.content,
      sig: ''
    } as NostrEvent;
    applyDraft(eventToComposeDraft(synthetic));
    activeDraftD = wrap.d;
    draftListOpen = false;
    void loadCheckpointsFor(wrap.d);
  }

  async function deleteEncryptedDraft(wrap: DecryptedDraftWrap): Promise<void> {
    formError = '';
    try {
      const openMatches =
        activeDraftD === wrap.d ||
        (!!wrap.d && values.d?.trim() === wrap.d) ||
        localDraftMatchesEncrypted(snapshotDraft(), wrap);
      await deleteDraftWrap(wrap.d, wrap.draftKind);
      const pk = $session.pubkey;
      if (pk) {
        // Drop the tab autosave mirror or delete looks like a no-op in the list.
        const local = loadComposeDraft(pk, wrap.draftKind);
        if (local && localDraftMatchesEncrypted(local, wrap)) {
          deleteComposeDraft(pk, wrap.draftKind);
        }
      }
      if (openMatches) abandonOpenComposeShell();
      else if (activeDraftD === wrap.d) {
        activeDraftD = null;
        draftCheckpoints = [];
      }
      await refreshEncryptedDrafts();
    } catch (err) {
      formError = err instanceof Error ? err.message : String(err);
    }
  }

  function deleteLocalDraftItem(item: DraftListItem): void {
    const pk = $session.pubkey;
    if (!pk || item.source !== 'local') return;
    const mode = item.mode ?? 'compose';
    deleteComposeDraft(pk, item.kind, mode);
    // Autosave would immediately rewrite the draft while the form still holds it.
    if (!otherMode && !shortNoteEditSource && item.kind === kind && mode === 'compose') {
      abandonOpenComposeShell();
    }
    refreshDraftList();
    draftListOpen =
      listComposeDrafts(pk).length > 0 ||
      encryptedDrafts.length > 0 ||
      manuscriptDrafts.length > 0;
  }

  async function deleteManuscriptDraftItem(item: DraftListItem): Promise<void> {
    const pk = $session.pubkey;
    const id = item.manuscriptId?.trim();
    if (!pk || item.source !== 'manuscript' || !id) return;
    // Id only — a shared d-tag must not abandon a different open manuscript.
    const openMatches = publicationManuscriptId === id;
    try {
      await deleteManuscript(id);
    } catch (err) {
      formError =
        err instanceof Error
          ? err.message
          : 'Could not delete that manuscript from local storage.';
      return;
    }
    if (openMatches) abandonOpenComposeShell();
    await refreshManuscriptDrafts();
    draftListOpen =
      listComposeDrafts(pk).length > 0 ||
      encryptedDrafts.length > 0 ||
      manuscriptDrafts.length > 0;
  }

  async function restoreManuscriptDraft(item: DraftListItem): Promise<void> {
    const id = item.manuscriptId?.trim();
    if (!id) return;
    persistCurrent({ immediateManuscript: true });
    const got = await getManuscriptResult(id);
    if (got.status === 'error') {
      formError = got.error.message || 'Could not read that manuscript from this browser.';
      return;
    }
    if (got.status === 'orphan') {
      formError = 'That manuscript is damaged and was removed from local storage.';
      await purgeOrphanManuscript(id);
      return;
    }
    if (got.status === 'missing') {
      formError = 'That manuscript is no longer stored in this browser.';
      await refreshManuscriptDrafts();
      return;
    }
    const row = got.manuscript;
    markReplaceablePreloaded(false);
    kind = KIND.PUBLICATION;
    pickerValue = KIND.PUBLICATION;
    otherMode = false;
    otherLocked = false;
    // Prefer metadata stored on the manuscript; fall back to the matching tab
    // autosave (book rows hide that shell in the Drafts list).
    const pk = $session.pubkey;
    const saved = pk ? loadComposeDraft(pk, KIND.PUBLICATION) : null;
    const tabMatch =
      saved && localDraftMatchesManuscript(saved, row) ? saved : null;
    const storedValues = row.composeValues ?? tabMatch?.values ?? {};
    const titleFromRow =
      row.title && row.title !== 'Untitled manuscript' ? row.title : '';
    values = {
      ...emptyValuesFor(KIND.PUBLICATION),
      ...storedValues,
      ...(titleFromRow ? { title: titleFromRow } : {}),
      ...(row.dTag ? { d: row.dTag } : {})
    };
    content = row.composeContent ?? tabMatch?.content ?? '';
    hashtagRows =
      row.composeHashtags?.length
        ? [...row.composeHashtags]
        : tabMatch?.hashtags?.length
          ? [...tabMatch.hashtags]
          : [''];
    imetaTags =
      row.composeImetaTags?.length
        ? row.composeImetaTags.map((t) => [...t])
        : tabMatch?.imetaTags?.length
          ? tabMatch.imetaTags.map((t) => [...t])
          : [];
    freeformTags =
      row.composeFreeformTags?.length
        ? row.composeFreeformTags.map((t) =>
            t.length >= 2 ? [...t] : [t[0] ?? '', '']
          )
        : tabMatch?.freeformTags?.length
          ? tabMatch.freeformTags.map((t) =>
              t.length >= 2 ? [...t] : [t[0] ?? '', '']
            )
          : [['', '']];
    kind0Tags = emptyKind0TagRows();
    publicationSectionsMode = 'split';
    publicationAsciiDoc = row.source;
    publicationManuscriptId = row.id;
    publicationManuscriptListedAt = row.updatedAt;
    // IDB depth is authoritative after Ideal / splitter edits; tab shell can lag.
    publicationIndexDepth = clampManuscriptIndexDepth(row.maxIndexLevel);
    editorMarkup = 'asciidoc';
    activeDraftD = row.dTag || values.d?.trim() || null;
    draftListOpen = false;
    formError = '';
    editorTab = 'edit';
    bumpPreview();
    persistCurrent({ refreshList: true });
  }

  async function copyPreviewJson(): Promise<void> {
    if (!previewJson) return;
    try {
      await navigator.clipboard.writeText(previewJson);
      jsonCopied = true;
      window.clearTimeout(jsonCopyTimer);
      jsonCopyTimer = window.setTimeout(() => {
        jsonCopied = false;
      }, 1200);
    } catch {
      showNotice('Could not copy JSON.');
    }
  }

  async function deleteAllDrafts(): Promise<void> {
    const pk = $session.pubkey;
    if (!pk || deletingAllDrafts) return;
    formError = '';
    deletingAllDrafts = true;
    try {
      // Re-fetch so Primal / outbox wraps not yet painted are included.
      await refreshEncryptedDrafts();
      const wraps = [...encryptedDrafts];
      clearComposeDraftsForPubkey(pk);
      const errors: string[] = [];
      try {
        await deleteManuscriptsForPubkey(pk);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
      const seen = new Set<string>();
      for (const wrap of wraps) {
        const key = `${wrap.d}\0${wrap.draftKind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          await deleteDraftWrap(wrap.d, wrap.draftKind);
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }
      }
      activeDraftD = null;
      draftCheckpoints = [];
      // Wipe the open form so auto-persist cannot resurrect a local draft.
      clearForm();
      await refreshEncryptedDrafts();
      await refreshManuscriptDrafts();
      refreshDraftList();
      draftListOpen =
        encryptedDrafts.length > 0 ||
        listComposeDrafts(pk).length > 0 ||
        manuscriptDrafts.length > 0;
      if (errors.length) {
        formError = `Some encrypted drafts could not be deleted: ${errors[0]}`;
      } else {
        showNotice('All drafts deleted.', true);
      }
    } finally {
      deletingAllDrafts = false;
    }
  }

  function emptyValuesFor(nextKind: number): Record<string, string> {
    const out: Record<string, string> = {};
    const specs = isCatalogued(nextKind) ? composerFieldSpecs(nextKind) : [];
    for (const f of specs) {
      if (f.default != null) out[f.id] = String(f.default);
      else out[f.id] = '';
    }
    // Catalog hides members (`widget: custom`); still keep a bindable slot.
    if (nextKind === KIND.DIRECTORY && out.members == null) out.members = '';
    return out;
  }

  function cleanedHashtags(rows: string[]): string[] {
    return rows.map((t) => t.replace(/^#/, '').trim()).filter(Boolean);
  }

  function cleanedFreeformTags(rows: string[][]): string[][] {
    return rows
      .map((row) =>
        normalizeComposeTagRow(row.map((c) => c.trim()).filter((c, i) => i === 0 || c.length > 0))
      )
      .filter((row) => row.length >= 1 && row[0]!.length > 0)
      .map((row) => {
        // Drop trailing empty parts but keep intentional empty middle slots? Keep non-empty only after name.
        const name = row[0]!;
        const rest = row.slice(1).filter(Boolean);
        return normalizeComposeTagRow([name, ...rest]);
      });
  }

  function resetEditorMarkup(nextKind: number, nextContent: string, nextTags?: string[][]) {
    editorMarkup = composeMarkupFormat(nextKind, nextContent, nextTags);
  }

  function snapshotDraft(): ComposeDraftState {
    const draft: ComposeDraftState = {
      kind,
      content,
      values: { ...values },
      hashtags: cleanedHashtags(hashtagRows),
      imetaTags: imetaTags.map((t) => [...t]),
      freeformTags: cleanedFreeformTags(freeformTags),
      kind0Tags: kind0Tags.map((t) => [...t]),
      markup: editorMarkup,
      updatedAt: Date.now()
    };
    // Only attach split-manuscript fields on kind 30040 split mode — otherwise a
    // kind switch leaves a phantom autosave that hydrates AsciiDoc under the wrong kind.
    if (kind === KIND.PUBLICATION && publicationSectionsMode === 'split') {
      draft.publicationSectionsMode = 'split';
      draft.publicationManuscriptId = publicationManuscriptId ?? undefined;
      draft.publicationAsciiDocLen = publicationAsciiDoc.length;
      draft.publicationIndexDepth = publicationIndexDepth;
    }
    return draft;
  }

  function draftFingerprint(
    d: {
      kind: number;
      content: string;
      values: Record<string, string>;
      hashtags: string[];
      imetaTags: string[][];
      freeformTags: string[][];
      kind0Tags?: string[][];
      markup?: 'djot' | 'asciidoc' | null;
      publicationSectionsMode?: 'link' | 'split';
      publicationAsciiDoc?: string;
      publicationAsciiDocLen?: number;
      publicationManuscriptId?: string;
      publicationIndexDepth?: 2 | 3 | 4;
    } = snapshotDraft()
  ): string {
    // Length comes only from `d` — never the live outer `publicationAsciiDoc`,
    // so stored-draft vs baseline comparisons stay stable over time.
    const asciiLen =
      typeof d.publicationAsciiDoc === 'string'
        ? d.publicationAsciiDoc.length
        : typeof d.publicationAsciiDocLen === 'number'
          ? d.publicationAsciiDocLen
          : 0;
    return JSON.stringify({
      kind: d.kind,
      content: d.content,
      values: d.values,
      hashtags: d.hashtags,
      imetaTags: d.imetaTags,
      freeformTags: d.freeformTags,
      kind0Tags: d.kind0Tags,
      markup: d.markup,
      publicationSectionsMode: d.publicationSectionsMode,
      publicationManuscriptId: d.publicationManuscriptId,
      publicationAsciiDocLen: asciiLen,
      publicationIndexDepth: d.publicationIndexDepth
    });
  }

  function markReplaceablePreloaded(on: boolean): void {
    replaceablePreloaded = on;
    preloadBaseline = on ? draftFingerprint() : null;
  }

  function applyDraft(d: {
    kind: number;
    content: string;
    values: Record<string, string>;
    hashtags: string[];
    imetaTags: string[][];
    freeformTags: string[][];
    kind0Tags?: string[][];
    markup?: 'djot' | 'asciidoc' | null;
    publicationSectionsMode?: 'link' | 'split';
    publicationAsciiDoc?: string;
    publicationManuscriptId?: string;
    publicationIndexDepth?: 2 | 3 | 4;
    updatedAt?: number;
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
    if (d.kind === KIND.PUBLICATION && d.publicationSectionsMode === 'split') {
      publicationSectionsMode = 'split';
      publicationAsciiDoc = d.publicationAsciiDoc ?? '';
      publicationManuscriptId = d.publicationManuscriptId?.trim() || null;
      publicationManuscriptListedAt = publicationManuscriptId
        ? publicationManuscriptListedAt || d.updatedAt || Date.now()
        : 0;
      publicationIndexDepth = clampManuscriptIndexDepth(d.publicationIndexDepth);
    } else {
      // Drop leaked manuscript pointers from older autosaves on non-30040 kinds.
      clearPublicationManuscriptFields();
    }
    editorMarkup =
      d.markup === 'djot' || d.markup === 'asciidoc'
        ? d.markup
        : composeMarkupFormat(d.kind, d.content, d.freeformTags);
  }

  function clearPublicationManuscriptFields(): void {
    publicationSectionsMode = 'link';
    publicationAsciiDoc = '';
    publicationManuscriptId = null;
    publicationManuscriptListedAt = 0;
    publicationIndexDepth = DEFAULT_INDEX_DEPTH;
    publicationSplitOpen = false;
    splitProgress = null;
    clearSplitPublishFailureState();
    clearStagedManuscript();
  }

  /** Load AsciiDoc from IndexedDB (or migrate a legacy sessionStorage body). */
  async function hydrateManuscriptForDraft(d: ComposeDraftState): Promise<void> {
    if (d.kind !== KIND.PUBLICATION || d.publicationSectionsMode !== 'split') return;
    const mid = d.publicationManuscriptId?.trim();
    if (mid) {
      const got = await getManuscriptResult(mid);
      if (got.status === 'ok') {
        const row = got.manuscript;
        publicationManuscriptId = row.id;
        publicationManuscriptListedAt = row.updatedAt;
        publicationAsciiDoc = row.source;
        publicationIndexDepth = row.maxIndexLevel;
        publicationSectionsMode = 'split';
        // Fill any catalog fields missing from the tab autosave from durable IDB meta.
        if (row.composeValues) {
          const merged = { ...values };
          for (const [k, v] of Object.entries(row.composeValues)) {
            if (!String(merged[k] ?? '').trim() && String(v ?? '').trim()) {
              merged[k] = v;
            }
          }
          values = merged;
        }
        if (row.title && row.title !== 'Untitled manuscript' && !values.title?.trim()) {
          values = { ...values, title: row.title };
        }
        if (row.dTag && !values.d?.trim()) {
          values = { ...values, d: row.dTag };
        }
        if (row.composeContent?.trim() && !content.trim()) {
          content = row.composeContent;
        }
        if (row.composeHashtags?.length && !hashtagRows.some((h) => h.trim())) {
          hashtagRows = [...row.composeHashtags];
        }
        if (row.composeImetaTags?.length && !imetaTags.length) {
          imetaTags = row.composeImetaTags.map((t) => [...t]);
        }
        if (
          row.composeFreeformTags?.length &&
          !freeformTags.some((rowTags) => rowTags.some((c) => c.trim()))
        ) {
          freeformTags = row.composeFreeformTags.map((t) =>
            t.length >= 2 ? [...t] : [t[0] ?? '', '']
          );
        }
        return;
      }
      if (got.status === 'error') {
        // Do not purge — a transient IDB failure must not destroy the manuscript.
        formError =
          got.error.message || 'Could not read the local AsciiDoc manuscript. Try again.';
        return;
      }
      // missing or orphan — clear pointer; purge only true orphans (meta, no body).
      publicationManuscriptId = null;
      publicationManuscriptListedAt = 0;
      publicationAsciiDoc = '';
      if (got.status === 'orphan') {
        await purgeOrphanManuscript(mid);
      }
      if (!d.publicationAsciiDoc?.trim()) {
        formError =
          got.status === 'orphan'
            ? 'That manuscript is damaged and was removed from local storage.'
            : 'That manuscript is no longer stored in this browser.';
        if ($session.pubkey) {
          saveComposeDraft($session.pubkey, {
            ...d,
            publicationManuscriptId: undefined,
            publicationAsciiDoc: undefined
          });
        }
        return;
      }
    }
    const legacy = d.publicationAsciiDoc?.trim();
    if (legacy && $session.pubkey) {
      const id = newManuscriptId();
      const legacyHashtags = cleanedHashtags(d.hashtags ?? []);
      const legacyFreeform = cleanedFreeformTags(d.freeformTags ?? []);
      const legacyImeta = (d.imetaTags ?? [])
        .map((t) => [...t])
        .filter((t) => t.some((c) => String(c).trim()));
      const snap: PublicationManuscript = {
        id,
        pubkey: $session.pubkey,
        title: values.title?.trim() || 'Untitled manuscript',
        dTag: values.d?.trim() || '',
        source: d.publicationAsciiDoc!,
        maxIndexLevel: clampManuscriptIndexDepth(d.publicationIndexDepth),
        updatedAt: Date.now(),
        composeValues: { ...values },
        ...(content.trim() ? { composeContent: content } : {}),
        ...(legacyHashtags.length ? { composeHashtags: legacyHashtags } : {}),
        ...(legacyImeta.length ? { composeImetaTags: legacyImeta } : {}),
        ...(legacyFreeform.length ? { composeFreeformTags: legacyFreeform } : {})
      };
      try {
        await putManuscript(snap);
      } catch (err) {
        // Keep the legacy body in the tab autosave so a quota/IDB failure is recoverable.
        formError =
          err instanceof Error
            ? err.message
            : 'Could not migrate the AsciiDoc manuscript into local storage.';
        publicationAsciiDoc = d.publicationAsciiDoc!;
        publicationSectionsMode = 'split';
        publicationIndexDepth = snap.maxIndexLevel;
        return;
      }
      publicationManuscriptId = id;
      publicationManuscriptListedAt = snap.updatedAt;
      publicationAsciiDoc = snap.source;
      publicationSectionsMode = 'split';
      publicationIndexDepth = snap.maxIndexLevel;
      // Rewrite tab autosave without the body.
      saveComposeDraft($session.pubkey, {
        ...d,
        publicationManuscriptId: id,
        publicationAsciiDoc: undefined,
        publicationSectionsMode: 'split',
        publicationIndexDepth: snap.maxIndexLevel
      });
      await refreshManuscriptDrafts();
    }
  }

  /** Drop a tab autosave that is only a mirror of the untouched live replaceable. */
  function scrubMirroredReplaceableAutosave(): void {
    const pk = $session.pubkey;
    if (!pk || !replaceablePreloaded || !preloadBaseline) return;
    if (draftFingerprint() !== preloadBaseline) return;
    const mirrored = loadComposeDraft(pk, kind);
    if (!mirrored || draftFingerprint(mirrored) !== preloadBaseline) return;
    deleteComposeDraft(pk, kind);
    refreshDraftList();
  }

  function persistCurrent(opts?: { refreshList?: boolean; immediateManuscript?: boolean }) {
    const pk = $session.pubkey;
    if (!pk || otherMode || shortNoteEditSource || draftPersistSuspended) return;
    if (replaceablePreloaded && preloadBaseline) {
      if (draftFingerprint() === preloadBaseline) {
        // Untouched preload of an existing list/replaceable — not a draft.
        scrubMirroredReplaceableAutosave();
        return;
      }
      // User edited the preloaded form; start auto-drafting from here.
      replaceablePreloaded = false;
      preloadBaseline = null;
    }
    persistManuscript({ immediate: opts?.immediateManuscript });
    const draft = snapshotDraft();
    // Empty live shell must not wipe a tab autosave the user has not restored
    // yet (bootstrap / HMR remount starts blank). clearForm() deletes explicitly.
    if (isComposeDraftEmpty(draft, emptyValuesFor(draft.kind))) return;
    // Stage before write so HMR teardown can still flush if the debounced
    // timer is cleared first.
    stageComposeDraft(pk, draft);
    saveComposeDraft(pk, draft);
    if (opts?.refreshList !== false) refreshDraftList();
  }

  /**
   * Empty the open form in place (keep kind) so debounce/pagehide cannot
   * resurrect a draft the user just deleted from the list.
   */
  function abandonOpenComposeShell(): void {
    clearStagedComposeDraft();
    activeDraftD = null;
    draftCheckpoints = [];
    content = '';
    values = emptyValuesFor(kind);
    hashtagRows = [''];
    imetaTags = [];
    freeformTags = [['', '']];
    kind0Tags = emptyKind0TagRows();
    clearPublicationManuscriptFields();
    existingKind0 = {};
    formError = '';
    grammarIssues = [];
    grammarCheckedSource = '';
    editorTab = 'edit';
    advancedOpen = false;
    shortNoteEditSource = null;
    markReplaceablePreloaded(false);
    resetEditorMarkup(kind, '');
    bumpPreview();
  }

  /** Wipe the form and return the kind picker to the default short note. */
  function clearForm(): void {
    const pk = $session.pubkey;
    const previousKind = kind;
    clearStagedComposeDraft();
    clearStagedManuscript();
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
    clearPublicationManuscriptFields();
    existingKind0 = {};
    formError = '';
    grammarIssues = [];
    grammarCheckedSource = '';
    editorTab = 'edit';
    advancedOpen = false;
    editorMarkup = null;
    shortNoteEditSource = null;
    appliedIntentKey = null;
    activeDraftD = null;
    draftCheckpoints = [];
    markReplaceablePreloaded(false);
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

  async function applyForkIntent(source: NostrEvent): Promise<void> {
    if (!canForkWikiEvent(source.kind)) {
      formError = 'Only wiki and spec articles can be forked this way.';
      return;
    }
    persistCurrent();
    shortNoteEditSource = null;
    applyDraft(wikiForkDraftFrom(source));
    formError = '';
    editorTab = 'edit';
    bumpPreview();
  }

  async function applyMergeIntent(source: NostrEvent): Promise<void> {
    const built = wikiMergeRequestDraftFromFork(source);
    if (!built) {
      formError = 'That event is not a fork that can request a merge.';
      return;
    }
    persistCurrent();
    shortNoteEditSource = null;
    applyDraft({
      kind: KIND.WIKI_MERGE_REQUEST,
      content: '',
      values: built.values,
      hashtags: [],
      imetaTags: [],
      freeformTags: []
    });
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

  /** Load the signed-in viewer's live replaceable into the open form. */
  async function applyReplaceablePreload(nextKind: number): Promise<boolean> {
    const pk = $session.pubkey;
    if (!pk || !shouldPreloadReplaceable(nextKind)) return false;

    if (nextKind === KIND.PRIVATE_RELAY_LIST) {
      try {
        const live =
          pickLatestByKind(session.getMetadata(), nextKind) ??
          (await fetchPrivateRelayListEvent());
        if (live) {
          const urls = await parsePrivateRelayList(live);
          values = {
            ...emptyValuesFor(nextKind),
            relays: urls.join('\n')
          };
          return true;
        }
      } catch {
        /* ignore decrypt / network */
      }
      return false;
    }

    let live = pickLatestByKind(session.getMetadata(), nextKind);
    if (!live) {
      try {
        const relays = [...new Set([...writeStack(), ...profileStack()])];
        const hits = await relayPool.query(
          relays.length ? relays : profileStack(),
          [{ authors: [pk], kinds: [nextKind], limit: 1 }],
          4000,
          4
        );
        live = hits[0] ?? null;
        if (live) session.rememberEvent(live);
      } catch {
        /* ignore */
      }
    }
    if (!live) return false;

    const pre = valuesFromReplaceableEvent(live);
    content = pre.content;
    values = { ...emptyValuesFor(nextKind), ...pre.values };

    contactPreserveContent = '';
    if (nextKind === KIND.CONTACT_LIST) {
      // Follow UI is public `p` tags only — keep encrypted private follows intact.
      contactPreserveContent = live.content ?? '';
    }

    if (nextKind === KIND.MUTE) {
      mutePreserveCipher = '';
      try {
        const privateTags = await decryptPrivateMuteTags(live);
        values = {
          ...values,
          muted: mutedRawFromTags(live.tags, privateTags)
        };
        const ct = (live.content ?? '').trim();
        if (
          ct &&
          !privateTags.length &&
          !ct.startsWith('[') &&
          (looksLikeNip44Ciphertext(ct) || looksLikeNip04Ciphertext(ct))
        ) {
          mutePreserveCipher = live.content;
        }
      } catch {
        const ct = (live.content ?? '').trim();
        if (ct && !ct.startsWith('[')) mutePreserveCipher = live.content;
      }
    }

    if (pre.existingKind0) existingKind0 = pre.existingKind0;
    if (pre.kind0Tags) kind0Tags = pre.kind0Tags.map((t) => [...t]);
    if (pre.hashtags?.length) hashtagRows = [...pre.hashtags];
    if (pre.imetaTags?.length) imetaTags = pre.imetaTags.map((t) => [...t]);
    if (pre.freeformTags?.length) {
      freeformTags = pre.freeformTags.map((t) =>
        t.length >= 2 ? [...t] : [t[0] ?? '', '']
      );
    } else if (!isCatalogued(nextKind) && live.tags.length) {
      // Uncatalogued replaceables: surface every tag as freeform rows.
      freeformTags = live.tags.map((t) => (t.length >= 2 ? [...t] : [t[0] ?? '', '']));
    }
    return true;
  }

  /** Switch kind with a blank form. Drafts are restored only via the Drafts list. */
  async function loadKind(nextKind: number) {
    persistCurrent({ immediateManuscript: true });
    draftPersistSuspended = true;
    clearStagedComposeDraft();
    try {
      kind = nextKind;
      pickerValue = nextKind;
      otherMode = false;
      otherLocked = false;
      otherError = '';
      formError = '';
      grammarIssues = [];
      activeDraftD = null;
      markReplaceablePreloaded(false);
      mutePreserveCipher = '';
      contactPreserveContent = '';
      content = '';
      values = emptyValuesFor(nextKind);
      hashtagRows = [''];
      imetaTags = [];
      freeformTags = [['', '']];
      kind0Tags = emptyKind0TagRows();
      existingKind0 = {};
      // Kind switch starts blank — do not carry split AsciiDoc into the next form.
      clearPublicationManuscriptFields();
      const preloaded = await applyReplaceablePreload(nextKind);
      resetEditorMarkup(nextKind, content, freeformTags);
      markReplaceablePreloaded(preloaded);
    } finally {
      draftPersistSuspended = false;
    }
    bumpPreview();
    scrubMirroredReplaceableAutosave();
  }

  async function restoreLocalDraft(nextKind: number, mode = 'compose'): Promise<void> {
    const pk = $session.pubkey;
    if (!pk) return;
    persistCurrent({ immediateManuscript: true });
    const saved = loadComposeDraft(pk, nextKind, mode);
    if (!saved) {
      formError = 'That draft is no longer in this tab.';
      refreshDraftList();
      return;
    }
    markReplaceablePreloaded(false);
    applyDraft(saved);
    await hydrateManuscriptForDraft(saved);
    activeDraftD = saved.values.d?.trim() || null;
    draftListOpen = false;
    formError = '';
    editorTab = 'edit';
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
      markReplaceablePreloaded(false);
      return;
    }
    void loadKind(selected);
  }

  async function validateOtherKind() {
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

    persistCurrent({ immediateManuscript: true });
    draftPersistSuspended = true;
    clearStagedComposeDraft();
    try {
      otherLocked = true;
      otherMode = false;
      kind = n;
      pickerValue = OTHER_KIND_SENTINEL;
      editorTab = 'edit';
      formError = '';
      grammarIssues = [];
      activeDraftD = null;
      markReplaceablePreloaded(false);

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
      existingKind0 = {};
      // Match loadKind — do not carry split AsciiDoc / manuscript id into Other kinds.
      clearPublicationManuscriptFields();
      const preloaded = await applyReplaceablePreload(n);
      resetEditorMarkup(n, content, freeformTags);
      markReplaceablePreloaded(preloaded);
    } finally {
      draftPersistSuspended = false;
    }
    bumpPreview();
    scrubMirroredReplaceableAutosave();
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
      existingKind0,
      markup: editorMarkup
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
    void editorMarkup;
    void shortNoteEditSource;
    void publicationSectionsMode;
    void publicationAsciiDoc;
    void publicationManuscriptId;
    void publicationIndexDepth;
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
    return () => {
      clearTimeout(t);
      // Vite HMR / route leave clears the timer before pagehide; flush now so
      // the last keystrokes are not lost. Skip list refresh to avoid thrash.
      persistCurrent({ refreshList: false });
      flushStagedComposeDraft();
    };
  });

  // Belt-and-suspenders with module-level listeners in compose-drafts.ts.
  // Component listeners still help while Compose is mounted (tab switch).
  $effect(() => {
    const flush = () => {
      persistCurrent({ immediateManuscript: true });
      void flushStagedManuscript();
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
    };
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
    if (!markupFormat) advancedOpen = false;
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

  async function uploadBlossomFile(file: File): Promise<{ url: string; mime: string; name: string }> {
    if (!$session.pubkey) {
      openLoginDialog();
      throw new Error('Sign in to upload.');
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
      const url = result.url;
      return { url, mime: file.type || '', name: file.name };
    } catch (err) {
      formError = err instanceof Error ? err.message : 'Upload failed.';
      const signFail = consumeSignFailure();
      if (signFail) formError = signFail;
      throw new Error(formError);
    } finally {
      uploading = false;
    }
  }

  async function onFilePicked(ev: { currentTarget: HTMLInputElement }) {
    const file = ev.currentTarget.files?.[0];
    ev.currentTarget.value = '';
    if (!file) return;
    try {
      const uploaded = await uploadBlossomFile(file);
      if (showBody && !content.includes(uploaded.url)) {
        content = content ? `${content.trimEnd()}\n\n${uploaded.url}` : uploaded.url;
      }
    } catch {
      /* uploadBlossomFile sets formError */
    }
  }

  function onFieldPaste(
    fieldId: string,
    event: ClipboardEvent,
    style: 'prefixed' | 'bare' = 'prefixed'
  ): void {
    scrubClipboardTextPaste(
      event,
      (scrubbed, start, end) => {
        const cur = values[fieldId] ?? '';
        values[fieldId] = cur.slice(0, start) + scrubbed + cur.slice(end);
      },
      style
    );
  }

  function normalizePointerCatalogField(field: { id: string; tag?: string }): void {
    const tag = (field.tag ?? '').trim();
    if (!isComposePointerTagName(tag)) return;
    const raw = values[field.id] ?? '';
    if (!raw.trim()) return;
    const next = normalizeComposeTagValue(tag, raw);
    if (next !== raw) values[field.id] = next;
  }

  async function onBodyPaste(event: ClipboardEvent) {
    const data = event.clipboardData;
    const text = (data?.getData('text/plain') ?? '').trim();

    if (!uploading) {
      const files = mediaFilesFromDataTransfer(data);
      if (files.length) {
        event.preventDefault();
        for (const file of files) {
          try {
            const uploaded = await uploadBlossomFile(file);
            if (showBody && !content.includes(uploaded.url)) {
              content = content ? `${content.trimEnd()}\n\n${uploaded.url}` : uploaded.url;
            }
          } catch {
            /* uploadBlossomFile sets formError */
          }
        }
        return;
      }
      if (text && looksLikeMediaUrl(text)) {
        event.preventDefault();
        try {
          const file = await fetchRemoteMediaFile(text);
          const uploaded = await uploadBlossomFile(file);
          if (showBody && !content.includes(uploaded.url)) {
            content = content ? `${content.trimEnd()}\n\n${uploaded.url}` : uploaded.url;
          }
        } catch (err) {
          formError = err instanceof Error ? err.message : 'Could not import that media URL.';
        }
        return;
      }
    }

    const scrubbed = scrubProseText(text);
    if (scrubbed !== text) {
      event.preventDefault();
      const el = event.currentTarget;
      if (!(el instanceof HTMLTextAreaElement)) {
        content = content ? `${content}${scrubbed}` : scrubbed;
        return;
      }
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? start;
      content = content.slice(0, start) + scrubbed + content.slice(end);
      queueMicrotask(() => {
        el.focus();
        const at = start + scrubbed.length;
        el.setSelectionRange(at, at);
      });
    }
  }

  async function onBodyDrop(event: DragEvent) {
    if (uploading) return;
    const files = mediaFilesFromDataTransfer(event.dataTransfer);
    if (!files.length) return;
    event.preventDefault();
    for (const file of files) {
      try {
        const uploaded = await uploadBlossomFile(file);
        if (showBody && !content.includes(uploaded.url)) {
          content = content ? `${content.trimEnd()}\n\n${uploaded.url}` : uploaded.url;
        }
      } catch {
        /* uploadBlossomFile sets formError */
      }
    }
  }

  function removeImeta(i: number) {
    imetaTags = imetaTags.filter((_, idx) => idx !== i);
  }

  function rememberPublicationPublishFailure(result: {
    ok: false;
    error: string;
    missingDTags: string[];
    events: NostrEvent[];
    missingEvents: NostrEvent[];
    canContinueSigning?: boolean;
  }): void {
    const missing = result.missingDTags;
    const continueEvents = publicationPublishContinueEvents(result);
    formError =
      result.error +
      (missing.length
        ? missing.length > 8
          ? ` Missing: ${missing.slice(0, 8).join(', ')}…`
          : ` Missing: ${missing.join(', ')}`
        : '') +
      (continueEvents.length
        ? ' Already-signed parts are kept — publish again to continue without duplicates.'
        : '');
    // Sign failures leave missingEvents empty — Retry cannot resume signing.
    splitRetryEvents = publicationPublishRetryEvents(result);
    splitContinueEvents = continueEvents;
    splitMissingDTags = missing;
    if (result.events.length > splitPublishEventCount) {
      splitPublishEventCount = result.events.length;
    }
    const preferredD = publicationPublishRootD(values);
    const fromBatch = publicationPublishRootFromEvents(result.events, preferredD);
    // Only update the nav anchor when we positively identified the book root.
    // Keep any prior anchor when preferredD is absent from a partial/retry batch.
    if (fromBatch) splitPublishNavRoot = fromBatch;
    // Invalidate retry/continue if the user later edits the tree inputs.
    if (
      splitRetryEvents.length ||
      splitContinueEvents.length ||
      splitPublishNavRoot ||
      splitMissingDTags.length
    ) {
      splitFailureFingerprint = splitPublishResumeFingerprint();
    } else {
      splitFailureFingerprint = '';
    }
  }

  async function retrySplitPublish(): Promise<void> {
    if (!splitRetryEvents.length || posting) return;
    if (!$session.pubkey) {
      openLoginDialog();
      return;
    }
    formError = '';
    posting = true;
    // Always surface progress in the splitter when this was a split publish;
    // the main-form Retry stays available if the user closes the overlay later.
    if (kind === KIND.PUBLICATION && publicationSectionsMode === 'split') {
      publicationSplitOpen = true;
    }
    try {
      const result = await retryPublicationEvents({
        events: splitRetryEvents,
        onProgress: (p) => {
          splitProgress = p;
        }
      });
      if (!result.ok) {
        rememberPublicationPublishFailure(result);
        showPublishResult(false);
        return;
      }
      const preferredD = publicationPublishRootD(values);
      const root =
        splitPublishNavRoot ??
        publicationPublishRootFromEvents(result.events, preferredD) ??
        publicationPublishRootFromEvents(result.events);
      if (!root) {
        formError = 'Verified on relays, but could not resolve the publication root.';
        showPublishResult(false);
        return;
      }
      // Same draft/manuscript cleanup as a first-try success.
      // Use the full signed-batch count when Retry only republished misses.
      const eventCount = Math.max(result.events.length, splitPublishEventCount);
      await finishPublicationPublishSuccess({
        root,
        events: result.events,
        eventCount
      });
    } finally {
      posting = false;
    }
  }

  async function finishPublicationPublishSuccess(result: {
    root: NostrEvent;
    events: NostrEvent[];
    eventCount?: number;
  }): Promise<void> {
    deleteComposeDraft($session.pubkey!, kind);
    const publishedMsId = publicationManuscriptId;
    clearStagedManuscript();
    clearPublicationManuscriptFields();
    if (publishedMsId) {
      try {
        await deleteManuscript(publishedMsId);
      } catch (err) {
        showNotice(
          err instanceof Error
            ? err.message
            : 'Published, but the local manuscript could not be removed.'
        );
      }
      await refreshManuscriptDrafts();
    }
    refreshDraftList();
    splitProgress = null;
    const n = result.eventCount ?? result.events.length;
    clearSplitPublishFailureState();
    showNotice(`Publication published (${n} events verified on relays).`, true);
    warmNavEvent(result.root);
    void push(libraryDocumentPath(result.root));
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
        showNotice('Edit published.', true);
        shortNoteEditSource = null;
        appliedIntentKey = null;
        content = '';
        warmNavEvent(editedNote);
        void push(feedThreadPath(editedNote));
        return;
      }

      if (kind === KIND.PRIVATE_RELAY_LIST) {
        if (!signerSupportsNip44()) {
          formError = 'Your signer does not support NIP-44 encryption (required for draft relays).';
          return;
        }
        const urls = normalizePrivateRelayUrls((values.relays ?? '').split(/\n+/));
        if (!urls.length) {
          formError = 'Add at least one ws:// or wss:// relay.';
          return;
        }
        try {
          const signed = await publishPrivateRelayList(urls);
          if (!signed) {
            formError = consumeSignFailure() ?? 'Could not sign or publish.';
            showPublishResult(false);
            return;
          }
        } catch (err) {
          formError = err instanceof Error ? err.message : String(err);
          showPublishResult(false);
          return;
        }
        deleteComposeDraft($session.pubkey, kind);
        refreshDraftList();
        showNotice('Draft relay list published.', true);
        bumpPreview();
        return;
      }

      const state = formState();

      if (kind === KIND.PUBLICATION && publicationSectionsMode === 'split') {
        if (!values.title?.trim()) {
          formError = 'Title is required.';
          return;
        }
        if (!publicationAsciiDoc.trim()) {
          formError = 'Open the AsciiDoc splitter and paste your manuscript.';
          return;
        }
        // Keep the splitter open so publish/verify progress stays visible.
        publicationSplitOpen = true;
        const resumeOk =
          splitContinueEvents.length > 0 &&
          splitFailureFingerprint === splitPublishResumeFingerprint();
        const resumeSigned = resumeOk ? splitContinueEvents : [];
        const keptNav = resumeSigned.length ? splitPublishNavRoot : null;
        const keptCount = resumeSigned.length ? splitPublishEventCount : 0;
        splitProgress = null;
        clearSplitPublishFailureState();
        // Keep nav root / count when resuming an interrupted sign.
        if (resumeSigned.length) {
          splitPublishNavRoot = keptNav;
          splitPublishEventCount = keptCount;
          splitFailureFingerprint = splitPublishResumeFingerprint();
        }
        const result = await publishPublicationSplit({
          source: publicationAsciiDoc,
          maxIndexLevel: publicationIndexDepth,
          form: state,
          alreadySigned: resumeSigned.length ? resumeSigned : undefined,
          onProgress: (p) => {
            splitProgress = p;
          }
        });
        if (!result.ok) {
          rememberPublicationPublishFailure(result);
          showPublishResult(false);
          return;
        }
        await finishPublicationPublishSuccess(result);
        return;
      }

      // Link-mode 30040 and standalone 30041 share the verify pipeline.
      if (kind === KIND.PUBLICATION || kind === KIND.SECTION) {
        splitProgress = null;
        clearSplitPublishFailureState();
        const result = await publishPublicationEvent({
          form: state,
          onProgress: (p) => {
            splitProgress = p;
          }
        });
        if (!result.ok) {
          rememberPublicationPublishFailure(result);
          showPublishResult(false);
          return;
        }
        // Drop any leftover split manuscript so Drafts does not keep a ghost book.
        const leftoverMs = publicationManuscriptId;
        clearStagedManuscript();
        publicationManuscriptId = null;
        publicationManuscriptListedAt = 0;
        publicationAsciiDoc = '';
        if (leftoverMs) {
          try {
            await deleteManuscript(leftoverMs);
          } catch (err) {
            showNotice(
              err instanceof Error
                ? err.message
                : 'Published, but the local manuscript could not be removed.'
            );
          }
          await refreshManuscriptDrafts();
        }
        deleteComposeDraft($session.pubkey, kind);
        refreshDraftList();
        splitProgress = null;
        clearSplitPublishFailureState();
        showNotice(
          `Published (${result.events.length} event${result.events.length === 1 ? '' : 's'} verified on relays).`,
          true
        );
        content = showBody ? '' : content;
        if (!isMetadataComposeKind(kind)) {
          values = emptyValuesFor(kind);
          hashtagRows = [''];
          imetaTags = [];
          freeformTags = [['', '']];
          kind0Tags = emptyKind0TagRows();
        }
        bumpPreview();
        warmNavEvent(result.root);
        void push(libraryDocumentPath(result.root));
        return;
      }

      const gate = validateComposeForm(state);
      if (!gate.ok) {
        formError = gate.error;
        return;
      }
      const partial = buildComposePartial(state);

      if (kind === KIND.CONTACT_LIST) {
        // Public follows only in the form — never blank out NIP-51 private content.
        partial.content = contactPreserveContent;
      }

      if (kind === KIND.MUTE) {
        const mute = buildMuteListPayload(values.muted ?? '');
        if (mute.privateJson) {
          const pk = $session.pubkey;
          const signer = session.getSigner();
          if (signer?.nip44Encrypt && pk) {
            try {
              partial.content = await signer.nip44Encrypt(pk, mute.privateJson);
            } catch {
              /* keep plaintext JSON private tags */
              partial.content = mute.privateJson;
            }
          } else {
            partial.content = mute.privateJson;
          }
        } else if (mutePreserveCipher) {
          // Could not decrypt existing private mutes — leave ciphertext intact.
          partial.content = mutePreserveCipher;
        } else {
          partial.content = '';
        }
      }

      const signed = await signAndPublish(partial);
      if (!signed) {
        formError = consumeSignFailure() ?? 'Could not sign or publish.';
        showPublishResult(false);
        return;
      }
      if (kind === KIND.MUTE) {
        try {
          const extra = await decryptPrivateMuteTags(signed);
          applyMuteList(parseMuteList(signed, extra));
        } catch {
          applyMuteList(parseMuteList(signed, []));
        }
        mutePreserveCipher =
          signed.content &&
          !signed.content.trim().startsWith('[') &&
          (looksLikeNip44Ciphertext(signed.content) || looksLikeNip04Ciphertext(signed.content))
            ? signed.content
            : '';
      }
      deleteComposeDraft($session.pubkey, kind);
      refreshDraftList();
      showNotice('Published.', true);
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

  // Drop retry/continue/nav state if the split tree inputs change after a failure.
  $effect(() => {
    const fp = splitPublishResumeFingerprint();
    const hasFailureState =
      splitContinueEvents.length > 0 ||
      splitRetryEvents.length > 0 ||
      !!splitPublishNavRoot ||
      splitMissingDTags.length > 0;
    if (hasFailureState && splitFailureFingerprint && fp !== splitFailureFingerprint) {
      clearSplitPublishFailureState();
    }
  });

  let bootstrappedFor = $state<string | null>(null);
  let encryptedLoadedFor = $state<string | null>(null);
  $effect(() => {
    const pk = $session.pubkey;
    if (!pk) {
      encryptedDrafts = [];
      manuscriptDrafts = [];
      encryptedLoadedFor = null;
      return;
    }
    if (encryptedLoadedFor === pk) return;
    encryptedLoadedFor = pk;
    void refreshEncryptedDrafts();
  });
  $effect(() => {
    const pk = $session.pubkey;
    if (!pk || bootstrappedFor === pk) return;
    bootstrappedFor = pk;
    const params = new URLSearchParams($querystring ?? '');
    if (
      params.get('copy') ||
      params.get('edit') ||
      params.get('fork') ||
      params.get('merge')
    ) {
      return;
    }
    const rawKind = params.get('kind');
    const qKind =
      rawKind != null && rawKind.trim() !== '' ? Number(rawKind.trim()) : Number.NaN;
    const allowed = new Set<number>([
      ...COMPOSE_DOCUMENT_PRESETS,
      ...COMPOSE_METADATA_KINDS,
      ...groups.flatMap((g) => g.kinds),
      KIND.WIKI_MERGE_REQUEST,
      KIND.WIKI_REDIRECT
    ]);
    // Prefer the most recently touched tab autosave so a hard refresh returns to
    // the open 30040 (metadata + manuscript pointer) instead of blank kind 1.
    const latestDraftKind = listComposeDrafts(pk)[0]?.kind;
    const start =
      Number.isInteger(qKind) && allowed.has(qKind)
        ? qKind
        : latestDraftKind != null && allowed.has(latestDraftKind)
          ? latestDraftKind
          : kind;
    void (async () => {
      await loadKind(start);
      if (start === KIND.WIKI_REDIRECT) {
        const d = (params.get('d') ?? '').trim();
        const a = (params.get('a') ?? '').trim();
        if (d || a) {
          values = {
            ...values,
            ...(d ? { d } : {}),
            ...(a ? { redirect_a: a } : {})
          };
        }
      }
      // After a full reload / HMR remount, put the tab autosave back into the
      // form when we did not preload a replaceable (Drafts list alone is easy to miss).
      if (!replaceablePreloaded && pk) {
        const saved = loadComposeDraft(pk, start);
        if (saved && !isComposeDraftEmpty(saved, emptyValuesFor(start))) {
          applyDraft(saved);
          await hydrateManuscriptForDraft(saved);
          activeDraftD = saved.values.d?.trim() || null;
          bumpPreview();
        }
      }
    })();
  });

  // Keep Drafts book rows current after debounced IDB flushes.
  $effect(() => {
    return onManuscriptFlushed(() => {
      void refreshManuscriptDrafts();
    });
  });

  $effect(() => {
    return onManuscriptPersistError((err) => {
      showNotice(err.message || 'Could not save the AsciiDoc manuscript locally.');
    });
  });

  // Run schema migrations early (also after PWA updates claim this client).
  $effect(() => {
    void ensureManuscriptDb();
  });

  $effect(() => {
    const pk = $session.pubkey;
    const params = new URLSearchParams($querystring ?? '');
    const copyId = (params.get('copy') ?? '').trim().toLowerCase();
    const editId = (params.get('edit') ?? '').trim().toLowerCase();
    const forkId = (params.get('fork') ?? '').trim().toLowerCase();
    const mergeId = (params.get('merge') ?? '').trim().toLowerCase();
    const intentKey = copyId
      ? `copy:${copyId}`
      : editId
        ? `edit:${editId}`
        : forkId
          ? `fork:${forkId}`
          : mergeId
            ? `merge:${mergeId}`
            : '';
    if (!pk || !intentKey) return;
    if (appliedIntentKey === intentKey) return;
    let cancelled = false;
    void (async () => {
      const id = copyId || editId || forkId || mergeId;
      const source = await resolveIntentEvent(id);
      if (cancelled) return;
      if (!source) {
        formError = 'That event could not be loaded for compose.';
        appliedIntentKey = intentKey;
        return;
      }
      appliedIntentKey = intentKey;
      if (copyId) await applyCopyIntent(source);
      else if (forkId) await applyForkIntent(source);
      else if (mergeId) await applyMergeIntent(source);
      else await applyEditIntent(source);
    })();
    return () => {
      cancelled = true;
    };
  });
</script>

<div class="compose-screen" inert={advancedOpen || publicationSplitOpen}>
<main class="shell reading-body compose-page">
  <header class="page-header">
    <p class="page-kicker">Publish</p>
    <h1>{shortNoteEditSource ? 'Edit note' : 'Compose'}</h1>
    <p class="page-lede muted">
      {#if shortNoteEditSource}
        Publishing saves a kind {KIND.SHORT_NOTE_EDIT} revision (NIP-41) for your original note. Your
        pubkey, a fresh timestamp, and the Alexandria client tag are set when you sign.
      {:else}
        Fields and tags come from the kind catalog. Tab drafts stay in this browser session; AsciiDoc
        split manuscripts are stored in this browser (IndexedDB) until you publish or delete them.
        Copying an event preloads its fields as you — id, signature, and client tag are reminted on
        publish.
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
        <button
          type="button"
          class="btn"
          onclick={() => {
            draftListOpen = !draftListOpen;
            if (draftListOpen) void refreshEncryptedDrafts();
          }}
        >
          Drafts ({draftItems.length})
        </button>
      {/if}
    </div>

    {#if draftListOpen && draftItems.length}
      <div class="compose-drafts-panel">
        <div class="compose-drafts-explorer">
          <table class="compose-drafts-table">
            <thead>
              <tr>
                <th class="compose-drafts-col-icon" scope="col"
                  ><span class="visually-hidden">Type</span></th
                >
                <th class="compose-drafts-col-name" scope="col">Name</th>
                <th class="compose-drafts-col-d" scope="col">d-tag</th>
                <th class="compose-drafts-col-kind" scope="col">Kind</th>
                <th class="compose-drafts-col-when" scope="col">Modified</th>
                <th class="compose-drafts-col-actions" scope="col"
                  ><span class="visually-hidden">Actions</span></th
                >
              </tr>
            </thead>
            <tbody>
              {#each draftItems as item}
                <tr>
                  <td class="compose-drafts-col-icon">
                    {#if item.source === 'encrypted'}
                      <span
                        class="compose-draft-lock"
                        title="Encrypted draft"
                        aria-label="Encrypted draft"
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                          <path
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.75"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z"
                          />
                        </svg>
                      </span>
                    {:else if item.source === 'manuscript'}
                      <span
                        class="compose-draft-book"
                        title="AsciiDoc manuscript"
                        aria-label="AsciiDoc manuscript"
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                          <path
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.75"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5zM4 5.5V21.5"
                          />
                        </svg>
                      </span>
                    {:else}
                      <span
                        class="compose-draft-tab"
                        title="Tab autosave"
                        aria-label="Tab autosave"
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                          <path
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.75"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M4 5h10l2 2v12H4z"
                          />
                        </svg>
                      </span>
                    {/if}
                  </td>
                  <td class="compose-drafts-col-name">
                    <button
                      type="button"
                      class="compose-drafts-open"
                      title={`Open ${draftDisplayName(item)}`}
                      onclick={() => {
                        if (item.source === 'encrypted' && item.wrap) {
                          restoreEncryptedDraft(item.wrap);
                        } else if (item.source === 'manuscript') {
                          void restoreManuscriptDraft(item);
                        } else {
                          void restoreLocalDraft(item.kind, item.mode ?? 'compose');
                        }
                      }}
                    >
                      {draftDisplayName(item)}
                    </button>
                  </td>
                  <td class="compose-drafts-col-d" title={item.d || '(none)'}>
                    <code>{item.d || '—'}</code>
                  </td>
                  <td class="compose-drafts-col-kind" title={item.label}>
                    <span class="compose-drafts-kind-num">{item.kind}</span>
                    <span class="compose-drafts-kind-label muted"
                      >{getKind(item.kind)?.label ?? 'Unknown'}</span
                    >
                  </td>
                  <td
                    class="compose-drafts-col-when"
                    title={item.updatedAt ? new Date(item.updatedAt).toISOString() : ''}
                  >
                    {formatDraftWhen(item.updatedAt)}
                  </td>
                  <td class="compose-drafts-col-actions">
                    {#if item.source === 'encrypted' && item.wrap}
                      <button
                        type="button"
                        class="btn"
                        onclick={() => void deleteEncryptedDraft(item.wrap!)}>Delete</button
                      >
                    {:else if item.source === 'manuscript'}
                      <button
                        type="button"
                        class="btn"
                        onclick={() => void deleteManuscriptDraftItem(item)}>Delete</button
                      >
                    {:else}
                      <button
                        type="button"
                        class="btn"
                        onclick={() => deleteLocalDraftItem(item)}>Delete</button
                      >
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          class="btn compose-drafts-clear"
          disabled={deletingAllDrafts}
          onclick={() => void deleteAllDrafts()}
        >
          {deletingAllDrafts ? 'Deleting…' : 'Delete all drafts'}
        </button>
      </div>
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
        <button type="button" class="btn btn-primary" onclick={() => void validateOtherKind()}
          >Validate</button
        >
      </section>
    {:else}
      <form
        class="card compose-form"
        onsubmit={(e) => {
          e.preventDefault();
          void publish();
        }}
      >
        {#if replaceablePreloaded}
          <p class="compose-preload-banner" role="status">
            Showing data from the newest existing kind {kind} event for your signed-in key. Publishing
            replaces that event.
          </p>
        {/if}
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
                    {#if kind === KIND.PUBLICATION}
                      <div class="compose-sections-mode" role="group" aria-label="Sections mode">
                        <span class="compose-sections-mode-label"
                          >{field.label}{#if field.required}*{/if}</span
                        >
                        <div class="compose-option-group" role="radiogroup" aria-label="Sections mode">
                          <label class="compose-option">
                            <input
                              type="radio"
                              name="compose-sections-mode"
                              value="link"
                              checked={publicationSectionsMode === 'link'}
                              onchange={() => {
                                publicationSectionsMode = 'link';
                                clearSplitPublishFailureState();
                                splitProgress = null;
                                // Detach the open form from the split manuscript (Drafts
                                // book row remains until publish/delete).
                                publicationManuscriptId = null;
                                publicationManuscriptListedAt = 0;
                                clearStagedManuscript();
                              }}
                            />
                            <span>Link sections</span>
                          </label>
                          <label class="compose-option">
                            <input
                              type="radio"
                              name="compose-sections-mode"
                              value="split"
                              checked={publicationSectionsMode === 'split'}
                              onchange={() => {
                                publicationSectionsMode = 'split';
                                clearSplitPublishFailureState();
                                splitProgress = null;
                              }}
                            />
                            <span>Split from AsciiDoc</span>
                          </label>
                        </div>
                      </div>
                      {#if publicationSectionsMode === 'split'}
                        <p class="muted compose-split-hint">
                          Paste a manuscript with <code>==</code> chapters (title stays in the Title
                          field). Ideal split keeps each section under 50 KiB.
                        </p>
                        <button
                          type="button"
                          class="btn compose-advanced-btn"
                          onclick={() => (publicationSplitOpen = true)}
                        >
                          {publicationAsciiDoc.trim() ? 'Open AsciiDoc splitter' : 'Open AsciiDoc splitter'}
                        </button>
                        {#if publicationAsciiDoc.trim()}
                          <p class="muted compose-split-status">
                            Manuscript loaded ({Math.round(publicationAsciiDoc.length / 1024)} KB source).
                          </p>
                        {/if}
                      {:else}
                        <ComposePublicationSectionsEditor
                          bind:value={values[field.id]}
                          label=""
                          required={!!field.required}
                          help={field.help ?? ''}
                        />
                      {/if}
                    {:else}
                      <ComposePublicationSectionsEditor
                        bind:value={values[field.id]}
                        label={field.label}
                        required={!!field.required}
                        help={field.help ?? ''}
                      />
                    {/if}
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
                {:else if field.emit === 'p_list' || field.id === 'authors'}
                  <div class="compose-field">
                    <ComposePeopleListEditor
                      bind:value={values[field.id]}
                      label={field.label}
                      required={!!field.required}
                      help={field.help ?? ''}
                    />
                  </div>
                {:else if field.emit === 'mute_list' || field.id === 'muted'}
                  <div class="compose-field">
                    <ComposeMuteListEditor
                      bind:value={values[field.id]}
                      label={field.label}
                      required={!!field.required}
                      help={field.help ??
                        'Mute pubkeys, events, words, or hashtags. Mark Priv to keep an entry encrypted in content.'}
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
                      <MentionControl
                        mode={fieldHoldsPubkeys(field) ? 'npub' : 'prose'}
                        multiline
                        rows={3}
                        bind:value={values[field.id]}
                        onpaste={(e) =>
                          onFieldPaste(field.id, e, fieldHoldsPubkeys(field) ? 'bare' : 'prefixed')}
                      />
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
                    {:else if fieldHoldsPubkeys(field)}
                      <MentionControl
                        mode="npub"
                        bind:value={values[field.id]}
                        onpaste={(e) => onFieldPaste(field.id, e, 'bare')}
                        onblur={() => normalizePointerCatalogField(field)}
                        onchange={() => normalizePointerCatalogField(field)}
                      />
                    {:else}
                      <input
                        type={field.widget === 'url' ? 'url' : 'text'}
                        bind:value={values[field.id]}
                        onpaste={(e) => onFieldPaste(field.id, e)}
                        onblur={() => normalizePointerCatalogField(field)}
                        onchange={() => normalizePointerCatalogField(field)}
                      />
                    {/if}
                    {#if fieldHoldsPubkeys(field)}
                      <ComposeTextUserBadges value={values[field.id] ?? ''} />
                    {/if}
                    {#if field.help}
                      <small class="muted">{field.help}</small>
                    {/if}
                  </label>
                {/if}
              {/each}
              {#if kind === KIND.DIRECTORY}
                <div class="compose-field">
                  <ComposeDirectoryMembersEditor
                    bind:value={values.members}
                    label="Members"
                    help="Publications on this bookshelf. Event id, naddr, nevent, or kind:pubkey:d; title and author resolve underneath."
                  />
                </div>
              {/if}
            {/if}

            {#if showBody}
              <div class="compose-content-block">
                <div class="compose-content-head">
                  <label class="compose-content-label" for={kind === 9802 ? 'compose-body-plain' : 'compose-body'}>
                    {contentMeta?.label ?? 'Content'}{#if contentMeta?.required}*{/if}
                  </label>
                  {#if markupFormat}
                    <button
                      type="button"
                      class="btn compose-advanced-btn"
                      onclick={() => (advancedOpen = true)}
                    >
                      Advanced Editor
                    </button>
                  {/if}
                </div>
                <!-- Unmounted while the advanced editor is open so this field cannot overwrite that draft. -->
                {#if advancedOpen}
                  <p class="muted compose-advanced-open">Editing in the advanced editor.</p>
                {:else if kind !== 9802}
                  <ComposeGrammarTextarea
                    id="compose-body"
                    bind:value={content}
                    rows={10}
                    placeholder={contentMeta?.placeholder ?? ''}
                    issues={grammarIssues}
                    checkedSource={grammarCheckedSource}
                    enabled={showGrammar}
                    onApply={applyGrammarFix}
                    onPaste={(event) => void onBodyPaste(event)}
                    onDrop={(event) => void onBodyDrop(event)}
                  />
                {:else}
                  <MentionControl
                    id="compose-body-plain"
                    mode="prose"
                    multiline
                    rows={10}
                    bind:value={content}
                    placeholder={contentMeta?.placeholder ?? ''}
                    onpaste={(event) => void onBodyPaste(event)}
                    ondrop={(event) => void onBodyDrop(event)}
                  />
                {/if}
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
            <div class="compose-json-toolbar">
              <button
                type="button"
                class="btn btn-icon"
                aria-label={jsonCopied ? 'Copied' : 'Copy JSON'}
                title={jsonCopied ? 'Copied' : 'Copy JSON'}
                disabled={!previewJson}
                onclick={() => void copyPreviewJson()}
              >
                {#if jsonCopied}
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.75"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                {:else}
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <rect
                      x="9"
                      y="9"
                      width="11"
                      height="11"
                      rx="1.5"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.75"
                    />
                    <path
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.75"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"
                    />
                  </svg>
                {/if}
              </button>
            </div>
            <pre>{previewJson}</pre>
          </div>
        {/if}

        {#if splitProgress && (kind === KIND.PUBLICATION || kind === KIND.SECTION)}
          <p class="compose-split-progress" role="status">
            {splitProgress.message}
            {#if splitProgress.total}
              <span class="muted">({splitProgress.done}/{splitProgress.total})</span>
            {/if}
          </p>
        {/if}

        {#if formError}
          <p class="compose-error">{formError}</p>
        {/if}
        <!-- Keep Retry visible whenever misses remain — not only while formError is set
             (retry clears the error at start; splitter may also be closed). -->
        {#if splitRetryEvents.length}
          <button
            class="btn"
            type="button"
            disabled={posting}
            onclick={() => void retrySplitPublish()}
          >
            Retry failed
          </button>
        {/if}

        <div class="compose-actions">
          <button class="btn btn-primary" type="submit" disabled={posting || uploading || savingDraft}>
            {#if posting}
              Publishing…
            {:else if shortNoteEditSource}
              Publish edit
            {:else}
              Publish
            {/if}
          </button>
          {#if showSaveToDraft}
            <button
              class="btn"
              type="button"
              disabled={posting || uploading || savingDraft}
              onclick={() => void saveToDraft()}
            >
              {#if savingDraft}
                Saving draft…
              {:else}
                Save to Draft
              {/if}
            </button>
          {/if}
          <button
            class="btn"
            type="button"
            disabled={posting || uploading || savingDraft}
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
</div>

{#if advancedOpen && markupFormat}
  <AdvancedMarkupEditor
    bind:content
    format={editorMarkup ?? markupFormat ?? 'djot'}
    onFormat={(next) => (editorMarkup = next)}
    placeholder={contentMeta?.placeholder ?? ''}
    issues={grammarIssues}
    checkedSource={grammarCheckedSource}
    bind:grammarOn
    bind:grammarLang
    {grammarBusy}
    onApply={applyGrammarFix}
    onClose={() => {
      advancedOpen = false;
      persistCurrent();
    }}
    onUploadMedia={uploadBlossomFile}
    {uploading}
    {revisionHistory}
  />
{/if}

{#if publicationSplitOpen && kind === KIND.PUBLICATION}
  <PublicationAsciidocSplitEditor
    bind:source={publicationAsciiDoc}
    bind:maxIndexLevel={publicationIndexDepth}
    rootTitle={values.title || 'Untitled'}
    rootDTag={values.d || ''}
    publishing={posting}
    progress={splitProgress}
    missingDTags={splitMissingDTags}
    onRetryFailed={splitRetryEvents.length ? () => void retrySplitPublish() : undefined}
    onClose={() => {
      publicationSplitOpen = false;
      persistCurrent({ immediateManuscript: true });
    }}
  />
{/if}

<PrivateRelayListModal
  open={privateRelayModalOpen}
  onClose={() => (privateRelayModalOpen = false)}
  onPublished={() => {
    privateRelayModalOpen = false;
    void saveToDraft();
  }}
/>

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
  .compose-json-toolbar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 0.35rem;
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
  .compose-preload-banner {
    margin: 0 0 0.85rem;
    padding: 0.75rem 0.9rem;
    border: 1px solid color-mix(in srgb, var(--accent, #8b6914) 45%, transparent);
    border-radius: 0.4rem;
    background: color-mix(in srgb, var(--accent, #8b6914) 16%, var(--paper, #fff));
    color: var(--ink, inherit);
    font-size: 0.95rem;
    font-weight: 600;
    line-height: 1.4;
  }
  .compose-drafts-panel {
    margin: 0 0 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .compose-drafts-explorer {
    border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
    border-radius: 0.35rem;
    overflow: auto;
    max-height: 18rem;
    background: color-mix(in srgb, var(--paper, #fff) 92%, transparent);
  }
  .compose-drafts-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 0.9rem;
  }
  .compose-drafts-table th,
  .compose-drafts-table td {
    padding: 0.45rem 0.55rem;
    text-align: left;
    vertical-align: middle;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .compose-drafts-table thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent);
    background: color-mix(in srgb, currentColor 6%, var(--paper, #fff));
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--text-muted, inherit);
  }
  .compose-drafts-table tbody tr {
    border-bottom: 1px solid color-mix(in srgb, currentColor 8%, transparent);
  }
  .compose-drafts-table tbody tr:last-child {
    border-bottom: none;
  }
  .compose-drafts-table tbody tr:hover {
    background: color-mix(in srgb, var(--accent, #8b6914) 8%, transparent);
  }
  .compose-drafts-col-icon {
    width: 2.25rem;
  }
  .compose-drafts-col-name {
    width: 28%;
  }
  .compose-drafts-col-d {
    width: 28%;
  }
  .compose-drafts-col-kind {
    width: 8rem;
    white-space: normal;
  }
  .compose-drafts-kind-num {
    display: block;
    font-variant-numeric: tabular-nums;
  }
  .compose-drafts-kind-label {
    display: block;
    font-size: 0.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .compose-drafts-col-when {
    width: 11rem;
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
    color: var(--text-muted, inherit);
  }
  .compose-drafts-col-actions {
    width: 5.5rem;
    text-align: right;
  }
  .compose-drafts-col-d code {
    font-size: 0.82em;
  }
  .compose-drafts-open {
    display: block;
    border: none;
    background: none;
    padding: 0;
    margin: 0;
    font: inherit;
    font-weight: 600;
    color: inherit;
    text-align: left;
    cursor: pointer;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .compose-drafts-open:hover,
  .compose-drafts-open:focus-visible {
    text-decoration: underline;
  }
  .compose-drafts-open:focus-visible {
    outline: none;
  }
  .compose-drafts-clear {
    align-self: flex-start;
  }
  .compose-draft-lock,
  .compose-draft-tab,
  .compose-draft-book {
    display: inline-flex;
    color: var(--text-muted);
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
  @media (max-width: 720px) {
    .compose-drafts-col-kind,
    .compose-drafts-col-when {
      display: none;
    }
    .compose-drafts-col-name,
    .compose-drafts-col-d {
      width: auto;
    }
  }
  .other-summary {
    font-size: 0.9rem;
  }
  .compose-screen {
    display: contents;
  }
  .compose-content-block {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .compose-content-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .compose-content-label {
    font: inherit;
  }
  .compose-advanced-btn {
    flex: 0 0 auto;
    padding: 0.28rem 0.65rem;
    font-size: 0.82rem;
  }
  .compose-advanced-open {
    margin: 0;
  }
  .compose-sections-mode {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-bottom: 0.45rem;
  }
  .compose-sections-mode-label {
    font-weight: 600;
  }
  .compose-split-hint,
  .compose-split-status,
  .compose-split-progress {
    margin: 0.35rem 0;
    font-size: 0.88rem;
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
