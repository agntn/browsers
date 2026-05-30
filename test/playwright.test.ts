import { describe, it, expect, afterAll } from 'vitest'
// Import providers/index to register all providers
import '../src/providers/index'
import { create } from '../src/core/registry'
import type { BrowserSession } from '../src/core/types'

describe('playwright provider (local)', () => {
  const provider = create('playwright')
  const sessions: BrowserSession[] = []

  afterAll(async () => {
    for (const s of sessions) {
      await provider.releaseSession(s.id).catch(() => {})
    }
  })

  it('has correct capabilities', () => {
    const caps = provider.capabilities()
    expect(caps.scrape).toBe(true)
    expect(caps.screenshot).toBe(true)
    expect(caps.navigate).toBe(true)
    expect(caps.evaluate).toBe(true)
    expect(caps.sessions).toBe(true)
    expect(caps.cdp).toBe(false)
    expect(caps.crawl).toBe(true)
    expect(caps.pdf).toBe(true)
    expect(caps.links).toBe(true)
  })

  it('creates and releases a session', async () => {
    const session = await provider.createSession({ headless: true })
    sessions.push(session)
    expect(session.id).toBeTruthy()
    expect(session.provider).toBe('playwright')

    const listed = await provider.listSessions()
    expect(listed.some(s => s.id === session.id)).toBe(true)

    await provider.releaseSession(session.id)
    sessions.pop()

    const after = await provider.listSessions()
    expect(after.some(s => s.id === session.id)).toBe(false)
  })

  it('scrapes a data: URL', async () => {
    const result = await provider.scrape('data:text/html,<html><head><title>Test</title></head><body>Hello</body></html>')
    expect(result.html).toContain('Hello')
    expect(result.title).toBe('Test')
    expect(result.text).toContain('Hello')
  })

  it('navigates and evaluates in a session', async () => {
    const session = await provider.createSession({ headless: true })
    sessions.push(session)

    await provider.navigate('data:text/html,<html><body><p id="msg">World</p></body></html>', session)
    const evalResult = await provider.evaluate('document.getElementById("msg").textContent', session)
    expect(evalResult.value).toBe('World')

    await provider.releaseSession(session.id)
    sessions.pop()
  })

  it('takes screenshot in a session', async () => {
    const session = await provider.createSession({ headless: true })
    sessions.push(session)

    await provider.navigate('data:text/html,<html><body>Screen</body></html>', session)
    const screenshot = await provider.screenshot({ fullPage: true }, session)
    expect(screenshot.data).toBeTruthy()
    expect(screenshot.mimeType).toBe('image/png')

    await provider.releaseSession(session.id)
    sessions.pop()
  })
})
