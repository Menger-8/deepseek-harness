# Agent Note: Model adoption probes the endpoint for reasoning capability

Status: implemented

English | [中文](2026-08-14-model-capability-probe.zh.md)

## Problem

Adding a third-party gateway cost a hand-written profile: even after the [gateway-compat preset work](../../implemented/architecture/2026-08-14-gateway-compat-presets.md) made endpoint dialect facts configurable, the two facts that turn the effort picker on — the per-model `reasoningEfforts` declaration and the endpoint's `compat` corrections — still had to be written into `settings.yaml` by a person who first had to discover them. The Models page's "fetch available models" adopted rows that carried nothing but an id and capacities, so a freshly added channel showed no thinking-intensity control until the operator probed the endpoint by hand, interpreted the 400s, and edited the settings document. That is exactly the procedure the Ark and kmust gateways in this session required, and it is not a procedure a configuration surface should outsource.

## Decision

**Discovery gains an opt-in capability probe.** `LlmModelDiscoveryRequest` carries `probeCapabilities` and `models` (the picked ids; the probe runs for exactly those, so a thirty-model listing costs a handful of requests, never a probe per row), and `LlmDiscoveredModel` carries `reasoning` facts: `efforts` (`{ level: wire spelling }`, ready to store as `reasoningEfforts`), `developerRole` (`accepted`/`rejected`), `thinkingFormat` and `maxTokensField` when the probe had to establish them, and a short `failed` reason.

**The probe is the hand procedure, automated and bounded** (`dsh-llm-pi-ai/src/probe.ts`): a baseline request decides the output-cap field (one `max_tokens` retry when `max_completion_tokens` is refused), one request per level (`high`, `max`) decides which are offered, a refused OpenAI dialect falls back to the DeepSeek `thinking.type` dialect, and one `developer`-role request decides that fact. Every verdict is the HTTP status — 2xx accepts, 400 refuses the parameter, anything else fails that model's probe with a short reason — so a refused parameter is never mistaken for an unreachable endpoint. Each request is bounded by its own 20s timeout combined with the caller's signal; a cancellation after the listing aborts the probing pass with `ABORTED`. Probing only exists on `openai-completions`, the one protocol with the chat shape; every other protocol keeps the listing answer, facts absent, and a catalog route still answers from its own registry without probing.

**The adopting surface writes the facts, not the operator.** The Models page probes the picked candidates when the user clicks "Add selected" (adoption is the one moment the user has already decided to write, so the probe rides an existing round trip rather than a new button), then adopts each row with its `reasoningEfforts` and merges the route facts into the profile's `compat` block — the fresh empirical facts winning over a stale hand-written value for the same field. A failed probe never blocks adoption: the rows join without levels and the refusal is shown, exactly the pre-probe posture.

## Alternatives considered

- **Probe on first model selection instead of adoption** — the selection path would silently rewrite the settings document as a side effect of using the composer, surprising in a way a configuration page's explicit adopt button is not. Rejected.
- **A separate probe RPC** — a second method beside `discoverModels` would duplicate the discovery registration seam, the credential handling, and the protocol gating for no contract gain; the request already describes the same draft. Rejected.
- **Probe every listed model** — a gateway listing fifty models costs hundreds of requests for models the user may never adopt; the picked-id filter keeps the cost proportional to the intent. Rejected.
- **Parse 400 bodies for parameter names** — status codes are the stable vocabulary; error text is not, and two gateways already differ in it. Rejected.
- **Probe in the browser** — most gateways send no CORS headers, and the key would leave the configuration plane. Rejected.

## Consequences

- Adding a channel is now: URL + key → fetch → pick → add. The rows land with their thinking levels, the route lands with its dialect facts, and the composer shows the effort picker without any settings-document edit.
- The probe is advisory by construction: it stores nothing, the surface adopts what it returns, and a refusal degrades to the old hand-entry posture.
- Four to six small chat-completions requests per picked model, each capped at 16 output tokens, are the whole cost; the 20s per-request bound keeps a hung endpoint from stalling the configuration card.
- A model the probe cannot reach is reported per model (`failed`), never as a listing failure, so one bad model does not deny the rest of a working endpoint.

## Testing

`packages/llm/llm-pi-ai/tests/probe.spec.ts` drives the probe against a scripted endpoint: every level/dialect/cap-field verdict, the developer-role acceptance and rejection, per-model failures (server error, refusal, unreachability, abort, timeout), and the unauthenticated draft. The discovery-level cases cover picked-id filtering, empty picks, protocol gating, and a post-listing abort of the probing pass. `packages/llm/llm/tests/topology.spec.ts` pins the service projection that carries `reasoning` through; `packages/host/apiproxy/tests` pins the wire schema and the handler passthrough. `packages/client/ui-settings-models/tests/provider-form.client.spec.tsx` covers the adopt-time probe: facts written into rows and `compat`, refusal and transport failure degrading to plain adoption, empty picks skipping the probe, and the create-card draft with a typed key.

The same probe procedure, run against Volcengine Ark and the kmust gateway before implementation, is recorded in `probe-ark-thinking.ps1` and remains the template for judging future preset contributions.
