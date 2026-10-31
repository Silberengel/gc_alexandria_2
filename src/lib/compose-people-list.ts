/** Re-export NIP-51 people / p_list helpers from the shared catalog. */
export {
  authorsRawFromTags,
  buildPListTags,
  formatPeopleRow,
  formatPeopleRows,
  parsePeopleLine,
  peopleRowsFromRaw
} from '@silberengel/kind-compose-catalog';
export type { PeopleRow } from '@silberengel/kind-compose-catalog';
