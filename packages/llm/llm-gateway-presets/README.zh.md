# @deepseek-ai/dsh-llm-gateway-presets

[English](README.md) | 中文

[`dsh-llm-pi-ai`](../llm-pi-ai/README.md) 适配器的网关 compat 预设：一个提供可选 `llm-gateway-compat-presets` 服务的 Cordis 插件，内置经实测的第三方网关 `openai-completions` 兼容事实——那些 pi-ai 的 URL 检测学不到的东西。适配器在解析提供方 profile 时读取该服务，因此端点主机名命中预设的路由会得到这些 compat 默认值——位于 profile 自己的 `compat` 之下、已安装 catalog 条目与 pi-ai 猜测之上。

shipped 集合是数据而非策略：部署经插件的 `presets` 配置扩展或替换条目，社区网关知识作为本包的数据贡献或提供自己注册表的插件落地——这正是新渠道永远不用动核心的原因。

## 用法

shipped `dsh-base` 组合自带内置集合挂载该插件，无需任何配置。修改集合：

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

配置字段：

- `presets` —— 按主机名模式为键的预设，合并到内置集合之上；与内置集合同名的键替换该条目。每条值携带与 profile `compat` 块相同的字段（`thinkingFormat`、`supportsReasoningEffort`、`supportsStore`、`supportsDeveloperRole`、`maxTokensField`、`requiresToolResultName`、`requiresAssistantAfterToolResult`、`requiresThinkingAsText`、`requiresReasoningContentOnAssistantMessages`）。

## 内置集合

| 主机名模式 | 事实 | 依据 |
|---|---|---|
| `*.volces.com` | `supportsDeveloperRole: false` | 火山方舟 OpenAI 兼容 coding 端点拒绝 `developer` 角色（仅接受 `system`/`assistant`/`user`/`tool`），而其推理模型在 OpenAI 方言下接受 `reasoning_effort`——检测本就猜对的部分——所以角色是 URL 猜错的唯一事实。`*.` 用一条条目覆盖所有 region 主机。 |

向这张表添加条目是数据贡献：先对着端点验证事实（对比带与不带该参数的最小探测请求即可），并把依据写进条目的注释。

## 服务缝隙

本包消费并文档化 `dsh-llm-pi-ai` 定义的扩展点；注册表契约在那里。简言之：

- `register(hostname, compat)` —— 为一个裸主机名或 `*.suffix` 模式（仅子域；`*.volces.com` 匹配 `ark.cn-beijing.volces.com` 但不匹配 `volces.com`）注册一条预设。重复主机名失败得响亮；存储的预设是脱离副本，返回的 disposer 将其移除。
- `match(baseURL)` —— 主机名匹配该端点的最具体预设：精确主机名胜过通配符，更长的后缀胜过更短的，无法解析的端点什么都不匹配。
- `revision` —— 每次注册与销毁都会递增，消费方适配器据此为活跃注册表做记忆化。

想提供自己注册表的插件改为调用 `ctx.provide(LLM_GATEWAY_COMPAT_PRESETS, registry)` 而不挂载本插件；适配器读取任何在场的服务。预设只钉住 compat 事实——推理档位始终是各模型 `reasoningEfforts` 的能力。

## 模型体验

间接地，经由 `dsh-llm-pi-ai`：它把命中预设的 compat 事实应用到自身渲染的提供方请求上。

#### KV Cache 影响

无直接影响；提供方请求组装由 `dsh-llm-pi-ai` 负责，任何请求前缀变化归它。

## 已知限制与暂缓事项

- **预设不能声明推理档位或模型**——预设只钉住网关主机名有资格支撑的 compat 事实；`reasoningEfforts` 与 `models` 列表始终是 `settings.yaml` 里的按 profile 声明。
- **每个主机名只有一条预设**——注册表拒绝重复而不是合并，因此重述 shipped 键的部署必须重述整条条目（配置按上文替换）。
- **没有 settings 界面**——预设集合是组合数据（`cordis.yml`）；按用户、按路由的更正属于 profile 的 `compat`，预设集合的 GUI 待有消费方提出需求后再做。
