import { nip19 } from 'nostr-tools';
import { GITCITADEL_CURATOR_NPUB, GITCITADEL_NPUB } from './constants';

export function npubToHex(npub: string): string {
  const decoded = nip19.decode(npub);
  if (decoded.type !== 'npub') throw new Error('expected npub');
  return decoded.data;
}

export const GITCITADEL_HEX = npubToHex(GITCITADEL_NPUB);
export const GITCITADEL_CURATOR_HEX = npubToHex(GITCITADEL_CURATOR_NPUB);

export function isLibraryCopyPubkey(pubkey: string): boolean {
  return pubkey.toLowerCase() === GITCITADEL_HEX;
}
