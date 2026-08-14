/**
 * The model list of one pi-ai provider profile, plus the action that asks the
 * provider what it serves.
 *
 * The list is the profile's `models` array as the card holds it: an empty list
 * means "serve this route's built-in catalog", and any entry replaces that
 * catalog, so a row is only ever added deliberately. Fetching asks the endpoint
 * **the form currently shows** — including a key typed but not yet saved — so
 * adding a provider is one pass instead of save-then-return; the reply is
 * candidates the user picks from, never configuration written behind them.
 *
 * A provider that cannot be interrogated (an unreachable endpoint, a protocol
 * with no readable listing) is not a dead end: the failure is shown next to the
 * rows the user can still fill in by hand.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { DiscoveredModelView, IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatCapacity, parseCapacity } from './DeepSeekModelsEditor.tsx'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import { messageOf } from './store.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/**
 * One configured model row. Structurally open, exactly like the DeepSeek
 * catalog editor's rows: a profile field this card does not edit — one a future
 * schema adds, or one hand-written in `settings.yaml` — has to survive being
 * edited here rather than being dropped by a rebuild.
 */
export type ModelDraft = DeepSeekModelDraft

/** A row's text field, or the empty string when unset or not a string. */
function textOf(model: ModelDraft, key: string): string {
  const value = model[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Route-level compat facts a capability probe established. The owning card
 * merges them into the profile's `compat` block, so a gateway that rejects
 * the developer role — or needs a specific dialect or output-cap field — is
 * corrected by the probe the user just ran, not by a later hand edit.
 */
export interface ProbeRouteFacts {
  supportsDeveloperRole?: false
  thinkingFormat?: string
  maxTokensField?: 'max_tokens' | 'max_completion_tokens'
}

/** A row's numeric field, or `undefined` when unset or not a number. */
function numberOf(model: ModelDraft, key: string): number | undefined {
  const value = model[key]
  return typeof value === 'number' ? value : undefined
}

/** What an interrogation needs, taken from the live form. */
export interface ProbeTarget {
  /** Settings namespace whose adapter family answers. */
  settingsNs: string
  /**
   * Route being edited, when the card edits one. An adapter that already
   * describes it answers from its own registry, so such a card can ask without
   * an endpoint at all.
   */
  provider?: string
  /** Endpoint as the form currently shows it. */
  baseURL?: string
  /** Wire protocol the form names, when it names one. */
  api?: string
  /** Key typed into the form and not yet stored, when there is one. */
  apiKey?: string
}

/** Props of {@link ModelListEditor}. */
export interface ModelListEditorProps {
  /** The rows as currently drafted. */
  models: readonly ModelDraft[]
  /** Whether the user layer currently owns the whole array; absent on a create. */
  overridden?: boolean
  /** Replace the drafted rows. */
  onChange: (models: ModelDraft[]) => void
  /** Remove the user-owned array and return to inheritance; absent on a create. */
  onReset?: () => void
  /** Endpoint facts for the fetch action. */
  probe: ProbeTarget
  /**
   * Copy key naming why the fetch action is unavailable, or `undefined` when
   * it is. The card owns this because the key it would send is judged there:
   * asking with a key the form has already refused spends a round trip to be
   * told what the field already says.
   */
  probeBlocked?: keyof typeof en | undefined
  /** Wire face the fetch action calls. */
  api: Pick<IApiClient, 'llm'>
  /**
   * Report route-level compat facts the capability probe established, so the
   * owning card can merge them into the profile's `compat` block. Called once
   * per adopt when any picked model's probe found such a fact.
   */
  onProbeFacts?: (facts: ProbeRouteFacts) => void
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable every control (read-only deployment or a pending write). */
  disabled: boolean
}

/** Disclosure chevron; rotates to point down while its row is open. */
function IconChevron({ open }: { open: boolean }): ReactNode {
  return (
    <svg
      width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden
      style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 120ms ease' }}
    >
      <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Removal glyph for one model row. */
function IconTrash(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4M6.5 6.8v4.4M9.5 6.8v4.4"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

/** The two token counts edited as K/M-suffixed text behind a row's disclosure. */
type CapacityField = 'contextWindow' | 'maxTokens'

/**
 * What an empty capacity field is worth, shown as its placeholder so a row left
 * blank does not read as a model with no capacity at all.
 *
 * The magnitudes are the adapter's own route-level fallbacks (`llm-pi-ai`'s
 * `defaultContextWindow` and `defaultMaxTokens`), spelled the way a person
 * would say them. They are a hint, not a mirror: this page counts `K` as 1000,
 * so typing `256K` stores 256000 while leaving the field blank keeps the
 * adapter's 262144. A deployment that overrides those defaults is not
 * reflected here — nothing on this page can read them.
 */
const CAPACITY_HINT: Readonly<Record<CapacityField, string>> = {
  contextWindow: '256K',
  maxTokens: '32K',
}

/**
 * Spell a stored count for a field that may be unset. The spelling itself is
 * {@link formatCapacity}, shared with the DeepSeek catalog editor so both
 * surfaces read and write one K/M vocabulary.
 * @param value - stored capacity, or `undefined` for an unset field.
 * @returns the field text, empty when unset.
 */
function capacitySpelling(value: number | undefined): string {
  return value === undefined ? '' : formatCapacity(value)
}

/** Adopt a candidate, keeping whatever capacities and reasoning levels the provider disclosed. */
function adopt(candidate: DiscoveredModelView): ModelDraft {
  return {
    id: candidate.id,
    ...candidate.name === undefined ? {} : { name: candidate.name },
    ...candidate.contextWindow === undefined ? {} : { contextWindow: candidate.contextWindow },
    ...candidate.maxTokens === undefined ? {} : { maxTokens: candidate.maxTokens },
    ...candidate.reasoning?.efforts === undefined ? {} : { reasoningEfforts: candidate.reasoning.efforts },
  }
}

/** Fold one probed model's route-level facts into the card's `compat` merge. */
function foldRouteFacts(facts: ProbeRouteFacts, model: DiscoveredModelView): void {
  if (model.reasoning?.developerRole === 'rejected' && facts.supportsDeveloperRole === undefined) {
    facts.supportsDeveloperRole = false
  }
  if (model.reasoning?.thinkingFormat !== undefined && facts.thinkingFormat === undefined) {
    facts.thinkingFormat = model.reasoning.thinkingFormat
  }
  if (model.reasoning?.maxTokensField !== undefined && facts.maxTokensField === undefined) {
    facts.maxTokensField = model.reasoning.maxTokensField
  }
}

/** The confirmed levels of one probed model as `Off/High/Max`, or `undefined`. */
function levelsSummary(model: DiscoveredModelView): string | undefined {
  const efforts = model.reasoning?.efforts
  if (efforts === undefined || Object.keys(efforts).length === 0) return undefined
  return Object.keys(efforts)
    .map(level => level.charAt(0).toUpperCase() + level.slice(1))
    .join('/')
}

/** One row with its `reasoningEfforts` adopted, or the field dropped when none were confirmed. */
function withEfforts(model: ModelDraft, efforts: Record<string, string | null> | undefined): ModelDraft {
  const next = { ...model, reasoningEfforts: efforts }
  return efforts === undefined
    ? Object.fromEntries(Object.entries(next).filter(([key]) => key !== 'reasoningEfforts'))
    : next
}

/**
 * Render the model list with its fetch action.
 * @param props - the drafted rows, probe target, wire face, and copy.
 * @returns the model-list editor.
 */
export function ModelListEditor(props: ModelListEditorProps): ReactNode {
  const { models, onChange, probe, api, t, disabled } = props
  const [busy, setBusy] = useState(false)
  const [probeBusy, setProbeBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [candidates, setCandidates] = useState<readonly DiscoveredModelView[] | undefined>(undefined)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  /** The last capability probe's outcome, shown under the model list until the picker reopens. */
  const [probeNote, setProbeNote] = useState<string | undefined>(undefined)
  // Rows carry an id and a name; capacities are the exception, so they stay
  // folded until asked for rather than crowding every row with four inputs.
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())
  // Capacities are edited as text, so a field's keystrokes are held here rather
  // than re-derived from the parsed count on every change — that would rewrite
  // `1000` to `1K` mid-word. Unreadable text is kept past blur so the refusal
  // names a row the user can still see, which is why this is one entry PER
  // FIELD: a single buffer would be displaced by editing any other field, and
  // the abandoned one would render its stored NaN as the literal `NaN`.
  const [editing, setEditing] = useState<ReadonlyMap<string, string>>(new Map())

  /** Buffer key for one capacity field; the row half moves when rows do. */
  const bufferKey = (index: number, field: CapacityField): string => `${String(index)}:${field}`

  const editCapacity = (index: number, field: CapacityField, text: string): void => {
    setEditing(current => new Map(current).set(bufferKey(index, field), text))
    patch(index, { [field]: parseCapacity(text) })
  }

  /** What a capacity field shows: the buffer while typing, else the stored count. */
  const capacityText = (model: ModelDraft, index: number, field: CapacityField): string =>
    editing.get(bufferKey(index, field)) ?? capacitySpelling(numberOf(model, field))

  /** Drop one row's entries and shift the rows after it down, in one pass. */
  const reindexOnRemove = (
    current: ReadonlyMap<string, string>,
    index: number,
  ): Map<string, string> => {
    const next = new Map<string, string>()
    for (const [key, value] of current) {
      const at = Number(key.slice(0, key.indexOf(':')))
      if (at === index) continue
      // Only the row number moves; the field half of the key is untouched.
      next.set(at > index ? key.replace(/^\d+/, String(at - 1)) : key, value)
    }
    return next
  }

  const toggleExpanded = (index: number): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(index)) next.add(index)
      return next
    })
  }

  const patch = (index: number, next: Record<string, unknown>): void => {
    onChange(models.map((model, at) => {
      if (at !== index) return model
      // Rebuilt rather than spread over: an emptied optional field has to leave
      // the profile, not be stored as a value its schema would reject.
      // Spread first so a field this card does not edit survives; an emptied
      // optional field is then dropped rather than stored as a value its
      // schema would reject.
      const cleared = new Set(
        Object.entries(next).filter(([, value]) => value === undefined || value === '').map(([key]) => key),
      )
      return Object.fromEntries(
        Object.entries({ ...model, ...next }).filter(([key]) => !cleared.has(key)),
      )
    }))
  }

  /** The hand-typed rows' non-empty ids, in row order, each once. */
  const rowIds = [...new Set(models.map(model => textOf(model, 'id')).filter(id => id.length > 0))]

  /** The discoverModels payload for the form as it currently stands. */
  const probePayload = () => ({
    settingsNs: probe.settingsNs,
    ...probe.provider === undefined ? {} : { provider: probe.provider },
    ...probe.baseURL === undefined || probe.baseURL.length === 0 ? {} : { baseURL: probe.baseURL },
    ...probe.api === undefined ? {} : { api: probe.api },
    ...probe.apiKey === undefined ? {} : { apiKey: probe.apiKey },
  })

  const fetchModels = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    // A fresh interrogation replaces the previous probe's note.
    setProbeNote(undefined)
    try {
      const response = await api.llm.discoverModels(probePayload())
      if (!response.result.ok) {
        setFailure(response.result.error.message)
        return
      }
      const found = response.result.value.models
      if (found.length === 0) {
        setFailure(t('fetchEmpty'))
        return
      }
      // Everything already configured starts unchecked, so adopting a
      // selection never silently rewrites a capacity the user corrected.
      const known = new Set(models.map(model => textOf(model, 'id')))
      setCandidates(found)
      setPicked(new Set(found.filter(model => !known.has(model.id)).map(model => model.id)))
    } catch (error) {
      // The transport rejected rather than answering; without this the button
      // would stay busy with nothing shown.
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const closePicker = (): void => {
    setCandidates(undefined)
    setPicked(new Set())
  }

  /**
   * Probe the hand-typed rows for their reasoning capability and adopt the
   * facts into the rows themselves: each probed row gains (or loses) its
   * `reasoningEfforts`, and route-level facts merge into the card's `compat`
   * block exactly as the picker's probe does. The ids travel as-is, so a row
   * the endpoint's listing would not advertise is still answered.
   */
  const probeRows = async (): Promise<void> => {
    setProbeBusy(true)
    setFailure(undefined)
    // A fresh probe replaces the previous probe's note.
    setProbeNote(undefined)
    try {
      const response = await api.llm.discoverModels({
        ...probePayload(),
        probeCapabilities: true,
        models: rowIds,
      })
      if (!response.result.ok) {
        setProbeNote(t('probeRowsFailed').replace('{message}', response.result.error.message))
        return
      }
      const facts: ProbeRouteFacts = {}
      const summaries: string[] = []
      const failures: string[] = []
      const found = new Map(response.result.value.models.map(model => [model.id, model]))
      // Rows are patched in one pass against a single array, so adopting the
      // facts of several models cannot have later patches build on stale rows.
      let rows: ModelDraft[] = [...models]
      let adopted = false
      for (const model of found.values()) {
        const reasoning = model.reasoning
        // Not probed at all (a protocol without the chat shape, a catalog
        // answer): no fact was established, so the row keeps whatever it has.
        if (reasoning === undefined) continue
        if (reasoning.failed !== undefined) {
          failures.push(`${model.id} (${reasoning.failed})`)
          continue
        }
        const levels = levelsSummary(model)
        if (levels !== undefined) summaries.push(`${model.id} (${levels})`)
        foldRouteFacts(facts, model)
        // Fresh empirical facts win over what the row held: the confirmed
        // levels are written in, and a completed probe that confirmed none
        // clears a stale hand-written set.
        const index = rows.findIndex(row => textOf(row, 'id') === model.id)
        if (index === -1) continue
        rows = rows.map((row, at) => at === index ? withEfforts(row, reasoning.efforts) : row)
        adopted = true
      }
      if (adopted) onChange(rows)
      if (Object.keys(facts).length > 0) props.onProbeFacts?.(facts)
      const notes: string[] = []
      if (summaries.length > 0) notes.push(t('probeNoteProbed').replace('{summary}', summaries.join(', ')))
      if (failures.length > 0) notes.push(t('probeRowsFailedModels').replace('{summary}', failures.join(', ')))
      if (notes.length === 0) notes.push(t('probeRowsNone'))
      if (facts.supportsDeveloperRole === false) notes.push(t('probeDeveloperFixed'))
      setProbeNote(notes.join(' '))
    } catch (error) {
      setProbeNote(t('probeRowsFailed').replace('{message}', messageOf(error)))
    } finally {
      setProbeBusy(false)
    }
  }

  const adoptPicked = async (): Promise<void> => {
    /* v8 ignore next -- the dialog only renders with candidates loaded */
    if (candidates === undefined) return
    const pickedIds = [...picked]
    // Probed entries replace their candidates, so adoption below reads the
    // facts the endpoint just disclosed instead of re-asking anything.
    let probed = candidates
    if (pickedIds.length > 0) {
      setBusy(true)
      setFailure(undefined)
      setProbeNote(undefined)
      try {
        const response = await api.llm.discoverModels({
          ...probePayload(),
          probeCapabilities: true,
          models: pickedIds,
        })
        if (!response.result.ok) {
          setProbeNote(t('probeNoteFailed').replace('{message}', response.result.error.message))
        } else {
          const facts: ProbeRouteFacts = {}
          const summaries: string[] = []
          const found = new Map(response.result.value.models.map(model => [model.id, model]))
          for (const model of found.values()) {
            const levels = levelsSummary(model)
            if (levels !== undefined) summaries.push(`${model.id} (${levels})`)
            foldRouteFacts(facts, model)
          }
          if (Object.keys(facts).length > 0) props.onProbeFacts?.(facts)
          setProbeNote(summaries.length > 0
            ? t('probeNoteProbed').replace('{summary}', summaries.join(', '))
            : t('probeNoteNone'))
          if (facts.supportsDeveloperRole === false) {
            setProbeNote(current => [current, t('probeDeveloperFixed')].filter(Boolean).join(' '))
          }
          probed = candidates.map(candidate => found.get(candidate.id) ?? candidate)
        }
      } catch (error) {
        // A failed probe must not block adoption: the rows join without
        // reasoning levels, exactly as they did before probing existed.
        setProbeNote(t('probeNoteFailed').replace('{message}', messageOf(error)))
      } finally {
        setBusy(false)
      }
    }
    const byId = new Map(models.map(model => [textOf(model, 'id'), model]))
    for (const candidate of probed) {
      if (!picked.has(candidate.id)) continue
      // A row the user already tuned wins over the provider's own numbers.
      // Keyed by id, so a half-typed row whose id is still empty is not a
      // match and the candidate joins as its own row — correct, since a row
      // without an id is not yet a model and the create/apply gates refuse it.
      byId.set(candidate.id, byId.get(candidate.id) ?? adopt(candidate))
    }
    onChange([...byId.values()])
    closePicker()
  }

  const toggle = (id: string): void => {
    setPicked((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  // A route the adapter already describes answers without an endpoint; only a
  // draft with neither has nothing to ask about.
  const askable = probe.provider !== undefined || (probe.baseURL !== undefined && probe.baseURL.length > 0)
  return (
    <section className={styles['modelCatalog']} aria-label={t('models')}>
      <div className={styles['modelListHead']}>
        <div className={styles['modelCatalogHeading']}>
          <span className={styles['modelCatalogTitle']}>{t('models')}</span>
          {props.overridden === undefined
            ? null
            : (
              <span className={styles['modelCatalogMeta']}>
                {props.overridden ? t('modelsCustomized') : t('modelsInherited')}
              </span>
            )}
        </div>
        {props.overridden === true && props.onReset !== undefined
          ? (
            <button
              type="button"
              className={styles['linkButton']}
              disabled={disabled}
              onClick={props.onReset}
            >
              {t('resetModels')}
            </button>
          )
          : null}
        <button
          type="button"
          className={styles['linkButton']}
          disabled={disabled || busy || probeBusy || !askable || props.probeBlocked !== undefined}
          title={props.probeBlocked !== undefined
            ? t(props.probeBlocked)
            : askable ? undefined : t('fetchNeedsBaseUrl')}
          onClick={() => { void fetchModels() }}
        >
          {busy ? t('fetching') : t('fetchModels')}
        </button>
        {probe.baseURL !== undefined && probe.baseURL.length > 0
          ? (
            <button
              type="button"
              className={styles['linkButton']}
              disabled={disabled || busy || probeBusy || props.probeBlocked !== undefined || rowIds.length === 0}
              title={props.probeBlocked !== undefined
                ? t(props.probeBlocked)
                : rowIds.length === 0 ? t('probeModelsNeedsRows') : undefined}
              onClick={() => { void probeRows() }}
            >
              {probeBusy ? t('probeModelsBusy') : t('probeModels')}
            </button>
          )
          : null}
      </div>
      {models.length === 0 ? <p className={styles['modelEmpty']}>{t('modelsEmpty')}</p> : null}
      {models.map((model, index) => (
        <div key={index} className={styles['modelEntry']}>
          <div className={styles['modelRow']}>
            <input
              className={styles['input']}
              type="text"
              value={textOf(model, 'id')}
              placeholder={t('modelId')}
              aria-label={`${t('modelId')} ${index + 1}`}
              disabled={disabled}
              onChange={(event) => { patch(index, { id: event.target.value }) }}
            />
            <input
              className={styles['input']}
              type="text"
              value={textOf(model, 'name')}
              placeholder={t('modelName')}
              aria-label={`${t('modelName')} ${index + 1}`}
              disabled={disabled}
              onChange={(event) => { patch(index, { name: event.target.value === '' ? undefined : event.target.value }) }}
            />
            <button
              type="button"
              className={styles['iconButton']}
              aria-label={`${t('modelAdvanced')} ${index + 1}`}
              aria-expanded={expanded.has(index)}
              title={t('modelAdvanced')}
              onClick={() => { toggleExpanded(index) }}
            >
              <IconChevron open={expanded.has(index)} />
            </button>
            <button
              type="button"
              className={`${styles['iconButton']} ${styles['iconButtonDanger']}`}
              aria-label={`${t('removeModel')} ${index + 1}`}
              title={t('removeModel')}
              disabled={disabled}
              onClick={() => {
                onChange(models.filter((_model, at) => at !== index))
                // Both stores are keyed by position, so every row after this
                // one shifts down and would otherwise inherit its neighbour's
                // state — a different row's capacities popping open, or its
                // half-typed text appearing in another row's field.
                setExpanded((current) => {
                  const next = new Set<number>()
                  for (const at of current) {
                    if (at < index) next.add(at)
                    else if (at > index) next.add(at - 1)
                  }
                  return next
                })
                setEditing(current => reindexOnRemove(current, index))
              }}
            >
              <IconTrash />
            </button>
          </div>
          {expanded.has(index)
            ? (
              <div className={styles['modelAdvanced']}>
                <label className={styles['modelField']}>
                  <span className={styles['modelFieldLabel']}>{t('modelContextWindow')}</span>
                  <input
                    className={styles['input']}
                    type="text"
                    inputMode="numeric"
                    value={capacityText(model, index, 'contextWindow')}
                    placeholder={CAPACITY_HINT.contextWindow}
                    aria-label={`${t('modelContextWindow')} ${index + 1}`}
                    disabled={disabled}
                    onChange={(event) => { editCapacity(index, 'contextWindow', event.target.value) }}
                  />
                </label>
                <label className={styles['modelField']}>
                  <span className={styles['modelFieldLabel']}>{t('modelMaxTokens')}</span>
                  <input
                    className={styles['input']}
                    type="text"
                    inputMode="numeric"
                    value={capacityText(model, index, 'maxTokens')}
                    placeholder={CAPACITY_HINT.maxTokens}
                    aria-label={`${t('modelMaxTokens')} ${index + 1}`}
                    disabled={disabled}
                    onChange={(event) => { editCapacity(index, 'maxTokens', event.target.value) }}
                  />
                </label>
              </div>
            )
            : null}
        </div>
      ))}
      <button
        type="button"
        className={styles['addModelButton']}
        disabled={disabled}
        onClick={() => { onChange([...models, { id: '' }]) }}
      >
        {t('addModel')}
      </button>
      {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
      {probeNote !== undefined ? <p className={styles['probeNote']}>{probeNote}</p> : null}
      <Modal
        open={candidates !== undefined}
        onClose={closePicker}
        title={t('fetchTitle')}
        closeLabel={t('close')}
        description={t('fetchDescription')}
        className={styles['fetchDialog'] as string}
        footer={(
          <>
            <Button variant="outline" onClick={closePicker} disabled={busy}>{t('cancel')}</Button>
            <Button variant="outline" onClick={() => { void adoptPicked() }} disabled={busy}>
              {busy ? t('probing') : t('fetchAdopt')}
            </Button>
          </>
        )}
      >
        <ul className={styles['candidateList']}>
          {(candidates ?? []).map(candidate => (
            <li key={candidate.id} className={styles['candidate']}>
              <label className={styles['candidateLabel']}>
                <input
                  type="checkbox"
                  checked={picked.has(candidate.id)}
                  onChange={() => { toggle(candidate.id) }}
                />
                {/* The id alone: it is the string adoption writes, and the
                    capacities the endpoint reported are adopted with it and
                    editable in the row that appears. */}
                <span className={styles['candidateId']}>{candidate.id}</span>
              </label>
            </li>
          ))}
        </ul>
      </Modal>
    </section>
  )
}
