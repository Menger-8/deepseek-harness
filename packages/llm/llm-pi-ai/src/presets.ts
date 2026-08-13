/**
 * The gateway-compat preset seam: an optional Cordis service that plugins
 * provide to pin `openai-completions` compatibility facts by endpoint
 * hostname, so a gateway pi-ai's URL detection does not know — Volcengine Ark
 * rejecting the `developer` role is the first shipped case — needs no core
 * change to describe. The consuming adapter (`dsh-llm-pi-ai`) reads presets
 * between a profile's explicit `compat` and the installed catalog / pi-ai
 * detection, so a preset is a default that configuration always wins over.
 *
 * @module dsh-llm-pi-ai/presets
 */

import type { PiAiCompatProfile } from './catalog.ts'

/** Cordis service key for the optional gateway-compat preset registry. */
export const LLM_GATEWAY_COMPAT_PRESETS = 'llm-gateway-compat-presets'

/**
 * Endpoint-keyed `openai-completions` compatibility presets, contributed by
 * plugins. One registry serves the whole context; the consuming adapter reads
 * it per profile resolution and keys its memoization on {@link revision}, so a
 * preset registered after a route first resolved reaches the next request.
 */
export interface LlmGatewayCompatPresets {
  /**
   * Bumped on every registration and disposal. Consumers key caches on it
   * because {@link register} mutates this registry in place.
   */
  readonly revision: number
  /**
   * Register one preset for an endpoint hostname. An exact hostname (no
   * scheme, port, or path) matches only that host; a `*.suffix` hostname
   * matches any single- or multi-label subdomain of `suffix`. A hostname that
   * is already registered fails loud.
   * @param hostname - lowercase hostname or `*.suffix` pattern.
   * @param compat - the compat facts this gateway pins.
   * @returns the disposer removing this preset.
   */
  register(hostname: string, compat: PiAiCompatProfile): () => void
  /**
   * The most specific preset whose hostname matches this endpoint, or
   * `undefined` when none does. Exact matches win over wildcards; among
   * wildcards the longest suffix wins. An unparsable endpoint matches nothing.
   * @param baseURL - endpoint base URL, path included.
   * @returns the matched preset's compat facts, or `undefined`.
   */
  match(baseURL: string): PiAiCompatProfile | undefined
}
