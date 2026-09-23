/**
 * Amber / NIP-46 auth URL policy (ported from imwald-android BunkerAuthUrlPolicy).
 * Bare `nostrsigner:` wakes must not be opened — they flash Amber's empty
 * "Nothing to approve" screen before a real request is queued.
 */

const ALLOWED_HTTPS_HOSTS = new Set([
  'signer.getalby.com',
  'app.nsec.app',
  'useamber.com',
  'nostrsigner.com'
])

export function isBareNostrSignerWakeUrl(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed.toLowerCase().startsWith('nostrsigner:')) return false
  const payload = trimmed.slice('nostrsigner:'.length).trim()
  if (payload.length === 0 || payload === '//') return true
  // Real NIP-55 sign requests embed JSON; everything else is a wake hint.
  return !payload.startsWith('{') && !payload.toLowerCase().startsWith('%7b')
}

export function shouldOpenBunkerAuthUrl(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) return false
  if (trimmed.toLowerCase().startsWith('nostrsigner:')) {
    return !isBareNostrSignerWakeUrl(trimmed)
  }
  if (trimmed.toLowerCase().startsWith('nostrconnect:')) return true
  if (trimmed.toLowerCase().startsWith('https://')) {
    try {
      const host = new URL(trimmed).host.toLowerCase()
      return ALLOWED_HTTPS_HOSTS.has(host)
    } catch {
      return false
    }
  }
  return false
}

/**
 * Persistable bunker URI: remote signer pubkey + relays only.
 * Drops `secret` (one-time Amber/NIP-46 connect token). NIP-05 ids are unchanged.
 */
export function sanitizeStoredBunkerUrl(raw: string): string {
  const trimmed = raw.trim()
  const bunkerMatch = trimmed.match(/^bunker:\/\/([0-9a-fA-F]{64})\??(.*)$/i)
  if (bunkerMatch) {
    const pubkey = bunkerMatch[1].toLowerCase()
    const query = bunkerMatch[2].replace(/^\?/, '')
    const qs = new URLSearchParams(query)
    const stored = new URL(`bunker://${pubkey}`)
    for (const relay of qs.getAll('relay')) {
      if (relay) stored.searchParams.append('relay', relay)
    }
    return stored.toString()
  }
  if (trimmed.toLowerCase().startsWith('nostrconnect:')) {
    try {
      const uri = new URL(trimmed)
      uri.searchParams.delete('secret')
      return uri.toString()
    } catch {
      return trimmed
    }
  }
  return trimmed
}

/** Open a bunker/NostrConnect auth URL when safe; ignore Amber wake hints. */
export function openBunkerAuthUrl(url: string): void {
  const trimmed = url.trim()
  if (!trimmed) return
  if (isBareNostrSignerWakeUrl(trimmed)) return
  if (!shouldOpenBunkerAuthUrl(trimmed)) return
  // Mobile browsers often block window.open outside the original gesture stack
  // (Amber sign prompts arrive async over NIP-46). Prefer a synthetic <a> click,
  // then same-tab navigation for custom schemes like nostrconnect://.
  try {
    const a = document.createElement('a')
    a.href = trimmed
    a.rel = 'noopener noreferrer'
    const isCustomScheme = !/^https?:/i.test(trimmed)
    if (!isCustomScheme) a.target = '_blank'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    return
  } catch {
    /* fall through */
  }
  try {
    window.open(trimmed, '_blank', 'noopener,noreferrer')
  } catch {
    window.location.assign(trimmed)
  }
}

/** Map common Amber/bunker rejection strings to actionable copy. */
export function friendlyBunkerLoginError(message: string | undefined | null): string {
  const raw = (message ?? '').trim()
  if (raw.toLowerCase() === 'already connected') {
    return (
      'This bunker link was already used. In Amber, create a new bunker connection ' +
      '(or reset this one) and paste the new bunker:// link. Or use NostrConnect / Open Amber.'
    )
  }
  if (
    raw.toLowerCase() === 'invalid secret' ||
    raw.toLowerCase() === 'no secret' ||
    raw.toLowerCase() === 'secret not in use'
  ) {
    return 'Amber rejected this bunker secret. Create a fresh bunker connection in Amber and paste that link.'
  }
  if (raw.toLowerCase() === 'no permission') {
    return 'Amber has no permission for this connection. Create a new bunker connection in Amber and paste that link.'
  }
  if (!raw) return 'Bunker login failed'
  return raw
}
