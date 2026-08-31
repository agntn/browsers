import { fileURLToPath } from 'node:url'
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'
import browsersExtension, {
  resolveBrowsersModuleUrl,
} from '../packages/pi/extensions/browsers'

const browsersMock = vi.hoisted(() => ({
  create: vi.fn(),
  resolveProvider: vi.fn(),
}))

vi.mock('../src/index', () => browsersMock)

type ExecutableTool = {
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    context: ExtensionContext,
  ) => Promise<AgentToolResult<unknown>>
}

function registerTools(): Map<string, ToolDefinition> {
  const tools = new Map<string, ToolDefinition>()
  const api = {
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool)
    },
  }
  browsersExtension(api as unknown as ExtensionAPI)
  return tools
}

function requireTool(tools: Map<string, ToolDefinition>, name: string): ExecutableTool {
  const tool = tools.get(name)
  expect(tool).toBeDefined()
  return tool as ExecutableTool
}

describe('browsers Pi extension', () => {
  it('loads current source instead of a potentially stale build', () => {
    expect(fileURLToPath(resolveBrowsersModuleUrl())).toBe(
      fileURLToPath(new URL('../src/index.ts', import.meta.url)),
    )
  })

  it('keeps session connection credentials out of tool output', async () => {
    const secretUrl = 'wss://connect.example.test?token=secret&signingKey=jwt'
    const provider = {
      createSession: vi.fn().mockResolvedValue({
        id: 'session-1',
        provider: 'steel',
        cdpUrl: secretUrl,
        createdAt: 1_000,
        metadata: {
          liveUrl: 'https://live.example.test?token=secret',
          token: 'raw-provider-token',
        },
      }),
    }
    browsersMock.resolveProvider.mockReturnValue('steel')
    browsersMock.create.mockReturnValue(provider)

    const result = await requireTool(registerTools(), 'browsers_session').execute(
      'test',
      { provider: 'steel' },
      undefined,
      undefined,
      {} as ExtensionContext,
    )

    expect(result.content).toEqual([
      { type: 'text', text: '[provider=steel] Session created: session-1' },
    ])
    expect(result.details).toEqual({
      session: { id: 'session-1', provider: 'steel', createdAt: 1_000 },
    })
    expect(JSON.stringify(result)).not.toContain(secretUrl)
    expect(JSON.stringify(result)).not.toContain('raw-provider-token')
  })
})
