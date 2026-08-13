# @deepseek-ai/dsh-llm-gateway-presets

English | [中文](README.zh.md)

Gateway compat presets for the [`dsh-llm-pi-ai`](../llm-pi-ai/README.md) adapter: a Cordis plugin that provides the optional `llm-gateway-compat-presets` service, seeded with empirically verified `openai-completions` compatibility facts about third-party gateways that pi-ai's URL-derived detection cannot learn. The adapter reads the service while resolving provider profiles, so a route whose endpoint hostname matches a preset gets those compat defaults — under the profile's own `compat`, over the installed catalog entry and pi-ai's guess.

The shipped set is data, not policy: deployments extend or replace entries through the plugin's `presets` config, and community gateway knowledge lands here or in plugins that provide their own registry — which is what keeps every new channel out of the core adapter.

## Usage

The shipped `dsh-base` composition mounts the plugin with its built-in set; nothing needs configuration. To change the set:

```yaml
- id: llm-gateway-presets
  name: '@deepseek-ai/dsh-llm-gateway-presets'
  config:
    presets:
      # Replaces the shipped entry for the same hostname pattern.
      '*.volces.com':
        supportsDeveloperRole: false
        supportsStore: true
      # Adds one for a private gateway.
      'gateway.example.com':
        thinkingFormat: deepseek
        supportsReasoningEffort: true
```

Config fields:

- `presets` — presets by hostname pattern, merged over the shipped set; a key the built-in set also uses replaces that entry. Each value carries the same fields as the profile's `compat` block (`thinkingFormat`, `supportsReasoningEffort`, `supportsStore`, `supportsDeveloperRole`, `maxTokensField`, `requiresToolResultName`, `requiresAssistantAfterToolResult`, `requiresThinkingAsText`, `requiresReasoningContentOnAssistantMessages`).

## The shipped set

| Hostname pattern | Facts | Evidence |
|---|---|---|
| `*.volces.com` | `supportsDeveloperRole: false` | Volcengine Ark OpenAI-compatible coding endpoints reject the `developer` role (`system`/`assistant`/`user`/`tool` only), while their reasoning models accept `reasoning_effort` in the OpenAI dialect — which detection already guesses — so the role is the one fact the URL gets wrong. The `*.` covers every region host under one entry. |

Adding an entry to this table is a data contribution; verify the facts against the endpoint first (a minimal probe comparing requests with and without the parameter is enough) and name the evidence in the entry's comment.

## The seam

This package consumes and documents the extension point `dsh-llm-pi-ai` defines; the registry contract lives there. In short:

- `register(hostname, compat)` — add one preset for a bare hostname or a `*.suffix` pattern (subdomains only; `*.volces.com` matches `ark.cn-beijing.volces.com` but not `volces.com`). Duplicate hostnames fail loud; the stored preset is a detached copy, and the returned disposer removes it.
- `match(baseURL)` — the most specific preset whose hostname matches the endpoint: exact hostnames beat wildcards, longer suffixes beat shorter ones, an unparsable endpoint matches nothing.
- `revision` — bumped on every registration and disposal, so the consuming adapter can key its memoization on the live registry.

A plugin that wants to provide its own registry calls `ctx.provide(LLM_GATEWAY_COMPAT_PRESETS, registry)` instead of mounting this one; the adapter reads whatever service is present. Presets pin compat facts only — reasoning levels remain each model's `reasoningEfforts` capability.

## Model Experience

Indirectly, through `dsh-llm-pi-ai`, which applies a matched preset's compat facts to the provider requests it renders.

#### KV Cache effect

No direct invalidation; provider request assembly in `dsh-llm-pi-ai` owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Presets cannot declare reasoning levels or models** — a preset pins only the compat facts a gateway's hostname justifies; `reasoningEfforts` and the `models` list remain per-profile declarations in `settings.yaml`.
- **One preset key per hostname** — the registry refuses duplicates rather than merging, so a deployment restating a shipped key must restate the whole entry (config replaces, per the merge above).
- **No settings surface** — the preset set is composition data (`cordis.yml`); per-user, per-route corrections belong in the profile's `compat`, and a GUI for the preset set is deferred until a consumer asks for one.
