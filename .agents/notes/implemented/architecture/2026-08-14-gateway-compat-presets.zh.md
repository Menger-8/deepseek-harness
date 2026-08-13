# Agent Note: 网关 compat 预设按主机名钉住端点方言事实

Status: implemented

[English](2026-08-14-gateway-compat-presets.md) | 中文

## 问题

OpenAI 兼容网关在一小批协议事实上各说各话，而 pi-ai 一律从端点 URL 猜测：系统角色（`system` 还是 `developer`）、输出上限字段，以及推理／工具结果回放规则都在其中。私有网关的 URL 什么也说明不了，所以猜错得足够频繁，而 harness 配置只暴露了其中两个事实——`thinkingFormat` 与 `supportsReasoningEffort`——其余全部自动检测、不可配置。

促成此事的是火山方舟（Volcengine Ark）：一个拒绝 `developer` 角色（仅接受 `system`/`assistant`/`user`/`tool`）的 OpenAI 兼容 coding 端点。pi-ai 的检测把 Ark URL 归类为标准 OpenAI 式端点，于是猜 `supportsDeveloperRole: true`；此后 pi-ai 对任何声明了推理的模型都会把系统提示发成 `developer`。在 Ark 模型上声明 `reasoningEfforts`——提供思考强度调节的文档化方式——因此会把每个请求变成 400 `InvalidParameter: messages.role`，而操作者只能看到一条死掉的路由。本 note 记录的探测证实：该端点接受 `system` 加上 OpenAI 与 DeepSeek 两种方言的 `reasoning_effort`，所以 URL 猜错的唯一事实就是角色，而 settings.yaml 里没有任何写法能纠正它。

同样的陷阱会随着未来每条渠道重演：每个撞上检测盲区的未知网关，要么动核心，要么 fork，而「哪些端点需要哪些事实」恰恰是应该属于社区、而不是属于适配器的知识。

## 决定

**profile 暴露经过挑选的 `openai-completions` compat 面。** `PiAiCompatProfile` 现在携带九个开关：既有两个加上 `supportsStore`、`supportsDeveloperRole`、`maxTokensField`、`requiresToolResultName`、`requiresAssistantAfterToolResult`、`requiresThinkingAsText` 与 `requiresReasoningContentOnAssistantMessages`。pi-ai compat 面的其余部分（grammar 工具、strict 模式、cache 控制格式、会话亲和、路由方言）保持 URL 检测。失败姿态不变：非 `openai-completions` 模型上的模型级开关使解析失败，路由级开关跳过这类模型，没有 completions 模型的路由拒绝路由级开关。

**网关预设是可选 Cordis 服务 `llm-gateway-compat-presets`。** `dsh-llm-pi-ai` 导出服务键与注册表接口——`register(hostname, compat)`、`match(baseURL)`，以及每次注册与销毁都会递增、供消费方记忆化作键的 `revision` 计数器——并在每次 profile 解析时读一次 `ctx.get`，用原始分节、注册表身份与 revision 为记忆化作键。命中的预设落在 profile 显式 `compat` 与已安装 catalog 条目之间：模型 → 路由 → 预设 → catalog → pi-ai 的 URL 猜测。预设描述的是路由 `baseURL` 实际指向的端点，因此比「路由已改指、catalog 仍按老假设作答」更可信，而 profile 总能逐字段更正。

**`@deepseek-ai/dsh-llm-gateway-presets` 以插件形式提供注册表，随 `dsh-base` 组合出厂。** 注册表对裸主机名精确匹配、对 `*.suffix` 模式跨子域匹配（精确胜过通配、更长后缀胜过更短），对重复、非法键、什么都不钉的预设失败得响亮，并存储脱离副本。插件以内置集合为其播种——唯一一条 `*.volces.com` → `supportsDeveloperRole: false`，注释点名探测依据——并把 `presets` 配置合并其上，同键替换。社区网关知识作为该包的数据贡献或提供自己注册表的插件落地；预设只钉住 compat 事实，永远不能声明推理档位——那始终是各模型 `reasoningEfforts` 的能力。

