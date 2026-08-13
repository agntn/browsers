import { describe, expect, it } from 'vitest'
import { Client } from '../src/core/client'

describe('Client.postResponse', () => {
  it('returns binary response data as an ArrayBuffer', async () => {
    const client = new Client({ maxRetries: 0 })
    const response = await client.postResponse(
      'data:image/png;base64,iVBORw0KGgo=',
      {},
    )

    const data = await response.arrayBuffer()

    expect(response.headers.get('content-type')).toBe('image/png')
    expect(data).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(data)).toEqual(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    )
  })

  it('parses JSON response data after reading as an ArrayBuffer', async () => {
    const client = new Client({ maxRetries: 0 })
    const response = await client.postResponse(
      'data:application/json,%7B%22success%22%3Atrue%7D',
      {},
    )

    await expect(response.json()).resolves.toEqual({ success: true })
  })
})
