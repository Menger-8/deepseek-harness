# Agent Note: Gateway compat presets pin endpoint dialect facts by hostname

Status: implemented

English | [中文](2026-08-14-gateway-compat-presets.zh.md)

## Problem

OpenAI-compatible gateways disagree on a small surface of protocol facts that pi-ai guesses from the endpoint URL: the system role (`system` vs `developer`), the output-cap field, and the reasoning/tool-result replay rules among them. A private gateway's URL says nothing, so the guess is wrong often enough to matter, and the harness configuration exposed only two of the facts — `thinkingFormat` and `supportsReasoningEffort` — with everything else auto-detected and not configurable.

The motivating case is Volcengine Ark (火山方舟), an OpenAI-compatible coding endpoint that rejects the `developer` role outright (`system`/`assistant`/`user`/`tool` only). pi-ai's detection classifies the Ark URL as a standard OpenAI-style endpoint, so it guesses `supportsDeveloperRole: true`; pi-ai then sends the system prompt as `developer` for any model that declares reasoning. Declaring `reasoningEfforts` on an Ark model — the documented way to offer thinking-intensity control — therefore turned every request into a 400 `InvalidParameter: messages.role`, which the operator can only observe as a dead route. The probe recorded in this note confirmed the endpoint accepts `system` with `reasoning_effort` in both the OpenAI and DeepSeek dialects, so the one fact the URL gets wrong is the role, and no settings.yaml spelling could correct it.

The same trap recurs for every future channel: each unknown gateway that trips a detection gap costs either a core change or a fork, and "which endpoints need which facts" is knowledge that belongs in the community, not in the adapter.

## Decision

**The profile exposes the curated `openai-completions` compat surface.** `PiAiCompatProfile` now carries nine switches: the two existing ones plus `supportsStore`, `supportsDeveloperRole`, `maxTokensField`, `requiresToolResultName`, `requiresAssistantAfterToolResult`, `requiresThinkingAsText`, and `requiresReasoningContentOnAssistantMessages`. The rest of pi-ai's compat surface (grammar tools, strict mode, cache-control formats, session affinity, routing dialects) keeps its URL-derived detection. The failure postures are unchanged: a model-level switch on a non-`openai-completions` model fails resolution, a route-level switch skips past such models, and a route with no completions models refuses a route-level switch.

**Gateway presets are an optional Cordis service, `llm-gateway-compat-presets`.** `dsh-llm-pi-ai` exports the service key and the registry interface — `register(hostname, compat)`, `match(baseURL)`, and a `revision` counter bumped on every registration and disposal — and reads `ctx.get` once per profile resolution, keying its memoization on the raw section, the registry identity, and the revision. A matched preset lands between a profile's explicit `compat` and the installed catalog entry: model → route → preset → catalog → pi-ai's URL-derived guess. The preset describes the endpoint the route's `baseURL` actually names, so it beats a catalog assumption a repointed route no longer speaks for, while a profile can always correct it per field.

**`@deepseek-ai/dsh-llm-gateway-presets` provides the registry as a plugin, shipped in the `dsh-base` composition.** The registry matches bare hostnames exactly and `*.suffix` patterns across subdomains (exact beats wildcard, longer suffix beats shorter), fails loud on duplicates, invalid keys, and presets that pin nothing, and stores detached copies. The plugin seeds it with the shipped set — the one entry, `*.volces.com` → `supportsDeveloperRole: false`, named against the probe evidence — and merges its `presets` config over it, same key replacing. Community gateway knowledge lands as data contributions to that package or as plugins providing their own registry; presets pin compat facts only and can never declare reasoning levels, which remain each model's `reasoningEfforts` capability.

**The Ark route is configuration now, not code.** With the shipped preset mounted, a profile declaring `reasoningEfforts` on an Ark model gets the effort picker and sends `reasoning_effort` with the `system` role — the byte-for-byte behavior the probe proved the endpoint accepts.

## Alternatives considered

- **Fix pi-ai's `detectCompat` upstream** — one line for Ark, a PR round-trip for every subsequent gateway, and DSH pins its pi-ai version, so the fix lands on DSH's schedule, not the contributor's. Rejected as the primary; nothing here prevents an upstream contribution, which would merely make the Ark preset redundant.
- **Expose only `supportsDeveloperRole`** — the minimal fix for the reported symptom. Rejected because the next gateway trips the next unexposed field, and the same PR that opens one field opens the curated set with the same machinery.
- **Hardcode hostname special-cases in `llm-pi-ai`** — violates the everything-is-a-plugin posture: gateway knowledge would grow in core forever, and a deployment could not add its own without a fork.
- **Adopt the community `pi-provider-volcengine-ark` plugin** — lives on pi's own plugin seam, which DSH does not load; DSH's equivalent is the settings profile plus this registry, so porting its facts as a preset entry is the whole value, and it would not help any other gateway.
- **Configuration-only, no service** — every deployment restates the Ark facts in its profile `compat`, which works but shares nothing. The registry makes known gateways zero-configuration and gives community knowledge a single home, which is the point of a plugin seam.

## Consequences

- A new gateway needs, at most, a settings profile with `reasoningEfforts` and a `compat` block; a known gateway needs nothing beyond the shipped preset. No core change, no fork, no per-gateway plugin unless a deployment wants one.
- The preset registry is composition data (`cordis.yml`), not a settings section: per-user, per-route corrections belong in the profile's `compat`, and a GUI for the preset set is deferred until a consumer asks for one.
- Presets merge over the catalog entry per field, so a repointed catalog route takes the gateway's dialect for the fields the preset names while unspecified catalog quirks survive — the same merge discipline the profile switches already had.
- The `revision` contract exists so a registry mutated after a route first resolved (a later-mounted provider, an in-place registration) still reaches the next resolution without recomputing every request between changes.
- Existing profiles are unchanged: a preset only fills facts nothing stated, and routes with no matching preset resolve exactly as before.

## Testing

`packages/llm/llm-pi-ai/tests/catalog.spec.ts` covers each rung of the preset chain — preset under explicit switches and over the catalog entry, entry and route winning per field, matching against a repointed route's `baseURL`, skipping other protocols, a non-matching preset leaving the model untouched, and a preset on a route with no completions models not failing resolution. `adapter.spec.ts` pins the Ark wire contract through a real HTTP server: a reasoning model with a matched `supportsDeveloperRole: false` preset sends `{role: 'system'}` as the first message with `reasoning_effort` present. `config.spec.ts` holds the schema boundary for the widened compat block, including the `maxTokensField` union.

The presets package's own suite covers the registry (exact/wildcard precedence, normalization, duplicates, empty presets, detachment, revision, disposal) and the plugin (seeded provide under the seam key, config merge and replace, loud refusal of an invalid key, service removal on fiber disposal). Real-composition coverage rides the shipped `dsh-base` mount: every web snapshot and e2e scaffold boots the base composition including this plugin, so a failing provide would fail every product test.

The Ark facts are recorded empirically by the probe `probe-ark-thinking.ps1` (system role with `reasoning_effort` high/max accepted in both dialects, `thinking.type` disabled honored, `developer` rejected): the entry's comment names this evidence, and the same probe is the template for future preset contributions.
