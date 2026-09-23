<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import QRCode from 'qrcode';
  import { generateSecretKey, getPublicKey } from 'nostr-tools';
  import { createNostrConnectURI } from 'nostr-tools/nip46';
  import { DEFAULT_NOSTRCONNECT_RELAY } from '$lib/constants';
  import { friendlyBunkerLoginError } from '$lib/bunker-auth-url';
  import {
    authenticateWithGooglePopup,
    decodePomegranateGoogleToken,
    loadStoredPomegranateCoordinatorUrl,
    pomegranateGoogleLoginUrl,
    pomegranateLogin,
    PomegranateLoginCancelledError,
    storePomegranateCoordinatorUrl
  } from '$lib/pomegranate';
  import { session } from '$lib/stores/session';

  interface Props {
    open?: boolean;
    onClose?: () => void;
  }

  let { open = false, onClose }: Props = $props();

  type Panel = 'menu' | 'extension' | 'amber' | 'pomegranate';
  let panel = $state<Panel>('menu');
  let error = $state<string | null>(null);
  let status = $state<string | null>(null);
  let pending = $state(false);

  // Amber / NostrConnect
  let connectionString = $state('');
  let qrDataUrl = $state('');
  let bunkerInput = $state('');
  let waitingForAmber = $state(false);
  let amberAbort: AbortController | null = null;
  let clientSecretKey: Uint8Array | null = null;

  // Pomegranate
  let coordinatorInput = $state(loadStoredPomegranateCoordinatorUrl());
  let awaitingPaste = $state(false);
  let manualToken = $state('');
  let pomegranateAbort: AbortController | null = null;

  function close(): void {
    stopAmberWait();
    pomegranateAbort?.abort();
    pomegranateAbort = null;
    panel = 'menu';
    error = null;
    status = null;
    pending = false;
    awaitingPaste = false;
    onClose?.();
  }

  function stopAmberWait(): void {
    amberAbort?.abort();
    amberAbort = null;
    waitingForAmber = false;
  }

  async function startAmberPanel(): Promise<void> {
    panel = 'amber';
    error = null;
    status = null;
    stopAmberWait();
    const priv = generateSecretKey();
    clientSecretKey = priv;
    connectionString = createNostrConnectURI({
      clientPubkey: getPublicKey(priv),
      relays: [...DEFAULT_NOSTRCONNECT_RELAY],
      secret: Math.random().toString(36).slice(2, 10),
      name: document.location.host,
      url: document.location.origin
    });
    try {
      qrDataUrl = await QRCode.toDataURL(connectionString, {
        width: 240,
        margin: 1,
        color: { dark: '#2a241c', light: '#efe6dc' }
      });
    } catch {
      qrDataUrl = '';
    }

    const abort = new AbortController();
    amberAbort = abort;
    waitingForAmber = true;
    void session
      .nostrConnectionLogin(priv, connectionString, abort.signal)
      .then((ok) => {
        if (abort.signal.aborted) return;
        waitingForAmber = false;
        if (ok) close();
      })
      .catch((err) => {
        if (abort.signal.aborted) return;
        waitingForAmber = false;
        error = friendlyBunkerLoginError(err instanceof Error ? err.message : String(err));
      });
  }

  function openInAmber(): void {
    if (connectionString) window.location.href = connectionString;
  }

  async function copyConnection(): Promise<void> {
    if (!connectionString) return;
    try {
      await navigator.clipboard.writeText(connectionString);
      status = 'Connection string copied';
      window.setTimeout(() => {
        if (status === 'Connection string copied') status = null;
      }, 2000);
    } catch {
      error = 'Could not copy to clipboard';
    }
  }

  async function submitBunker(): Promise<void> {
    const bunker = bunkerInput.trim();
    if (!bunker) return;
    pending = true;
    error = null;
    try {
      stopAmberWait();
      await session.bunkerLogin(bunker);
      close();
    } catch (err) {
      error = friendlyBunkerLoginError(err instanceof Error ? err.message : String(err));
    } finally {
      pending = false;
    }
  }

  async function extensionLogin(): Promise<void> {
    panel = 'extension';
    pending = true;
    error = null;
    status = 'Waiting for browser extension…';
    try {
      const ok = await session.signIn();
      if (ok) close();
      else error = 'No NIP-07 extension responded. Install nos2x, Alby, or nos2x-fox.';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      pending = false;
      status = null;
    }
  }

  async function runPomegranateWithToken(rawToken: string): Promise<void> {
    pomegranateAbort?.abort();
    const ac = new AbortController();
    pomegranateAbort = ac;
    pending = true;
    error = null;
    awaitingPaste = true;
    status = 'Loading Pomegranate account…';
    try {
      const result = await pomegranateLogin(
        coordinatorInput,
        async () => rawToken,
        async (discovered) =>
          window.confirm(
            `An existing Pomegranate setup for this Google account was found at ${discovered}. Sign in there instead?`
          ),
        {
          signal: ac.signal,
          onProgress: (message) => {
            if (!ac.signal.aborted) status = message;
          }
        }
      );
      if (ac.signal.aborted) throw new PomegranateLoginCancelledError();
      status = 'Connecting to signer…';
      await session.bunkerLogin(result.bunkerUrl, { allowMissingSecret: true, timeoutMs: 25_000 });
      storePomegranateCoordinatorUrl(result.centralUrl);
      if (!ac.signal.aborted) close();
    } catch (err) {
      if (ac.signal.aborted || err instanceof PomegranateLoginCancelledError) return;
      error = err instanceof Error ? err.message : String(err);
      awaitingPaste = true;
    } finally {
      if (pomegranateAbort === ac) pomegranateAbort = null;
      pending = false;
      if (!error) status = null;
    }
  }

  function startPomegranate(): void {
    panel = 'pomegranate';
    error = null;
    manualToken = '';
    awaitingPaste = true;
    pending = false;
    status =
      'A Google tab should open. Finish sign-in there. When it says “Error: No token received.” that usually means success — in THAT tab’s console run: copy(document.body.dataset.token) — paste below. Do not refresh that page.';

    pomegranateAbort?.abort();
    const ac = new AbortController();
    pomegranateAbort = ac;
    void authenticateWithGooglePopup(coordinatorInput, { signal: ac.signal })
      .then((token) => {
        if (ac.signal.aborted) return;
        void runPomegranateWithToken(token);
      })
      .catch((err) => {
        if (ac.signal.aborted || err instanceof PomegranateLoginCancelledError) return;
        error = err instanceof Error ? err.message : String(err);
      });
  }

  function openPomegranateTabOnly(): void {
    pomegranateAbort?.abort();
    pomegranateAbort = null;
    error = null;
    awaitingPaste = true;
    pending = false;
    status =
      'Finish Google sign-in in the opened tab. If it shows “Error: No token received.”, paste document.body.dataset.token below.';
    window.open(pomegranateGoogleLoginUrl(coordinatorInput), '_blank');
  }

  function submitManualToken(): void {
    const raw = manualToken.trim();
    if (!raw) return;
    try {
      decodePomegranateGoogleToken(raw);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      return;
    }
    void runPomegranateWithToken(raw);
  }

  function onBackdrop(e: MouseEvent): void {
    if (e.target === e.currentTarget) close();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && open) close();
  }

  onMount(() => {
    window.addEventListener('keydown', onKey);
  });
  onDestroy(() => {
    window.removeEventListener('keydown', onKey);
    stopAmberWait();
    pomegranateAbort?.abort();
  });

  $effect(() => {
    if (!open) {
      stopAmberWait();
      pomegranateAbort?.abort();
      panel = 'menu';
      error = null;
      status = null;
    }
  });
