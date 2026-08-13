/**
 * The gateway compat presets this plugin ships. Each entry is a protocol fact
 * about a third-party endpoint that pi-ai's URL-derived detection cannot
 * learn, verified against the endpoint before landing — never a preference.
 * Deployments extend or replace these through the plugin's `presets` config;
 * per-route corrections belong in the `llm-pi-ai` profile's own `compat`.
 *
 * @module dsh-llm-gateway-presets/builtin
 */

import type { PiAiCompatProfile } from '@deepseek-ai/dsh-llm-pi-ai'

/** The gateway compat presets this plugin ships, keyed by hostname pattern; see the file header for the contribution rule. */
export const BUILTIN_GATEWAY_PRESETS: Readonly<Record<string, PiAiCompatProfile>> = {
  // Volcengine Ark (火山方舟) OpenAI-compatible coding endpoints reject the
  // `developer` system role — only `system`/`assistant`/`user`/`tool` are
  // accepted — while their reasoning models keep thinking enabled by default
  // and accept `reasoning_effort` in the OpenAI dialect, which detection
  // already guesses correctly. The one fact their URL would get wrong is the
  // role, so the preset pins exactly that. The `*.` covers every Ark region
  // host (ark.cn-beijing, ark.cn-shanghai, …) under one entry.
  '*.volces.com': { supportsDeveloperRole: false },
}
