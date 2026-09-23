import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

// Exercise refreshLanding end-to-end with real relays (anonymous)
describe('refreshLanding shelves', () => {
  it('returns shelves with covers', async () => {
    const { refreshLanding } = await import('./landing')
    const { session } = await import('./stores/session')
    // ensure anonymous
    session.signOut()
    const paints: number[] = []
    const t0 = Date.now()
    const view = await refreshLanding(null, (v) => {
      const covers = (v.shelves ?? []).reduce((n, s) => n + s.events.length, 0)
      paints.push(covers)
      console.log('paint', Date.now()-t0, 'shelves', v.shelves?.map(s => `${s.id}:${s.events.length}`), 'ratings', v.ratings?.length)
    })
    console.log('final', Date.now()-t0, view.shelves?.map(s => `${s.id}:${s.events.length}`), 'pubs', view.publications.length)
    expect((view.shelves ?? []).some(s => s.events.length > 0)).toBe(true)
  }, 120_000)
})
