---
title: 'BrowserMCP 论坛后台采集'
type: bugfix
ticket: ''
created: '2026-11-14'
status: in-progress
baseline_revision: 'bdd4003fc232a5ccfc0b439bab9f73debc03ee4f'
route: full
route_source: auto
risk: high
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

论坛新帖可能已入库，却因正文提取失败或入口不是最新流而不显示。使用已登录 Edge 的 BrowserMCP 后台获取真实帖子，并让符合发布条件的内容按来源发布时间呈现。

## Boundaries & Constraints

**Always:** 不导出或记录 cookie、凭据和个人页面；仅允许明确支持的论坛 HTTPS 来源和对应页面路径；浏览器会话离线时可恢复；限制并发和排队；保留原有发布及全文授权规则。验证各来源实际入口，对热门列表、上游没有更新或不提供最新流的情况如实报告。

**Never:** 不把浏览器的通用 MCP、任意 JavaScript、点击或发布权限开放给容器；不以标题、导航、广告或错误页冒充正文；不假定成功抓取一篇即保证实时覆盖；不影响现有 OpenCLI/X 通道。

## I/O & Edge-Case Matrix

| 场景 | 输入或状态 | 预期 | 失败处理 |
|---|---|---|---|
| 新论坛帖子 | 合法页面，存在可确认的原帖正文 | 保存正文、原文时间并继续正常分析发布 | 不包含页面导航或广告 |
| 短帖或重复标题 | 确认正文只有几十字，甚至与标题一致 | 保留真实正文；有显示价值的原帖允许进入论坛列表 | 不伪造摘要或放宽其他频道规则 |
| 失效页面 | 跳转到错误页、正文节点不存在或只有空白 | 不作为成功正文发布 | 按真实状态记录，不采集错误页 |
| 浏览器断连或过载 | BrowserMCP 或宿主桥不可用、队列已满 | 不阻塞其他来源，恢复后重试 | 有界等待和退避，不永久丢失新帖 |
| 非授权请求 | 非白名单域名、路径、跳转或任意脚本 | 拒绝 | 不接触已登录浏览器的其他页面 |

</frozen-after-approval>

## Code Map

- `packages/backend/src/providers/browser.ts`、`opencli.ts`：既有 OpenCLI 取页和串行队列；保持其 X/雪球行为。
- `packages/backend/src/content/extract.ts`：正文提取及材料修订；现有 Readability 要求 200 字，不适合短帖。
- `packages/backend/src/jobs/content.ts`、`sources/collect.ts`：正文处理、重试和 fast 来源调度；不能让单源积压占满全部浏览器或正文队列。
- `packages/backend/src/publication/publish.ts`、`rules.ts`、`pool.ts`：已确认原帖的发布条件和时间线；普通浏览按 `timeline_at` 倒序。
- `packages/backend/src/sources/config-keys.ts`、`industry/sources.json`：来源配置和允许的配置键；已存在数据库配置不会被种子覆盖。
- `docker-compose.override.yml`：本机 worker 已有 OpenCLI 中继。BrowserMCP 宿主 socket 路径会变化，容器不可直接访问。
- `tests/opencli-browser.standalone.test.ts`、`tests/extraction-consistency.test.ts`：浏览器与正文处理的既有测试约定。

## Tasks & Acceptance

**Execution:**
- [ ] `scripts/browsermcp-bridge.mjs` — 实现宿主侧受限只读桥，通过官方 stdio 启动 BrowserMCP；使用权限受限的稳定 Unix socket，只接受受限页面读取，不透传通用 MCP。限制并发、队列、超时、响应大小，关闭所建标签页并在断连后恢复。
- [ ] `packages/backend/src/providers/browsermcp.ts`、`.env.example` — 实现容器侧受限桥客户端和配置；保持其他浏览器通道不变。
- [ ] `packages/backend/src/content/extract.ts`、`packages/backend/src/sources/config-keys.ts`、`industry/sources.json` — 接入已确认的来源正文结构和短帖；校验最终 URL、空正文及错误页，清理并保留原帖而不是整页。核查集思录、韭研、淘股吧、雪球入口，修复可证实的采集缺陷。
- [ ] `packages/backend/src/jobs/content.ts`、`packages/backend/src/publication/publish.ts`、`rules.ts` — 可恢复处理桥不可用和短帖发布，确保旧来源与其他频道不变。
- [ ] `tests/browsermcp-bridge.standalone.test.ts`、`tests/forum-browser-content.test.ts` — 覆盖真实用户可见的成功、短帖、跳转、空页、容量、断连恢复和时间排序；使用隔离测试数据，不读取实际用户凭据。
- [ ] `docs/deploy.md`、`docs/sources.md` — 说明宿主桥启动、socket 挂载、来源配置、来源覆盖和失效条件。
- [ ] 本机部署 — 备份将改变的本机配置和对应数据库来源设置；配置用户服务和 worker 挂载；启用已核实来源，限制回补；不重置数据库或现有登录。

**Acceptance Criteria:**
- Given 已登录浏览器且来源有有效新帖，when 后台采集完成，then 正确原文入库并能按其可信发布时间进入前台，且不改变当前活动标签页。
- Given 空页、跳转或不可用浏览器，when 采集执行，then 不发布错误内容；浏览器恢复后无需手工重置即可继续。
- Given 其他资讯及 X 采集正在工作，when 论坛来源并发采集，then 其既有连接和处理不被无界队列拖垮。
- Given 任意日期的论坛条目，when 查询公开列表，then 有可信发布时间的条目按发布时间倒序，无可信时间的明确按发现时间回退。

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

BrowserMCP 的 Unix socket 是宿主扩展启动后动态生成的，不能直接把宿主 `/tmp` 或通用 REPL 暴露给 worker。受限桥只读取允许的具体来源页面；本地抽查东方财富帖子有 26、52 字短帖，正文可能位于 `.newstext`，整页包含广告。单篇曾重定向到错误页，必须检查实际落点。

## Verification

- 运行新增的隔离桥、短正文及发布排序测试，并运行相关既有正文/浏览器回归测试。
- 在本机已连接的 Edge 上验证论坛后台读取、正常关闭标签页及无活动标签切换；验证断连恢复。
- 用数据库与 `/api/site/pool?channel=forum` 对照原帖发布时间和真实正文，明确各来源最新入口及限制。
