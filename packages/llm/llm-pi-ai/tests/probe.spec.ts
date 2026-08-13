import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverModels } from '../src/discovery.ts'
import { probeModelCapabilities } from '../src/probe.ts'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

/** One chat-completions request the probe sent, as the endpoint saw it. */
interface ChatRecord {
  role: string
  reasoningEffort?: string
  thinking?: boolean
  maxTokensField?: string
}

/** Endpoint answering `GET /models` with a listing and `POST /chat/completions` with scripted statuses. */
async function capServer(
  chatStatuses: number[],
  options: { onListed?: () => void; listing?: unknown; holdChatOpenMs?: boolean } = {},
): Promise<{ url: string; chats: ChatRecord[] }> {
  const chats: ChatRecord[] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.method === 'GET') {
      options.onListed?.()
      const listing = JSON.stringify(options.listing ?? { data: [{ id: 'm1' }, { id: 'm2' }] })
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(listing)),
      })
      response.end(listing)
      return
    }
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    request.on('end', () => {
      const parsed = JSON.parse(body) as {
        model: string
        messages: Array<{ role: string }>
        reasoning_effort?: string
        thinking?: { type: string }
        max_tokens?: number
        max_completion_tokens?: number
      }
      chats.push({
        role: parsed.messages[0]?.role ?? 'system',
        ...parsed.reasoning_effort === undefined ? {} : { reasoningEffort: parsed.reasoning_effort },
        ...parsed.thinking === undefined ? {} : { thinking: true },
        ...parsed.max_tokens !== undefined
          ? { maxTokensField: 'max_tokens' }
          : parsed.max_completion_tokens !== undefined ? { maxTokensField: 'max_completion_tokens' } : {},
      })
      if (options.holdChatOpenMs !== undefined) return
      const status = chatStatuses.shift() ?? 500
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end('{}')
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}`, chats }
}

const spec = (url: string): { baseURL: string; apiKey: string; model: string } => ({
  baseURL: url,
  apiKey: 'probe-key',
  model: 'm2',
})

describe('probeModelCapabilities', () => {
  it('confirms the levels, the output-cap field, and the developer role', async () => {
    const server = await capServer([200, 200, 200, 200])

    const facts = await probeModelCapabilities(spec(server.url))

    expect(facts).toEqual({
      efforts: { off: null, high: 'high', max: 'max' },
      maxTokensField: 'max_completion_tokens',
      developerRole: 'accepted',
    })
    expect(server.chats).toEqual([
      { role: 'system', maxTokensField: 'max_completion_tokens' },
      { role: 'system', reasoningEffort: 'high', maxTokensField: 'max_completion_tokens' },
      { role: 'system', reasoningEffort: 'max', maxTokensField: 'max_completion_tokens' },
      { role: 'developer', reasoningEffort: 'high', maxTokensField: 'max_completion_tokens' },
    ])
  })

  it('reports a rejected developer role without failing the probe', async () => {
    const server = await capServer([200, 200, 200, 400])

    const facts = await probeModelCapabilities(spec(server.url))

    expect(facts.efforts).toEqual({ off: null, high: 'high', max: 'max' })
    expect(facts.developerRole).toBe('rejected')
  })

  it('retries the baseline with max_tokens and keeps it for the rest of the probe', async () => {
    const server = await capServer([400, 200, 200, 200, 200])

    const facts = await probeModelCapabilities(spec(server.url))

    expect(facts.maxTokensField).toBe('max_tokens')
    expect(facts.efforts).toEqual({ off: null, high: 'high', max: 'max' })
    expect(server.chats[0]?.maxTokensField).toBe('max_completion_tokens')
    expect(server.chats.slice(1).every(chat => chat.maxTokensField === 'max_tokens')).toBe(true)
  })

  it('falls back to the deepseek dialect when the OpenAI dialect is refused', async () => {
    const server = await capServer([200, 400, 200, 200, 200])

    const facts = await probeModelCapabilities(spec(server.url))

    expect(facts).toMatchObject({
      efforts: { off: null, high: 'high', max: 'max' },
      thinkingFormat: 'deepseek',
      developerRole: 'accepted',
    })
    // Every effort-bearing request after the first refusal carries the thinking wrapper.
    expect(server.chats.filter(chat => chat.reasoningEffort !== undefined).slice(1).every(chat => chat.thinking)).toBe(true)
  })

  it('reports no levels when every dialect refuses them, without asking about the role', async () => {
    const server = await capServer([200, 400, 400, 400, 400])

    const facts = await probeModelCapabilities(spec(server.url))

    expect(facts).toEqual({ maxTokensField: 'max_completion_tokens' })
    expect(server.chats).toHaveLength(5)
    expect(server.chats.some(chat => chat.role === 'developer')).toBe(false)
  })

  it('fails a model the endpoint refuses on both output-cap spellings', async () => {
    const server = await capServer([400, 400])

    await expect(probeModelCapabilities(spec(server.url)))
      .resolves.toEqual({ failed: 'the endpoint refuses this model' })
  })

  it('fails with the HTTP status when the endpoint refuses the probe', async () => {
    const server = await capServer([401])

    await expect(probeModelCapabilities(spec(server.url))).resolves.toEqual({ failed: 'HTTP 401' })
  })

  it('fails an unreachable endpoint without throwing', async () => {
    await expect(probeModelCapabilities(spec('http://127.0.0.1:9/v1')))
      .resolves.toEqual({ failed: 'unreachable' })
  })

  it('fails an aborted probe without throwing', async () => {
    const server = await capServer([500])
    const controller = new AbortController()
    controller.abort()

    await expect(probeModelCapabilities({ ...spec(server.url), signal: controller.signal }))
      .resolves.toEqual({ failed: 'aborted' })
    expect(server.chats).toHaveLength(0)
  })

  it('fails a baseline retry the endpoint answers with a server error', async () => {
    const server = await capServer([400, 500])

    await expect(probeModelCapabilities(spec(server.url))).resolves.toEqual({ failed: 'HTTP 500' })
  })

  it('fails a level the endpoint answers with a server error', async () => {
    const server = await capServer([200, 500])

    await expect(probeModelCapabilities(spec(server.url))).resolves.toEqual({ failed: 'HTTP 500' })
  })

  it('fails a dialectal retry the endpoint answers with a server error', async () => {
    const server = await capServer([200, 400, 500])

    await expect(probeModelCapabilities(spec(server.url))).resolves.toEqual({ failed: 'HTTP 500' })
  })

  it('fails a probe the endpoint never answers, under its own bound', async () => {
    const server = await capServer([], { holdChatOpenMs: true })

    await expect(probeModelCapabilities({ ...spec(server.url), timeoutMs: 100 }))
      .resolves.toEqual({ failed: 'no answer within 100ms' })
  })

  it('leaves the developer role unknown when that one request fails', async () => {
    const server = await capServer([200, 200, 200, 500])

    const facts = await probeModelCapabilities(spec(server.url))

    expect(facts.efforts).toEqual({ off: null, high: 'high', max: 'max' })
    expect(facts.developerRole).toBeUndefined()
    expect(facts.failed).toBeUndefined()
  })

  it('probes unauthenticated when the draft carries no key', async () => {
    const server = await capServer([200, 200, 200, 200])

    const facts = await probeModelCapabilities({ baseURL: server.url, model: 'm2' })

    expect(facts.efforts).toEqual({ off: null, high: 'high', max: 'max' })
  })
})

describe('discoverModels capability probing', () => {
  it('probes only the picked models and attaches the facts to them', async () => {
    const server = await capServer([200, 200, 200, 200])

    const models = await discoverModels({
      baseURL: server.url,
      apiKey: 'probe-key',
      probeCapabilities: true,
      models: ['m2'],
    })

    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({
      id: 'm2',
      reasoning: {
        efforts: { off: null, high: 'high', max: 'max' },
        developerRole: 'accepted',
      },
    })
    expect(server.chats).toHaveLength(4)
  })

  it('keeps the full listing unprobed when probing was not asked', async () => {
    const server = await capServer([])

    const models = await discoverModels({ baseURL: server.url, apiKey: 'probe-key' })

    expect(models.map(model => model.id)).toEqual(['m1', 'm2'])
    expect(models.every(model => model.reasoning === undefined)).toBe(true)
    expect(server.chats).toHaveLength(0)
  })

  it('returns nothing when the picked ids are absent from the listing', async () => {
    const server = await capServer([])

    const models = await discoverModels({
      baseURL: server.url,
      apiKey: 'probe-key',
      probeCapabilities: true,
      models: ['missing'],
    })

    expect(models).toEqual([])
    expect(server.chats).toHaveLength(0)
  })

  it('keeps a picked model whose probe failed, with its short reason', async () => {
    const server = await capServer([401])

    const models = await discoverModels({
      baseURL: server.url,
      apiKey: 'probe-key',
      probeCapabilities: true,
      models: ['m2'],
    })

    expect(models[0]).toMatchObject({ id: 'm2', reasoning: { failed: 'HTTP 401' } })
  })

  it('probes every listed model unauthenticated when nothing narrows the pick, keeping capacities', async () => {
    const server = await capServer(
      [200, 200, 200, 200, 200, 200, 200, 200],
      {
        listing: {
          data: [{ id: 'rich', name: 'Rich', context_window: 1000, max_output_tokens: 100 }, { id: 'bare' }],
        },
      },
    )

    const models = await discoverModels({ baseURL: server.url, probeCapabilities: true })

    expect(models.map(model => model.id)).toEqual(['rich', 'bare'])
    expect(models[0]).toMatchObject({ id: 'rich', name: 'Rich', contextWindow: 1000, maxTokens: 100 })
    expect(models.every(model => model.reasoning?.efforts !== undefined)).toBe(true)
    expect(server.chats).toHaveLength(8)
  })

  it('skips probing for a protocol without the chat shape', async () => {
    const server = await capServer([])

    const models = await discoverModels({
      baseURL: server.url,
      apiKey: 'probe-key',
      api: 'openai-responses',
      probeCapabilities: true,
      models: ['m2'],
    })

    expect(models.map(model => model.id)).toEqual(['m1', 'm2'])
    expect(models.every(model => model.reasoning === undefined)).toBe(true)
    expect(server.chats).toHaveLength(0)
  })

  it('aborts the probing pass when the caller signal fires after the listing', async () => {
    const controller = new AbortController()
    // The abort lands after the listing response is fully read, so it reaches
    // the probing workers' own check rather than the listing fetch's.
    const server = await capServer([200, 200, 200, 200, 200, 200, 200, 200], {
      onListed: () => { setTimeout(() => { controller.abort() }, 100) },
    })

    await expect(discoverModels({
      baseURL: server.url,
      apiKey: 'probe-key',
      probeCapabilities: true,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'ABORTED' })
    // The workers stop at the abort instead of completing both probes.
    expect(server.chats.length).toBeLessThan(8)
  })
})
