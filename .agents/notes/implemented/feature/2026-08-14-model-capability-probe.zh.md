# Agent Note: 模型采纳时探测端点的推理能力

Status: implemented

[English](2026-08-14-model-capability-probe.md) | 中文

## 问题

接入第三方网关需要一份手写的 profile：即使[网关 compat 预设工作](../../implemented/architecture/2026-08-14-gateway-compat-presets.md)已让端点方言事实可配置，点亮档位选择器的两件事——按模型的 `reasoningEfforts` 声明与端点的 `compat` 修正——仍然要由一个人先自行发现、再写进 `settings.yaml`。Models 页的「获取可用模型」采纳的行只带 id 与容量，因此新加的渠道在操作者手工探测端点、解读一串 400、再编辑设置文档之前，不会出现思考强度控件。这正是本会话中 Ark 与 kmust 两个网关所需的流程，而它不应该是配置界面外包给用户的流程。

## 决定

**发现能力获得一个可选的能力探测。** `LlmModelDiscoveryRequest` 携带 `probeCapabilities` 与 `models`（被勾选的 id；探测只针对它们运行，因此列出三十个模型的网关只花几次请求，而不是每行一次），`LlmDiscoveredModel` 携带 `reasoning` 结论：`efforts`（`{ 档位: 线上拼写 }`，可直接存为 `reasoningEfforts`）、`developerRole`（`accepted`/`rejected`）、探测不得不确定时的 `thinkingFormat` 与 `maxTokensField`，以及简短的 `failed` 原因。

**探测就是把手工流程自动化并有界化**（`dsh-llm-pi-ai/src/probe.ts`）：一个基线请求决定输出上限字段（`max_completion_tokens` 被拒时重试一次 `max_tokens`），每档一次请求（`high`、`max`）决定提供哪些档位，OpenAI 方言被拒时回退到 DeepSeek 的 `thinking.type` 方言，最后一个 `developer` 角色请求决定该事实。每个裁决都是 HTTP 状态码——2xx 接受、400 拒绝该参数、其余只让该模型的探测以简短原因失败——因此被拒的参数绝不会被误认为端点不可达。每个请求受自身 20 秒超时与调用方信号的联合约束；列表之后的取消会以 `ABORTED` 中止探测段。探测只存在于 `openai-completions`——唯一具备对话形状的协议；其他协议保持列表回答、不带结论，而 catalog 路由仍从自己的注册表作答、不做探测。

**写事实的是采纳界面，不是操作者。** Models 页在用户点击「添加所选」时探测被勾选的候选（采纳是用户已决定写入的唯一时刻，所以探测搭既有往返的便车，而不是新增按钮），随后每行带着自己的 `reasoningEfforts` 被采纳，路由事实合并进 profile 的 `compat` 块——新的实证事实覆盖同字段的过时手写值。探测失败绝不阻塞采纳：行以无档位方式加入，拒绝被展示出来，与探测之前的姿态完全一致。

## 备选方案

- **在首次选择模型时探测，而不是采纳时** ——选择路径会把重写设置文档作为使用 composer 的副作用，出其不意；配置页上明确的采纳按钮则不然。被拒。
- **独立的探测 RPC** ——在 `discoverModels` 旁再设一个方法会重复发现注册缝、凭据处理与协议门禁，却没有契约收益；请求描述的本来就是同一份草稿。被拒。
- **探测全部列出的模型** ——列出五十个模型的网关会为可能永不采纳的模型花掉数百次请求；勾选 id 过滤让成本与意图成正比。被拒。
- **解析 400 响应体拿参数名** ——状态码是稳定的词汇，错误文本不是，两个网关已经各行其是。被拒。
- **在浏览器里探测** ——多数网关不发 CORS 头，且密钥会离开配置面。被拒。

## 后果

- 添加渠道现在是：URL + 密钥 → 获取 → 勾选 → 添加。行带着思考档位落地，路由带着方言事实落地，composer 在没有任何设置文档编辑的情况下出现档位选择器。
- 探测在构造上就是建议性的：它什么都不存储，界面采纳它返回的内容，被拒时降级为旧的手工填写姿态。
- 每个被勾选模型花四到六个小 chat-completions 请求、每次上限 16 个输出 token，这就是全部成本；每个请求 20 秒的上界保证挂死的端点不会拖住配置卡片。
- 探测够不到的模型按模型报告（`failed`），绝不作为列表失败，因此一个坏模型不会连累一个可用端点的其余模型。

## 测试

`packages/llm/llm-pi-ai/tests/probe.spec.ts` 对着脚本化端点驱动探测：每个档位／方言／上限字段裁决、developer 角色的接受与拒绝、按模型的失败（服务器错误、拒绝、不可达、中止、超时）以及无凭据草稿。发现层的用例覆盖勾选 id 过滤、空勾选、协议门禁与列表之后对探测段的中止。`packages/llm/llm/tests/topology.spec.ts` 钉住携带 `reasoning` 的服务投影；`packages/host/apiproxy/tests` 钉住线协议 schema 与 handler 透传。`packages/client/ui-settings-models/tests/provider-form.client.spec.tsx` 覆盖采纳时探测：事实写进行与 `compat`、拒绝与传输失败降级为普通采纳、空勾选跳过探测，以及带键入密钥的 create 卡片草稿。

同一套探测流程在实现前对火山方舟与 kmust 网关实测过，记录在 `probe-ark-thinking.ps1` 中，并继续作为未来预设贡献的判定模板。
