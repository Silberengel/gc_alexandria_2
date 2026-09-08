import { NIP32_BOOKLIST_LABEL } from './constants';
import { normalizeDTag } from './dtag';

/** Home-shelf NIP-32 slugs (jumble / imwald-android CuratedShelfCatalog). */
export const HOME_SHELF_SLUGS = [
  'adventure',
  'romance',
  'mystery-detective',
  'horror-gothic',
  'sci-fi-speculative-fiction',
  'humour-satire',
  'high-seas',
  'poetry'
] as const;

export type HomeShelfSlug = (typeof HOME_SHELF_SLUGS)[number];

export const HOME_SHELF_TITLES: Record<HomeShelfSlug, string> = {
  adventure: 'Adventure',
  romance: 'Romance',
  'mystery-detective': 'Mystery / Detective',
  'horror-gothic': 'Horror / Gothic',
  'sci-fi-speculative-fiction': 'Sci-Fi / Speculative Fiction',
  'humour-satire': 'Humour / Satire',
  'high-seas': 'High Seas',
  poetry: 'Poetry'
};

export function isHomeShelfSlug(value: string): value is HomeShelfSlug {
  return (HOME_SHELF_SLUGS as readonly string[]).includes(value);
}

export function slugifyPublicationLabel(raw: string): string {
  const slug = normalizeDTag(raw.trim());
  return slug || NIP32_BOOKLIST_LABEL;
}

export function displayTitleForPublicationLabel(slug: string): string {
  if (slug === NIP32_BOOKLIST_LABEL) return 'Booklist';
  if (isHomeShelfSlug(slug)) return HOME_SHELF_TITLES[slug];
  return slug;
}
