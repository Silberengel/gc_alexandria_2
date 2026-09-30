import type { Event } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { KIND } from './constants';
import { firstTag } from './nostr/verify';

const RECIPE_TOPICS = new Set([
  'recipe',
  'recipes',
  'zapcooking',
  'chefstr',
  'foodstr',
  'nostrcooking'
]);

function tagName(tag: string[]): string {
  return (tag[0] ?? '').trim().toLowerCase();
}

function topicTokens(raw: string): string[] {
  return raw
    .trim()
    .toLowerCase()
    .split(/[\s,]+/u)
    .map((part) => part.replace(/^#/, ''))
    .filter(Boolean);
}

/** Kind 30023 whose topics or client mark it as a recipe (including Zap Cooking). */
export function isRecipeArticle(event: Pick<Event, 'kind' | 'tags'>): boolean {
  if (event.kind !== KIND.LONG_FORM) return false;
  for (const tag of event.tags) {
    const name = tagName(tag);
    const value = tag[1]?.trim();
    if (!value) continue;
    if (name === 't' && topicTokens(value).some((token) => RECIPE_TOPICS.has(token))) return true;
    if (name === 'client' && value.toLowerCase() === 'zap cooking') return true;
  }
  return false;
}

/** Kind 30023 published by the Zap Cooking client. */
export function isZapCookingRecipe(event: Pick<Event, 'kind' | 'tags'>): boolean {
  if (event.kind !== KIND.LONG_FORM) return false;
  return event.tags.some(
    (tag) => tagName(tag) === 'client' && (tag[1] ?? '').trim().toLowerCase() === 'zap cooking'
  );
}

/** https://zap.cooking/recipe/{naddr} for a Zap Cooking kind 30023, or null. */
export function zapCookingRecipeUrl(event: Event): string | null {
  if (!isZapCookingRecipe(event)) return null;
  const identifier = firstTag(event, 'd')?.trim();
  if (!identifier || !event.pubkey) return null;
  const naddr = nip19.naddrEncode({
    kind: event.kind,
    pubkey: event.pubkey,
    identifier
  });
  return `https://zap.cooking/recipe/${naddr}`;
}
