<script lang="ts">
  interface Props {
    value?: string;
    placeholder?: string;
    posting?: boolean;
    submitLabel?: string;
    offerKind1?: boolean;
    asKind1Reply?: boolean;
    showCancel?: boolean;
    onSubmit: () => void;
    onCancel?: () => void;
  }

  let {
    value = $bindable(''),
    placeholder = 'Write a comment',
    posting = false,
    submitLabel = 'Post',
    offerKind1 = false,
    asKind1Reply = $bindable(false),
    showCancel = false,
    onSubmit,
    onCancel
  }: Props = $props();
</script>

<form
  class="compose"
  onsubmit={(e) => {
    e.preventDefault();
    onSubmit();
  }}
>
  <textarea bind:value rows="3" {placeholder}></textarea>
  {#if offerKind1}
    <label class="compose-kind1">
      <input type="checkbox" bind:checked={asKind1Reply} />
      Also post as a kind 1 reply
    </label>
  {/if}
  <div class="compose-actions">
    <button class="btn btn-primary" type="submit" disabled={posting || !value.trim()}
      >{posting ? 'Posting…' : submitLabel}</button
    >
    {#if showCancel && onCancel}
      <button class="btn" type="button" onclick={onCancel}>Cancel</button>
    {/if}
  </div>
</form>
