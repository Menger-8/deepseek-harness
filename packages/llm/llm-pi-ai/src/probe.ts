/**
 * Minimal capability probe for one `openai-completions` model: a handful of
 * small chat-completions requests that decide, empirically, which thinking
 * levels a gateway accepts and which endpoint-dialect facts its URL cannot
 * say. The probe is the same procedure a human would run by hand — baseline,
 * one request per level, the `developer` role, and a one-request dialect
 * fallback — automated for the configuration surface's model adoption.
 *
 * Every verdict is a status code: 2xx accepts, 400 rejects the parameter, and
 * anything else fails the probe for that model with a short reason, so a
 * refused parameter can never be mistaken for an unreachable endpoint. The
 * probe never stores anything and never parses response bodies; the caller
 * owns adopting the facts into a profile.
 *
 * @module dsh-llm-pi-ai/probe
 */

import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import type { LlmDiscoveredReasoning } from '@deepseek-ai/dsh-llm'
import type { PiAiThinkingFormat } from './catalog.ts'

/** One probe's frozen endpoint facts, pre-validated by the caller. */
export interface ModelProbeSpec {
  /** Endpoint base; `/chat/completions` is appended. */
  baseURL: string
  /** Usable bearer key; absent probes unauthenticated, like the listing before it. */
  apiKey?: string
  /** Wire model id the endpoint accepts. */
  model: string
  /** Caller cancellation, combined with the probe's own timeout. */
  signal?: AbortSignal
  /** Per-request answer bound; defaults to {@link PROBE_TIMEOUT_MS}. */
  timeoutMs?: number
}

/** Upper bound on one probe request; the probe is a UX affordance, never a wait. */
const PROBE_TIMEOUT_MS = 20_000

/** Reasoning levels the probe confirms, in escalation order. */
const PROBE_LEVELS = ['high', 'max'] as const

/** A request body's one-shot facts. */
interface ProbeBody {
  /** Reasoning parameter sent, absent for the baseline. */
  reasoningEffort?: string
  /** DeepSeek-dialect thinking wrapper, absent for the OpenAI dialect. */
  thinking?: { type: 'enabled' }
  /** System message role: `system` unless the developer-role check says otherwise. */
  role: 'system' | 'developer'
  /** Output-cap field spelling. */
  maxTokensField: 'max_tokens' | 'max_completion_tokens'
}

/** One probe request's verdict; a failure always names its reason. */
type ProbeOutcome =
  | { kind: 'ok'; status: number }
  | { kind: 'refused'; status: 400 }
  | { kind: 'failed'; status: number; reason: string }

/**
 * Send one minimal chat-completions request and report its status.
 * @param spec - the frozen endpoint facts.
 * @param body - the request's parameter set.
 * @returns the outcome; a transport failure is an outcome, never a throw.
 */
