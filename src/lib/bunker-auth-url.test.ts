import {
  friendlyBunkerLoginError,
  isBareNostrSignerWakeUrl,
  sanitizeStoredBunkerUrl,
  shouldOpenBunkerAuthUrl
} from './bunker-auth-url'
import { describe, expect, it } from 'vitest'

describe('bunker-auth-url', () => {
  it('ignores bare nostrsigner wake URLs', () => {
    expect(isBareNostrSignerWakeUrl('nostrsigner:')).toBe(true)
    expect(isBareNostrSignerWakeUrl('nostrsigner://')).toBe(true)
    expect(isBareNostrSignerWakeUrl('nostrsigner:wake')).toBe(true)
  })

  it('allows real NIP-55 JSON payloads', () => {
    expect(isBareNostrSignerWakeUrl('nostrsigner:{"type":"sign_event"}')).toBe(false)
    expect(shouldOpenBunkerAuthUrl('nostrsigner:{"type":"sign_event"}')).toBe(true)
  })

  it('allows nostrconnect and allowlisted https hosts', () => {
    expect(shouldOpenBunkerAuthUrl('nostrconnect://abc?relay=wss://relay.nsec.app')).toBe(true)
    expect(shouldOpenBunkerAuthUrl('https://app.nsec.app/login')).toBe(true)
    expect(shouldOpenBunkerAuthUrl('https://evil.example/login')).toBe(false)
  })

  it('maps Amber rejection strings', () => {
    expect(friendlyBunkerLoginError('already connected')).toMatch(/already used/i)
    expect(friendlyBunkerLoginError('invalid secret')).toMatch(/fresh bunker/i)
  })
})

describe('sanitizeStoredBunkerUrl', () => {
  const hex = 'ab'.repeat(32)

  it('drops secret and keeps relays in canonical form', () => {
    const stored = sanitizeStoredBunkerUrl(
      `bunker://${hex}?relay=wss://relay.nsec.app&relay=wss://relay.damus.io&secret=once`
    )
    expect(stored).not.toMatch(/secret/i)
    expect(stored).toContain(encodeURIComponent('wss://relay.nsec.app'))
    expect(stored).toContain(encodeURIComponent('wss://relay.damus.io'))
    expect(stored.startsWith(`bunker://${hex}?`)).toBe(true)
  })

  it('lowercases the bunker pubkey', () => {
    expect(sanitizeStoredBunkerUrl(`bunker://${hex.toUpperCase()}?secret=x`)).toBe(
      `bunker://${hex}`
    )
  })

  it('leaves NIP-05 bunker ids unchanged', () => {
    expect(sanitizeStoredBunkerUrl('alice@nsec.app')).toBe('alice@nsec.app')
  })

  it('strips secret from a nostrconnect URI if one is stored', () => {
    const stored = sanitizeStoredBunkerUrl(
      `nostrconnect://${hex}?relay=wss://relay.nsec.app&secret=challenge`
    )
    expect(stored).not.toMatch(/secret/i)
    expect(stored.startsWith(`nostrconnect://${hex}`)).toBe(true)
  })
})
