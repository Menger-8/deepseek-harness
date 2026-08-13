import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LLM_GATEWAY_COMPAT_PRESETS } from '@deepseek-ai/dsh-llm-pi-ai'
import type { LlmGatewayCompatPresets } from '@deepseek-ai/dsh-llm-pi-ai'
import * as GatewayPresets from '../src/index.ts'
import type { Config } from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** Mount the plugin and return its context. */
async function mount(config: Config = {}): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(GatewayPresets, config)
  return ctx
}

/** The service the plugin provided, or a loud failure. */
function registryOf(ctx: Context): LlmGatewayCompatPresets {
  const registry = ctx.get(LLM_GATEWAY_COMPAT_PRESETS) as LlmGatewayCompatPresets | undefined
  if (registry === undefined) throw new Error('the preset service is absent')
  return registry
}

describe('the gateway-presets plugin', () => {
  it('provides the seeded registry under the seam key', async () => {
    const ctx = await mount()
    expect(ctx.get(LLM_GATEWAY_COMPAT_PRESETS)).toBeDefined()
    // The shipped Ark entry answers for every region host.
    expect(registryOf(ctx).match('https://ark.cn-beijing.volces.com/api/coding/v3'))
      .toEqual({ supportsDeveloperRole: false })
    expect(registryOf(ctx).match('https://api.deepseek.com/v1')).toBeUndefined()
  })

  it('extends and replaces the shipped set through its config', async () => {
    const ctx = await mount({
      presets: {
        '*.volces.com': { supportsDeveloperRole: false, supportsStore: true },
        'gateway.example.com': { thinkingFormat: 'deepseek' },
      },
    })
    expect(registryOf(ctx).match('https://ark.cn-beijing.volces.com/v3'))
      .toEqual({ supportsDeveloperRole: false, supportsStore: true })
    expect(registryOf(ctx).match('https://gateway.example.com/v1'))
      .toEqual({ thinkingFormat: 'deepseek' })
  })

  it('refuses a config preset the registry cannot accept', async () => {
    await expect(mount({ presets: { 'not a hostname!': { supportsDeveloperRole: false } } }))
      .rejects.toThrow(/invalid label/)
  })

  it('removes the service when its fiber disposes', async () => {
    const ctx = await mount()
    await ctx.fiber.dispose()
    expect(ctx.get(LLM_GATEWAY_COMPAT_PRESETS)).toBeUndefined()
  })
})