async function ask(spec: ModelProbeSpec, body: ProbeBody): Promise<ProbeOutcome> {
  const boundMs = spec.timeoutMs ?? PROBE_TIMEOUT_MS
  const timeout = AbortSignal.timeout(boundMs)
  const signal = spec.signal === undefined ? timeout : AbortSignal.any([spec.signal, timeout])
  let response: Response
  try {
    response = await fetch(`${spec.baseURL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        ...spec.apiKey === undefined ? {} : { authorization: `Bearer ${spec.apiKey}` },
        'content-type': 'application/json',
        accept: 'application/json',
        ...attributionHeaders(),
      },
      body: JSON.stringify({
        model: spec.model,
        messages: [
          { role: body.role, content: 'You are a concise assistant.' },
          { role: 'user', content: 'Reply with exactly: OK' },
        ],
        [body.maxTokensField]: 16,
        ...body.reasoningEffort === undefined ? {} : { reasoning_effort: body.reasoningEffort },
        ...body.thinking === undefined ? {} : { thinking: body.thinking },
      }),
      signal,
    })
  } catch {
    if (spec.signal?.aborted) {
      return { status: 0, kind: 'failed', reason: 'aborted' }
    }
    if (timeout.aborted) {
      return { status: 0, kind: 'failed', reason: `no answer within ${boundMs}ms` }
    }
    return { status: 0, kind: 'failed', reason: 'unreachable' }
  }
  // Drain a small body so the connection returns to the pool; the verdict is the status.
  /* v8 ignore next 3 -- cancel() after a decided status settles without rejecting; unobserved best-effort cleanup. */
  await response.body?.cancel().catch(() => {
    // Cancellation after a decided status is cleanup; the verdict stands.
  })
  if (response.status >= 200 && response.status < 300) return { status: response.status, kind: 'ok' }
  if (response.status === 400) return { status: 400, kind: 'refused' }
  return { status: response.status, kind: 'failed', reason: `HTTP ${response.status}` }
}

/** The facts one completed probe sequence established. */
interface ProbedModelCapabilities {
  /** Selectable levels as `{ level: wire spelling }`, or `undefined` when none were confirmed. */
  efforts?: Record<string, string | null>
  /** Whether the `developer` system role was accepted; `undefined` when it could not be asked. */
  developerRole?: 'accepted' | 'rejected'
  /** Dialect the endpoint needs, when the OpenAI dialect was refused; `undefined` keeps detection. */
  thinkingFormat?: PiAiThinkingFormat
  /** Output-cap field the endpoint accepts; `undefined` when it could not be established. */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens'
}

/**
 * Probe one model's reasoning capability against a draft endpoint.
 * @param spec - the frozen endpoint facts and cancellation.
 * @returns the established facts, plus a short `failed` reason when the probe
 *   could not complete at all.
 */
export async function probeModelCapabilities(
  spec: ModelProbeSpec,
): Promise<LlmDiscoveredReasoning> {
  const base: ProbeBody = { role: 'system', maxTokensField: 'max_completion_tokens' }
  const baseline = await ask(spec, base)
  let maxTokensField: ProbedModelCapabilities['maxTokensField']
  if (baseline.kind === 'ok') {
    maxTokensField = 'max_completion_tokens'
  } else if (baseline.kind === 'refused') {
    // Some gateways only take `max_tokens`; one retry decides which this one is.
    const retried = await ask(spec, { ...base, maxTokensField: 'max_tokens' })
    if (retried.kind === 'ok') {
      maxTokensField = 'max_tokens'
    } else if (retried.kind === 'refused') {
      return { failed: 'the endpoint refuses this model' }
    } else {
      return { failed: retried.reason }
    }
  } else {
    return { failed: baseline.reason }
  }

  const efforts: Record<string, string | null> = {}
  let thinkingFormat: PiAiThinkingFormat | undefined
  for (const level of PROBE_LEVELS) {
    // Once the OpenAI dialect was refused, the remaining levels are asked in
    // the established dialect alone — re-asking the refused spelling would
    // only buy another 400.
    if (thinkingFormat === undefined) {
      const plain = await ask(spec, { ...base, maxTokensField, reasoningEffort: level })
      if (plain.kind === 'ok') {
        efforts[level] = level
        continue
      }
      if (plain.kind === 'failed') return { failed: plain.reason }
    }
    // The OpenAI dialect was refused (or already replaced). One DeepSeek-dialect
    // request decides whether the endpoint wants `thinking.type`; if that also
    // fails, the level genuinely is not offered.
    const dialectal = await ask(spec, {
      ...base,
      maxTokensField,
      thinking: { type: 'enabled' },
      reasoningEffort: level,
    })
    if (dialectal.kind === 'ok') {
      thinkingFormat ??= 'deepseek'
      efforts[level] = level
    } else if (dialectal.kind === 'failed') {
      return { failed: dialectal.reason }
    }
  }
  if (Object.keys(efforts).length === 0) {
    return { maxTokensField }
  }

  // Off is offered only beside a confirmed level: it means "send nothing",
  // which is byte-for-byte what naming no effort already does.
  const facts: LlmDiscoveredReasoning = {
    efforts: { off: null, ...efforts },
    maxTokensField,
    ...thinkingFormat === undefined ? {} : { thinkingFormat },
  }
  const developer = await ask(spec, {
    ...base,
    maxTokensField,
    role: 'developer',
    reasoningEffort: 'high',
    ...thinkingFormat === undefined ? {} : { thinking: { type: 'enabled' } },
  })
  if (developer.kind === 'ok') facts.developerRole = 'accepted'
  else if (developer.kind === 'refused') facts.developerRole = 'rejected'
  // Any other outcome leaves the role unknown; the user's profile or a preset
  // may still pin it, and the surface must not invent a fact it did not see.
  return facts
}