</script>

{#if open}
  <div class="login-overlay" role="presentation" onclick={onBackdrop}>
    <div
      class="login-dialog card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-dialog-title"
    >
      <header class="login-dialog-head">
        <h2 id="login-dialog-title">Sign in</h2>
        <button class="btn" type="button" onclick={close} aria-label="Close">Close</button>
      </header>

      {#if panel === 'menu'}
        <p class="muted login-lede">
          Use a browser extension, Amber / bunker, or Pomegranate. Private keys are never stored in
          this app.
        </p>
        <div class="login-menu">
          <button class="btn btn-primary" type="button" onclick={() => void extensionLogin()}>
            Browser extension (NIP-07)
          </button>
          <button class="btn" type="button" onclick={() => void startAmberPanel()}>
            Amber / bunker
          </button>
          <button class="btn" type="button" onclick={startPomegranate}>Pomegranate</button>
        </div>
      {:else if panel === 'extension'}
        <p class="muted">{status ?? 'Connecting…'}</p>
        {#if error}<p class="login-error">{error}</p>{/if}
        <button class="btn" type="button" onclick={() => (panel = 'menu')}>Back</button>
      {:else if panel === 'amber'}
        <p class="muted login-lede">
          Scan or open the NostrConnect link in Amber, or paste a <code>bunker://</code> URI.
        </p>
        {#if qrDataUrl}
          <a class="login-qr" href={connectionString} aria-label="Open with Nostr signer app">
            <img src={qrDataUrl} width="240" height="240" alt="NostrConnect QR code" />
          </a>
        {/if}
        {#if waitingForAmber && !error}
          <p class="muted login-status">Waiting for Amber / signer…</p>
        {/if}
        <button class="btn btn-primary" type="button" onclick={openInAmber}>Open Amber</button>
        <button class="btn" type="button" onclick={() => void copyConnection()}>Copy connection string</button>
        <div class="login-or"><span>or</span></div>
        <form
          class="login-bunker"
          onsubmit={(e) => {
            e.preventDefault();
            void submitBunker();
          }}
        >
          <input
            type="text"
            placeholder="bunker://…"
            bind:value={bunkerInput}
            autocomplete="off"
            spellcheck="false"
          />
          <button class="btn btn-primary" type="submit" disabled={pending || !bunkerInput.trim()}>
            {pending ? 'Connecting…' : 'Connect bunker'}
          </button>
        </form>
        {#if status}<p class="muted login-status">{status}</p>{/if}
        {#if error}<p class="login-error">{error}</p>{/if}
        <button class="btn" type="button" onclick={() => { stopAmberWait(); panel = 'menu'; error = null; }}>
          Back
        </button>
      {:else if panel === 'pomegranate'}
        <p class="muted login-lede">
          Signs in to an existing Pomegranate account with Google, then connects as a NIP-46 bunker.
        </p>
        <label class="login-field">
          <span class="muted">Coordinator</span>
          <input type="url" bind:value={coordinatorInput} autocomplete="off" spellcheck="false" />
        </label>
        <button class="btn btn-primary" type="button" disabled={pending} onclick={startPomegranate}>
          {pending ? 'Working…' : 'Sign in with Google'}
        </button>
        <button class="btn" type="button" disabled={pending} onclick={openPomegranateTabOnly}>
          Open Google tab only
        </button>
        {#if awaitingPaste}
          <label class="login-field">
            <span class="muted">Paste Google token</span>
            <textarea rows="3" bind:value={manualToken} placeholder="Base64 token from auth.njump.me"></textarea>
          </label>
          <button
            class="btn btn-primary"
            type="button"
            disabled={pending || !manualToken.trim()}
            onclick={submitManualToken}
          >
            Continue with token
          </button>
        {/if}
        {#if status}<p class="muted login-status">{status}</p>{/if}
        {#if error}<p class="login-error">{error}</p>{/if}
        <button
          class="btn"
          type="button"
          onclick={() => {
            pomegranateAbort?.abort();
            panel = 'menu';
            error = null;
            status = null;
            awaitingPaste = false;
          }}
        >
          Back
        </button>
      {/if}
    </div>
  </div>
{/if}
