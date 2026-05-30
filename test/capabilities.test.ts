import { describe, it, expect } from 'vitest'
import '../src/providers/index'
import { create, providers } from '../src/core/registry'

const all = providers()

describe('provider capabilities', () => {
  for (const name of all) {
    describe(name, () => {
      it('creates with explicit API key', () => {
        const provider = create(name, { apiKey: 'test-key' })
        expect(provider.name()).toBe(name)
      })

      it('returns capabilities', () => {
        const provider = create(name, { apiKey: 'test-key' })
        const caps = provider.capabilities()
        expect(typeof caps).toBe('object')
        expect(typeof caps.scrape).toBe('boolean')
        expect(typeof caps.screenshot).toBe('boolean')
        expect(typeof caps.navigate).toBe('boolean')
        expect(typeof caps.evaluate).toBe('boolean')
        expect(typeof caps.sessions).toBe('boolean')
        expect(typeof caps.cdp).toBe('boolean')
        expect(typeof caps.crawl).toBe('boolean')
        expect(typeof caps.pdf).toBe('boolean')
        expect(typeof caps.links).toBe('boolean')
        expect(typeof caps.search).toBe('boolean')
        expect(typeof caps.extract).toBe('boolean')
      })

      it('implements all core methods', () => {
        const provider = create(name, { apiKey: 'test-key' })
        expect(typeof provider.createSession).toBe('function')
        expect(typeof provider.getSession).toBe('function')
        expect(typeof provider.listSessions).toBe('function')
        expect(typeof provider.releaseSession).toBe('function')
        expect(typeof provider.scrape).toBe('function')
        expect(typeof provider.screenshot).toBe('function')
        expect(typeof provider.navigate).toBe('function')
        expect(typeof provider.evaluate).toBe('function')
      })
    })
  }
})

describe('capability-specific optional methods', () => {
  it('crawl providers have crawl()', () => {
    for (const name of all) {
      const provider = create(name, { apiKey: 'test-key' })
      const caps = provider.capabilities()
      if (caps.crawl) {
        expect(typeof provider.crawl).toBe('function')
      }
    }
  })

  it('pdf providers have pdf()', () => {
    for (const name of all) {
      const provider = create(name, { apiKey: 'test-key' })
      const caps = provider.capabilities()
      if (caps.pdf) {
        expect(typeof provider.pdf).toBe('function')
      }
    }
  })

  it('search providers have search()', () => {
    for (const name of all) {
      const provider = create(name, { apiKey: 'test-key' })
      const caps = provider.capabilities()
      if (caps.search) {
        expect(typeof provider.search).toBe('function')
      }
    }
  })

  it('extract providers have extract()', () => {
    for (const name of all) {
      const provider = create(name, { apiKey: 'test-key' })
      const caps = provider.capabilities()
      if (caps.extract) {
        expect(typeof provider.extract).toBe('function')
      }
    }
  })

  it('links providers have links()', () => {
    for (const name of all) {
      const provider = create(name, { apiKey: 'test-key' })
      const caps = provider.capabilities()
      if (caps.links) {
        expect(typeof provider.links).toBe('function')
      }
    }
  })
})
