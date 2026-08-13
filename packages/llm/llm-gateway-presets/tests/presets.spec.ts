import { describe, expect, it } from 'vitest'
import type { PiAiCompatProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { HostnameCompatPresetRegistry } from '../src/presets.ts'

describe('hostname matching', () => {
  it('matches an exact hostname and ignores the endpoint path', () => {
    const registry = new HostnameCompatPresetRegistry()
    registry.register('ark.cn-beijing.volces.com', { supportsDeveloperRole: false })

    expect(registry.match('https://ark.cn-beijing.volces.com/api/coding/v3'))
      .toEqual({ supportsDeveloperRole: false })
    expect(registry.match('https://ark.cn-beijing.volces.com/other/path'))
      .toEqual({ supportsDeveloperRole: false })
    expect(registry.match('https://ark.cn-shanghai.volces.com/api/v3')).toBeUndefined()
  })

  it('matches a wildcard preset against any subdomain of its suffix', () => {
    const registry = new HostnameCompatPresetRegistry()
    registry.register('*.volces.com', { supportsDeveloperRole: false })

    expect(registry.match('https://ark.cn-beijing.volces.com/v3'))
      .toEqual({ supportsDeveloperRole: false })
    expect(registry.match('https://a.b.volces.com/v3'))
      .toEqual({ supportsDeveloperRole: false })
    // The suffix itself is not a subdomain of itself.
    expect(registry.match('https://volces.com/v3')).toBeUndefined()
  })

  it('prefers an exact hostname over wildcards and the longest suffix among wildcards', () => {
    const registry = new HostnameCompatPresetRegistry()
    registry.register('*.com', { maxTokensField: 'max_tokens' })
    registry.register('*.volces.com', { supportsDeveloperRole: false })
    // Registered before the shorter suffix below: the longer match must win
    // and a later, shorter wildcard must not displace it.
    registry.register('*.a.b.example', { requiresToolResultName: true })
    registry.register('*.example', { supportsStore: true })
    registry.register('ark.cn-beijing.volces.com', { thinkingFormat: 'deepseek' })

    expect(registry.match('https://ark.cn-beijing.volces.com/v3')).toEqual({ thinkingFormat: 'deepseek' })
    expect(registry.match('https://other.volces.com/v3')).toEqual({ supportsDeveloperRole: false })
    expect(registry.match('https://example.com/v3')).toEqual({ maxTokensField: 'max_tokens' })
    expect(registry.match('https://x.a.b.example/v3')).toEqual({ requiresToolResultName: true })
    expect(registry.match('https://unrelated.example/v3')).toEqual({ supportsStore: true })
  })

  it('matches nothing for an unparsable or hostless endpoint', () => {
    const registry = new HostnameCompatPresetRegistry()
    registry.register('example.com', { supportsDeveloperRole: false })

    expect(registry.match('not a url')).toBeUndefined()
    expect(registry.match('')).toBeUndefined()
    expect(registry.match('file:///tmp')).toBeUndefined()
  })

  it('stops matching a disposed wildcard registration too', () => {
    const registry = new HostnameCompatPresetRegistry()
    const dispose = registry.register('*.volces.com', { supportsDeveloperRole: false })
    expect(registry.match('https://ark.cn-beijing.volces.com/v3')).toEqual({ supportsDeveloperRole: false })

    dispose()
    expect(registry.revision).toBe(2)
    expect(registry.match('https://ark.cn-beijing.volces.com/v3')).toBeUndefined()
  })

  it('normalizes case and a trailing dot on both sides', () => {
    const registry = new HostnameCompatPresetRegistry()
    registry.register('EXAMPLE.COM.', { supportsDeveloperRole: false })

    expect(registry.match('https://example.com./v1')).toEqual({ supportsDeveloperRole: false })
  })
})

describe('registration contract', () => {
  it('refuses a hostname that looks like a URL', () => {
    const registry = new HostnameCompatPresetRegistry()
    expect(() => registry.register('https://example.com/v1', { supportsDeveloperRole: false }))
      .toThrow(/is a URL/)
  })

  it('refuses an empty hostname and an empty wildcard suffix', () => {
    const registry = new HostnameCompatPresetRegistry()
    expect(() => registry.register('', { supportsDeveloperRole: false })).toThrow(/non-empty/)
    expect(() => registry.register('*.', { supportsDeveloperRole: false })).toThrow(/invalid label/)
  })

  it('refuses a duplicate hostname, exact or wildcard', () => {
    const registry = new HostnameCompatPresetRegistry()
    registry.register('example.com', { supportsDeveloperRole: false })
    expect(() => registry.register('example.com', { supportsStore: true })).toThrow(/already registered/)
    registry.register('*.example.org', { supportsStore: true })
    expect(() => registry.register('*.example.org', { supportsStore: false })).toThrow(/already registered/)
  })

  it('refuses a preset that pins no compat fields and drops undefined-valued ones', () => {
    const registry = new HostnameCompatPresetRegistry()
    expect(() => registry.register('example.com', {})).toThrow(/pins no compat fields/)
    // Undefined-valued keys are the shape a schema layer materializes; the
    // casts mirror that runtime boundary, which the literal type cannot express.
    expect(() => registry.register(
      'example.com',
      { supportsDeveloperRole: undefined } as unknown as PiAiCompatProfile,
    )).toThrow(/pins no compat fields/)

    registry.register(
      'kept.example',
      { supportsDeveloperRole: false, thinkingFormat: undefined } as unknown as PiAiCompatProfile,
    )
    expect(registry.match('https://kept.example/v1')).toEqual({ supportsDeveloperRole: false })
  })

  it('detaches the stored preset from the caller object', () => {
    const registry = new HostnameCompatPresetRegistry()
    const compat = { supportsDeveloperRole: false }
    registry.register('example.com', compat)
    compat.supportsDeveloperRole = true

    expect(registry.match('https://example.com/v1')).toEqual({ supportsDeveloperRole: false })
  })

  it('bumps the revision on registration and disposal, and disposal removes the match', () => {
    const registry = new HostnameCompatPresetRegistry()
    expect(registry.revision).toBe(0)

    const dispose = registry.register('example.com', { supportsDeveloperRole: false })
    expect(registry.revision).toBe(1)
    expect(registry.match('https://example.com/v1')).toEqual({ supportsDeveloperRole: false })

    dispose()
    expect(registry.revision).toBe(2)
    expect(registry.match('https://example.com/v1')).toBeUndefined()
  })
})