**Ark 路线现在属于配置，不再是代码。** 挂着出厂预设时，在 Ark 模型上声明 `reasoningEfforts` 的 profile 会得到档位选择器，并以 `system` 角色发出 `reasoning_effort`——与探测证实的端点行为逐字节一致。

## 备选方案

- **在上游修 pi-ai 的 `detectCompat`** ——Ark 一行，之后每个网关一轮 PR 往返，且 DSH 锁定自己的 pi-ai 版本，修复按 DSH 的节奏落地而非贡献者的。作为主线被拒；这里没有任何东西阻止上游贡献，它只会让 Ark 预设变得多余。
- **只暴露 `supportsDeveloperRole`** ——对报告症状的最小修复。被拒，因为下一个网关会撞上下一个未暴露的字段，而打开一个字段的同一份 PR 用同一套机制就能打开整个挑选集。
- **在 `llm-pi-ai` 里硬编码主机名特例** ——违背一切皆插件的姿态：网关知识会在核心里永远增长，部署不 fork 就没法加自己的。
- **采用社区 `pi-provider-volcengine-ark` 插件** ——它活在 pi 自己的插件缝上，DSH 并不装载；DSH 的等价物就是 settings profile 加本注册表，所以移植其事实为一条预设条目就是全部价值，而且它帮不了任何别的网关。
- **纯配置、无服务** ——每个部署在自己的 profile `compat` 里重述 Ark 事实，能用，但什么都共享不了。注册表让已知网关零配置，并给社区知识一个唯一归宿——这正是插件缝的意义。

## 后果

- 新网关至多需要一份带 `reasoningEfforts` 与 `compat` 块的 settings profile；已知网关除出厂预设外什么都不需要。没有核心改动、没有 fork，除非部署想要，也没有按网关的插件。
- 预设注册表是组合数据（`cordis.yml`）而非 settings 分节：按用户、按路由的更正属于 profile 的 `compat`，预设集合的 GUI 待有消费方提出需求后再做。
- 预设按字段合并到 catalog 条目之上，因此改指过的 catalog 路由在预设点名的字段上采用网关方言，而未被点名的 catalog 怪癖原样保留——与 profile 开关既有合并纪律一致。
- `revision` 契约的存在，是为了让路由首次解析之后才变动的注册表（后挂载的提供方、就地注册）仍能抵达下一次解析，而不必在每次请求间重算。
- 既有 profile 不变：预设只填补没人声明的字段，没有命中预设的路由解析与之前完全一致。

## 测试

`packages/llm/llm-pi-ai/tests/catalog.spec.ts` 覆盖预设链的每一级——预设位于显式开关之下、catalog 条目之上；条目与路由逐字段胜出；按改指路由的 `baseURL` 匹配；跳过其他协议；未命中的预设让模型原样；没有 completions 模型的路由命中预设不失败。`adapter.spec.ts` 经真实 HTTP 服务器钉住 Ark 线协议：推理模型命中 `supportsDeveloperRole: false` 预设时，首条消息为 `{role: 'system'}` 且 `reasoning_effort` 在请求中。`config.spec.ts` 持有加宽 compat 块的 schema 边界，包括 `maxTokensField` 联合。

预设包自己的套件覆盖注册表（精确／通配优先级、规范化、重复、空预设、脱离、revision、销毁）与插件（按缝键播种提供、配置合并与替换、非法键响亮拒绝、fiber 销毁后服务移除）。真实组合覆盖搭 shipped `dsh-base` 装配的便车：每个 web snapshot 与 e2e scaffold 都以含本插件的基础组合启动，provide 失败会让每个产品测试失败。

Ark 事实由探测 `probe-ark-thinking.ps1` 实证记录（`system` 角色加两种方言的 `reasoning_effort` high/max 被接受、`thinking.type` disabled 被遵守、`developer` 被拒绝）：条目注释点名这份依据，同一份探测是未来预设贡献的模板。
