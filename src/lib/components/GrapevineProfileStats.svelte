<script lang="ts">
  import { trustedAssertions } from '$lib/trusted-assertions';
  import {
    hasKnownRank,
    type TrustedAssertionScore
  } from '$lib/nip85-trusted-assertions';
  import { session } from '$lib/stores/session';

  interface Props {
    pubkey: string;
  }

  let { pubkey }: Props = $props();

  let score = $state<TrustedAssertionScore | null>(null);
  let personalized = $state(false);

  $effect(() => {
    const pk = pubkey.trim().toLowerCase();
    if (!pk) {
      score = null;
      personalized = false;
      return;
    }
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      score = trustedAssertions.getScore(pk);
      personalized = trustedAssertions.getProviderState().isPersonalized;
    };
    const unsub = trustedAssertions.subscribe(apply);
    apply();
    void trustedAssertions
      .resolveProvider(session.getPubkey())
      .then(() => trustedAssertions.requestScoresAndWait([pk]))
      .then(apply)
      .catch(() => {});
    return () => {
      cancelled = true;
      unsub();
    };
  });

  const show = $derived(
    !!score &&
      (hasKnownRank(score) || score.hops != null || score.followers != null)
  );
  const rank = $derived(
    hasKnownRank(score) ? Math.round(score!.rank as number) : null
  );

  function hopsLabel(n: number): string {
    return n === 1 ? '1 hop' : `${n} hops`;
  }

  function followersLabel(n: number): string {
    return n === 1 ? '1 verified follower' : `${n} verified followers`;
  }
</script>

{#if show && score}
  <div class="grapevine-profile-stats">
    <div class="grapevine-profile-stats-row">
      {#if rank != null}
        <span class="grapevine-profile-stat grapevine-profile-stat-rank"
          >{rank} Grapevine rank</span
        >
      {/if}
      {#if score.hops != null}
        <span class="grapevine-profile-stat">{hopsLabel(score.hops)}</span>
      {/if}
      {#if score.followers != null}
        <span class="grapevine-profile-stat">{followersLabel(score.followers)}</span>
      {/if}
    </div>
    <p class="grapevine-profile-stats-source muted">
      {personalized ? 'Your personalized grapevine' : 'Community grapevine scores'}
    </p>
  </div>
{/if}
