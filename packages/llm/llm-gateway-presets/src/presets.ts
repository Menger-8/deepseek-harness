/**
 * Hostname-keyed gateway-compat preset registry: the implementation behind the
 * `llm-gateway-compat-presets` service. A preset pins `openai-completions`
 * compatibility facts for one endpoint hostname, so a gateway pi-ai's URL
 * detection does not know can be described without touching the core adapter.
 *
 * @module dsh-llm-gateway-presets/presets
 */

import type { LlmGatewayCompatPresets, PiAiCompatProfile } from '@deepseek-ai/dsh-llm-pi-ai'

/**
 * One hostname's valid shapes. A preset key is a bare hostname or a `*.suffix`
 * pattern: no scheme, port, path, or trailing dot. Labels are letters, digits,
 * and hyphens; `*` may appear only as the first label of a wildcard.
 */
const HOSTNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

/**
 * Normalize a registered hostname and fail loud on anything the registry
 * cannot match later. A hostname that looks like a URL is a configuration
 * typo worth naming, not a key that would silently never match.
 * @param hostname - the hostname as configured.
 * @returns the normalized lowercase hostname without a trailing dot.
 */
function normalizeHostname(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase().replace(/\.+$/, '')
  if (trimmed.length === 0) throw new Error('llm-gateway-presets: preset hostname must be non-empty')
  if (trimmed.includes('://')) {
    throw new Error(`llm-gateway-presets: preset hostname "${hostname}" is a URL; preset keys are bare hostnames`
      + ' or "*.suffix" patterns')
  }
  const wildcard = trimmed.startsWith('*.')
  const labels = (wildcard ? trimmed.slice(2) : trimmed).split('.')
  for (const label of labels) {
    if (!HOSTNAME_PATTERN.test(label)) {
      throw new Error(`llm-gateway-presets: preset hostname "${hostname}" has an invalid label "${label}"`)
    }
  }
  return trimmed
}

/**
 * The hostname an endpoint names, or `undefined` when it names none. Only the
 * host part of a base URL identifies a gateway: preset keys never carry a
 * path, so the path is deliberately ignored.
 * @param baseURL - endpoint base URL, path included.
 * @returns the normalized hostname, or `undefined` for an unparsable endpoint.
 */
function hostnameOf(baseURL: string): string | undefined {
  try {
    const hostname = new URL(baseURL).hostname.toLowerCase().replace(/\.+$/, '')
    return hostname.length === 0 ? undefined : hostname
  } catch {
    return undefined
  }
}

/**
 * Endpoint-hostname-keyed registry of gateway compat presets. An exact
 * hostname beats every wildcard; among wildcards the longest suffix beats
 * shorter ones. Each registration is a detached copy, so a later mutation of
 * the caller's object cannot change what requests see, and disposal removes
 * the preset again — both bumping {@link revision}, the signal consumers key
 * their caches on.
 */
export class HostnameCompatPresetRegistry implements LlmGatewayCompatPresets {
  /** Exact hostnames, normalized, in registration order. */
  private readonly exact = new Map<string, PiAiCompatProfile>()
  /** Wildcard suffixes (the part after `*.`), in registration order. */
  private readonly wildcard = new Map<string, PiAiCompatProfile>()
  /** Bumped on every registration and disposal. */
  private currentRevision = 0

  get revision(): number {
    return this.currentRevision
  }

  register(hostname: string, compat: PiAiCompatProfile): () => void {
    const normalized = normalizeHostname(hostname)
    const wildcard = normalized.startsWith('*.')
    const key = wildcard ? normalized.slice(2) : normalized
    if (this.exact.has(key) || this.wildcard.has(key)) {
      throw new Error(`llm-gateway-presets: preset hostname "${hostname}" is already registered`)
    }
    // Detach and drop fields a schema layer left as undefined, so the stored
    // preset is exactly what requests read; a preset that pins nothing is a
    // typo worth naming, not a registration that silently does nothing.
    const frozen = Object.fromEntries(
      Object.entries(compat).filter(([, value]) => value !== undefined),
    ) as PiAiCompatProfile
    if (Object.keys(frozen).length === 0) {
      throw new Error(`llm-gateway-presets: preset hostname "${hostname}" pins no compat fields`)
    }
    ;(wildcard ? this.wildcard : this.exact).set(key, frozen)
    this.currentRevision += 1
    return () => {
      ;(wildcard ? this.wildcard : this.exact).delete(key)
      this.currentRevision += 1
    }
  }

  match(baseURL: string): PiAiCompatProfile | undefined {
    const hostname = hostnameOf(baseURL)
    if (hostname === undefined) return undefined
    const exact = this.exact.get(hostname)
    if (exact !== undefined) return exact
    let best: { suffix: string; compat: PiAiCompatProfile } | undefined
    for (const [suffix, compat] of this.wildcard) {
      if (!hostname.endsWith(`.${suffix}`)) continue
      if (best === undefined || suffix.length > best.suffix.length) best = { suffix, compat }
    }
    return best?.compat
  }
}
