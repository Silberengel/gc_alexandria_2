<script lang="ts">
  import { verifyNip05 } from '$lib/nip05';

  interface Props {
    nip05: string;
    pubkey: string;
  }

  let { nip05, pubkey }: Props = $props();

  let verified = $state(false);
  let checking = $state(true);
  let name = $state('');
  let domain = $state('');

  $effect(() => {
    const id = nip05.trim();
    const pk = pubkey.trim().toLowerCase();
    verified = false;
    checking = true;
    name = '';
    domain = '';
    if (!id || !pk) {
      checking = false;
      return;
    }
    let cancelled = false;
    void verifyNip05(id, pk).then((result) => {
      if (cancelled) return;
      verified = result.isVerified;
      name = result.nip05Name;
      domain = result.nip05Domain;
      checking = false;
    });
    return () => {
      cancelled = true;
    };
  });

  const display = $derived(name && domain ? `${name}@${domain}` : nip05.trim());
  const wellKnown = $derived(
    domain ? `https://${domain}/.well-known/nostr.json${name ? `?name=${encodeURIComponent(name)}` : ''}` : ''
  );
</script>

{#if nip05.trim()}
  <span class="nip05" class:nip05-verified={verified} class:nip05-checking={checking}>
    {#if verified}
      <svg class="nip05-check" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.1 14.2-3.6-3.6 1.4-1.4 2.2 2.2 4.7-4.7 1.4 1.4-6.1 6.1Z"
        />
      </svg>
      <span class="visually-hidden">Verified NIP-05</span>
    {/if}
    {#if wellKnown}
      <a href={wellKnown} rel="noopener noreferrer" title={verified ? 'Verified NIP-05' : 'NIP-05'}
        >{display}</a
      >
    {:else}
      <span>{display}</span>
    {/if}
  </span>
{/if}
