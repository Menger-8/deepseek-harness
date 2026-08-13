/**
 * Gateway compat presets for the pi-ai adapter: a Cordis plugin providing the
 * `llm-gateway-compat-presets` service, seeded with protocol facts about
 * third-party OpenAI-compatible gateways that pi-ai's URL-derived detection
 * cannot learn. `dsh-llm-pi-ai` reads the service while resolving provider
 * profiles, so a route whose endpoint matches a preset gets those compat
 * defaults without restating them — and a profile's own `compat` always wins.
 *
 * The shipped set is data, not policy: deployments extend or replace entries
 * through the `presets` config, and per-route corrections belong in the
 * `llm-pi-ai` profile. Gateway knowledge for the wider community lands here
 * (or in plugins that provide their own registry), which is what keeps every
 * new channel out of the core adapter.
 *
 * ```yaml
 * - id: llm-gateway-presets
 *   name: '@deepseek-ai/dsh-llm-gateway-presets'
 *   config:
 *     presets:
 *       # Replaces the shipped entry for the same hostname pattern.
 *       '*.volces.com': { supportsDeveloperRole: false }
 *       'gateway.example.com':
 *         thinkingFormat: deepseek
 *         supportsReasoningEffort: true
 * ```
 *
 * @module @deepseek-ai/dsh-llm-gateway-presets
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { compatSchema, LLM_GATEWAY_COMPAT_PRESETS } from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiCompatProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { BUILTIN_GATEWAY_PRESETS } from './builtin.ts'
import { HostnameCompatPresetRegistry } from './presets.ts'

export { BUILTIN_GATEWAY_PRESETS } from './builtin.ts'
export { HostnameCompatPresetRegistry } from './presets.ts'

export const name = 'llm-gateway-presets'

/** The presets plugin's config: extra presets merged over the shipped set, same hostname replacing it. */
export interface Config {
  /** Presets by hostname pattern; see {@link HostnameCompatPresetRegistry.register}. */
  presets?: Record<string, PiAiCompatProfile>
}

export const Config: z<Config> = z.object({
  presets: z.dict(compatSchema),
})

/**
 * Build the registry this plugin serves: the shipped set under the configured
 * extras, each validated by the registry itself. Split out so tests and
 * callers can seed without providing the service.
 * @param config - the plugin's validated config.
 * @returns a seeded registry with the effective preset set.
 */
export function seedRegistry(config: Config): HostnameCompatPresetRegistry {
  const registry = new HostnameCompatPresetRegistry()
  const merged: Readonly<Record<string, PiAiCompatProfile>> = {
    ...BUILTIN_GATEWAY_PRESETS,
    ...config.presets,
  }
  for (const [hostname, compat] of Object.entries(merged)) registry.register(hostname, compat)
  return registry
}

/**
 * Provide the gateway-compat preset registry. The service is optional for its
 * consumer (`dsh-llm-pi-ai`), which is what lets a deployment compose the
 * adapter without this plugin and still describe every gateway from settings.
 * @param ctx - Cordis context.
 * @param config - the plugin's validated config.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.provide(LLM_GATEWAY_COMPAT_PRESETS, seedRegistry(config))
}
