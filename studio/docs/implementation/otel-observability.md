# Agent Chat OTel 实现说明

## 文档目的

本文档描述当前仓库中已经落地的 OTel 接入方式，按实际代码行为编写，不再保留未实现的设计假设。

覆盖范围：

- `studio` 侧 `POST /api/dip-studio/v1/chat/agent`
- Hydra introspect 调用
- Studio 到 OpenClaw 的 WebSocket RPC 与 SSE 桥接
- `dip` 插件在 OpenClaw runtime hook 中创建的 agent / llm / tool / subagent / session spans
- `dip` 插件自身在 `gateway_start` / `gateway_stop` 的 OTel 启停逻辑

不覆盖：

- `studio` 其他 HTTP 路由
- 未接入内部子 span 的插件工具实现
- 尚未真正接通的跨 WebSocket trace 关联

## 当前实现概览

### Studio

代码入口：

- `src/server.ts`
- `src/app.ts`
- `src/infra/otel/config.ts`
- `src/infra/otel/init.ts`
- `src/infra/otel/tracing.ts`
- `src/infra/otel/propagation.ts`
- `src/infra/hydra-http-client.ts`
- `src/infra/openclaw-chat-agent-client.ts`
- `src/routes/chat.ts`

实际行为：

1. `bootstrapServer()` 在启动 HTTP 服务前执行 `initOtel()`。
2. `createChatAgentTracingMiddleware()` 仅为 `/api/dip-studio/v1/chat/agent` 创建 `studio.http.chat_agent` server span。
3. Hydra introspect 通过 `fetchWithTrace()` 发送 HTTP 请求，并写入 `traceparent` / `tracestate` 头。
4. `chat.ts` 不再显式创建新的业务主 span，只在当前 active span 上补充 `agentId`、`sessionKey`、`userId`、`idempotencyKey` 等属性。
5. `openclaw-chat-agent-client.ts` 会创建四个内部 span：
   - `studio.openclaw.connect`
   - `studio.openclaw.sessions_patch`
   - `studio.openclaw.chat_send`
   - `studio.openclaw.stream`
6. `studio.openclaw.stream` 在收到 `chat.send` ack 后补写 `gen_ai.agent.run_id`，在请求取消、上游异常、流完成时结束。

### DIP 插件

代码入口：

- `deploy/openclaw-extensions/dip/index.ts`
- `deploy/openclaw-extensions/dip/src/otel-config.ts`
- `deploy/openclaw-extensions/dip/src/otel-runtime.ts`
- `deploy/openclaw-extensions/dip/src/otel-context.ts`
- `deploy/openclaw-extensions/dip/src/otel-trace.ts`
- `deploy/openclaw-extensions/dip/src/agent-observability-hooks.ts`

实际行为：

1. 插件启动时同时注册：
   - `registerDipOtelGatewayHooks(api)`
   - `registerAgentObservabilityHooks(api)`
2. `gateway_start` 时：
   - 若 `OTEL_TRACE_EXPORTER=local|both` 且当前全局 tracer provider 可追加 processor，则只追加 `ConsoleSpanExporter`
   - 否则尝试按环境变量启动一个独立 `NodeSDK`
3. `gateway_stop` 时仅关闭插件自己启动的独立 `NodeSDK`
4. runtime hook 负责创建以下 spans：
   - `openclaw.session.start`
   - `openclaw.agent.run`
   - `openclaw.llm.call`
   - `openclaw.tool.call`
   - `openclaw.subagent.run`
   - `openclaw.session.end`

## 当前 span 结构

### Studio 侧

```text
studio.http.chat_agent
  -> studio.auth.hydra_introspect
  -> studio.openclaw.connect
  -> studio.openclaw.sessions_patch
  -> studio.openclaw.chat_send
  -> studio.openclaw.stream
```

说明：

- `studio.http.chat_agent` 由 Express middleware 创建。
- `studio.auth.hydra_introspect` 是内部 span，不是独立的 HTTP middleware span。
- `studio.openclaw.stream` 覆盖整个 SSE 桥接生命周期。

### OpenClaw / DIP 插件侧

```text
openclaw.session.start
openclaw.agent.run
  -> openclaw.llm.call
  -> openclaw.tool.call
  -> openclaw.subagent.run
openclaw.session.end
```

说明：

- `openclaw.session.start` 和 `openclaw.session.end` 是即时标记 span，创建后立即结束，不是长生命周期父 span。
- `openclaw.agent.run` 在 `before_agent_start` 创建，在 `agent_end` 结束。
- `openclaw.llm.call` 通过 `llm_input` / `llm_output` 成对管理。
- `openclaw.tool.call` 通过 `before_tool_call` / `after_tool_call` 成对管理。
- `openclaw.subagent.run` 通过 `subagent_spawning` / `subagent_spawned` / `subagent_ended` 管理。

## 配置项

Studio 与 DIP 插件共用同一套环境变量约定。

### 已实现的环境变量

- `OTEL_TRACE_ENABLED`
- `OTEL_SERVICE_NAME`
- `OTEL_SERVICE_VERSION`
- `OTEL_ENVIRONMENT`
- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_TRACE_EXPORTER`
- `OTEL_TRACE_SAMPLING_RATE`
- `OTEL_LOG_ENABLED`
- `OTEL_LOG_LEVEL`
- `OTEL_LOG_EXPORTER`

### 语义说明

- `OTEL_TRACE_EXPORTER` 取值：`otlp` / `local` / `both`
- `OTEL_LOG_EXPORTER` 取值：`otlp` / `local` / `both`
- `OTEL_EXPORTER_OTLP_ENDPOINT` 必须是带 scheme 的完整 URL，例如 `http://otelcol-contrib:4318`
- 代码会自动把 trace exporter URL 补成 `.../v1/traces`
- 代码会自动把 log exporter URL 补成 `.../v1/logs`
- 若 trace 与 log 都关闭，Studio/DIP 都不会启动 `NodeSDK`
- 若选择了 OTLP trace 或 OTLP log，但未提供 `OTEL_EXPORTER_OTLP_ENDPOINT`，Studio/DIP 都会跳过 `NodeSDK` 启动

### `diag` 日志与 OTel logs 的区别

当前仓库里同时存在两类“日志”概念，作用完全不同：

- `diag` 日志
  - 来自 `@opentelemetry/api` 的 `diag.debug/info/warn/error`
  - 主要用于输出启动诊断信息，以及 `studio-chat` / `studio-chat-client` 这类应用侧调试日志
  - 默认输出到进程控制台
  - 是否输出由 `OTEL_LOG_LEVEL` 控制
- OTel logs
  - 指 `NodeSDK` 的 `logRecordProcessor` 与 `OTLPLogExporter` / `ConsoleLogRecordExporter`
  - 是否启用由 `OTEL_LOG_ENABLED` 控制
  - 输出目的地由 `OTEL_LOG_EXPORTER` 控制

这两个开关彼此独立：

- `OTEL_LOG_ENABLED=false` 只表示“不启动 OTel log exporter 管线”
- `OTEL_LOG_LEVEL=info` 仍然会让 `diag.info(...)` 输出到控制台
- 若希望控制台不再打印 `diag` 日志，应设置 `OTEL_LOG_LEVEL=none`
- 若只想保留告警与错误，可设置 `OTEL_LOG_LEVEL=warn`

当前仓库中常见的 `diag` 控制台输出包括：

- `studio-otel: ...`
- `component=studio-chat event=...`
- `component=studio-chat-client event=...`

### 应用侧 `diag` 日志约定

对于 `studio-chat` / `studio-chat-client` 这类应用侧 `diag` 日志，当前实现采用单行 `logfmt` 风格文本，而不是 JSON：

```text
component=studio-chat event=proxy_start agent_id=... attachments_count=0 has_session_label=true
component=studio-chat-client event=chat_send_ack run_id=...
```

当前已经稳定使用的字段约定如下：

- 必填字段
  - `component`
  - `event`
- 按场景追加的关联字段
  - `agent_id`
  - `session_key`
  - `run_id`
- 按场景追加的结果字段
  - `upstream_status`
  - `attachments_count`
  - `has_session_label`
  - `error_type`
  - `error_message`

约束：

- `component` 用于区分日志来源模块，当前已使用值包括 `studio-chat`、`studio-chat-client`
- `event` 表示稳定事件名，应优先使用下划线命名，例如 `proxy_start`、`upstream_ready`、`chat_send_ack`
- 同一类事件的字段集合应尽量稳定，不应在没有必要时频繁变更 key 名
- 高基数字段只能放在 value 中，不应拼进 `event`
- 敏感内容不应直接进入日志；错误信息若可能包含上游返回体，应优先做裁剪或脱敏

当前尚未落地、但跨项目规范中推荐补充的关联字段包括：

- `request_id`
- `trace_id`

其中：

- `request_id` 对应跨服务请求标识，通常来自 `x-request-id`
- `trace_id` 对应当前 trace 的统一查询键

这两个字段目前还没有在 Studio 的 `diag` 文本日志中稳定输出，因此本文档只把它们作为后续增强方向，不写成“已实现能力”。

### 默认服务名

- Studio 默认 `OTEL_SERVICE_NAME=studio`
- DIP 插件默认 `OTEL_SERVICE_NAME=openclaw-dip-plugin`

## 实际属性写入

### `studio.http.chat_agent`

固定属性：

- `gen_ai.operation.name=invoke_agent`
- `http.route=/api/dip-studio/v1/chat/agent`
- `http.request.method`

在 `chat.ts` 中补写：

- `gen_ai.agent.id`
- `gen_ai.conversation.id`
- `gen_ai.agent.run_id`
- `user.id`
- `request.idempotency_key`

结束时补写：

- `http.response.status_code`
- `studio.abort.reason`，仅在 abort/close 异常路径写入

### `studio.auth.hydra_introspect`

固定属性：

- `upstream.service=hydra`
- `http.request.method=POST`

响应后补写：

- `http.response.status_code`

失败时补写：

- `error.type`
- `error.message`

### `studio.openclaw.*`

固定属性：

- `gen_ai.agent.run_id`，值直接使用发起 `chat.send` 时的 `idempotencyKey`
- `upstream.service=openclaw`
- `gen_ai.conversation.id`，`sessions_patch` / `chat_send` / `stream` 会写

收到 `chat.send` ack 后补写：

- `gen_ai.agent.run_id`

异常路径可能补写：

- `error.type`
- `error.message`
- `studio.abort.reason`

### `openclaw.agent.run`

固定属性：

- `gen_ai.operation.name=agent_run`
- `gen_ai.agent.id`
- `gen_ai.conversation.id`
- `openclaw.session.key`

运行中补写：

- `gen_ai.agent.run_id`

结束时补写：

- `gen_ai.finish_reason=completed|error`
- `error.type`
- `error.message`

### `openclaw.llm.call`

开始时写入：

- `gen_ai.agent.run_id`
- `gen_ai.request.model`
- `gen_ai.provider.name`

结束时写入：

- `gen_ai.response.model`
- `gen_ai.usage.input_tokens`
- `gen_ai.usage.output_tokens`

### `openclaw.tool.call`

开始时写入：

- `openclaw.tool.name`
- `openclaw.tool_call.id`
- `gen_ai.agent.run_id`
- `gen_ai.conversation.id`
- `tool.params.summary`

结束时写入：

- `tool.result.summary`
- `tool.duration_ms`
- `error.type`
- `error.message`

说明：

- `tool.params.summary` / `tool.result.summary` 当前直接 JSON 序列化并截断到 512 字符。

### `openclaw.subagent.run`

开始时写入：

- `openclaw.subagent.id`
- `openclaw.parent_run_id`

运行中补写：

- `openclaw.subagent.run_id`

结束时写入：

- `gen_ai.finish_reason`
- `openclaw.subagent.run_id`
- `error.type`
- `error.message`

## 上下文传播现状

### 已经生效的链路

- 浏览器/客户端 -> Studio HTTP：通过标准 W3C trace headers 提取
- Studio -> Hydra HTTP：通过 `traceparent` / `tracestate` 注入

### 当前未真正打通的链路

Studio -> OpenClaw WebSocket RPC 当前没有把 `_otel` 实际写入 `chat.send` 请求。

虽然仓库中已经存在：

- `studio/src/infra/otel/propagation.ts`
- `deploy/openclaw-extensions/dip/src/otel-context.ts`

并且插件的 `before_agent_start` 也会尝试从 `_otel.traceparent` 恢复父 context，但当前 `createChatSendRequest()` 实际发送的 payload 只包含：

- `sessionKey`
- `message`
- `idempotencyKey`
- `attachments`

因此当前实际效果是：

- Studio 侧 trace 是完整的
- OpenClaw / DIP 插件侧也会各自产出 spans
- 两边通常不会落在同一个 trace 树里
- 但可以通过统一的 `gen_ai.agent.run_id` 进行关联

### 当前采用的关联方式

OpenClaw `chat.send` 在当前版本里会把 `idempotencyKey` 直接作为 `runId` 返回并继续沿用。

基于这个实现事实，Studio 侧在发起 `chat.send` 前就把同一个值写入：

- `gen_ai.agent.run_id`
- `request.idempotency_key`

DIP 插件侧则在 `llm_input`、`before_tool_call`、`subagent_*` 等 hook 中继续写入 OpenClaw runtime 提供的 `runId`。

因此虽然不能形成真正的 parent-child trace，但可以在观测平台中通过同一个 `gen_ai.agent.run_id` 查询出：

- `studio.http.chat_agent`
- `studio.openclaw.connect`
- `studio.openclaw.sessions_patch`
- `studio.openclaw.chat_send`
- `studio.openclaw.stream`
- `openclaw.agent.run`
- `openclaw.llm.call`
- `openclaw.tool.call`
- `openclaw.subagent.run`

另外，插件侧父上下文恢复当前只解析 `_otel.traceparent`，没有使用 `tracestate` 与 `baggage`。

### 基于 `run_id` 的完整链路组装方案

适用场景：

- `openclaw.llm.call` 等 span 可能不携带 `gen_ai.conversation.id`，但携带 `gen_ai.agent.run_id`。
- 需要把 Studio 入口链路与 OpenClaw 内部链路拼接成一次完整执行视图。

查询与组装步骤（建议在查询服务侧实现）：

1. 先按 `conversation_id` 查询，提取该会话下的 `gen_ai.agent.run_id` 集合。
2. 按每个 `run_id` 二次查询：`term(attributes.gen_ai.agent.run_id.keyword=...)`，拉取该 run 的全部 spans（允许跨多个 `traceId`）。
3. 先按 `traceId` 分组，再按 `spanId` + `parentSpanId` 在组内重建树。
4. 将同一 `run_id` 下的多棵树按 root `startTime` 升序拼装为一个 `runTraceBundle`。
5. 输出汇总信息：`traceCount`、`spanCount`、`rootSpans`、`errorSpanCount`、`durationMs`。

建议返回模型：

- `runTraceBundle.runId`
- `runTraceBundle.traceTrees[]`（每个 `traceId` 一棵树）
- `runTraceBundle.crossTraceLinks[]`（run 与 trace 的关联关系）
- `runTraceBundle.warnings[]`（缺失字段、孤儿 span、部分查询失败等）

降级策略：

- 没有 `run_id`：仅返回 conversation 查询结果，并标记 `RUN_ID_MISSING`。
- 部分 trace 查询失败：返回可用子集并标记 `partial_trace=true`，不中断整体响应。
- 同一 run 出现多个 root：视为并行分支按时间展示，不做强制合并。

## 查询接口与查询方案

### 当前可用查询接口（agent-observability）

当前已接通的查询入口：

- `POST /api/agent-observability/v1/traces/_search`
  - 用途：透传 OpenSearch DSL，适合排障和临时分析。
- `GET /api/agent-observability/v1/traces/by-conversation?conversation_id=...`
  - 用途：按 `gen_ai.conversation.id` 拉取会话相关 spans（服务端内置字段映射）。

示例：

```bash
curl -X GET "http://127.0.0.1:18080/api/agent-observability/v1/traces/by-conversation?conversation_id=<conversation_id>"
```

```bash
curl -X POST "http://127.0.0.1:18080/api/agent-observability/v1/traces/_search" -H "Content-Type: application/json" -d '{"size":200,"sort":[{"startTime":{"order":"asc"}}],"query":{"bool":{"filter":[{"term":{"attributes.gen_ai.agent.run_id.keyword":"<run_id>"}}]}}}'
```

### 建议新增查询接口（面向产品能力）

为避免前端/调用方直接拼 DSL，建议在 `agent-observability` 补充：

1. `GET /api/agent-observability/v1/traces/by-run?run_id=...`
   - 输入：`run_id`
   - 输出：该 run 下全部 spans（可跨 trace）
   - 作用：解决 `openclaw.llm.call` 无 `conversation_id` 的可检索性问题

2. `GET /api/agent-observability/v1/traces/assembled?conversation_id=...`
   - 输入：`conversation_id`（可选 `run_id`）
   - 输出：`runTraceBundle[]`（按 run 聚合后的完整链路）
   - 作用：一次返回“会话 -> 多 run -> 多 trace 树”结构，减少调用方二次拼装

3. `GET /api/agent-observability/v1/traces/assembled/by-run?run_id=...`
   - 输入：`run_id`
   - 输出：单 run 的完整链路树（含 cross-trace links、warnings）
   - 作用：排障主入口，替代手工两段查询

建议响应骨架：

```json
{
  "runId": "string",
  "traceCount": 2,
  "spanCount": 11,
  "traceTrees": [
    {
      "traceId": "string",
      "roots": []
    }
  ],
  "crossTraceLinks": [
    {
      "runId": "string",
      "traceIds": ["string"]
    }
  ],
  "warnings": []
}
```

### 查询方案（推荐顺序）

#### 方案 A：按 conversation 查询（默认）

1. 调用 `by-conversation` 拿到会话数据与候选 `run_id`。
2. 若只做基础展示，直接按 `traceId` 分组建树返回。
3. 若需要“完整链路”，进入 run 扩展（方案 B）。

适用：页面首屏、会话回放、常规定位。

#### 方案 B：按 run 查询并跨 trace 组装（推荐排障）

1. 调用 `by-run` 或 `_search` + `run_id.keyword` 过滤。
2. 拉取全部 spans 后按 `traceId` 分桶。
3. 桶内通过 `spanId/parentSpanId` 建树。
4. 输出 `runTraceBundle`，并标记 `warnings/partial_trace`。

适用：跨组件链路拼接（Studio + OpenClaw）、LLM/工具行为定位。

#### 方案 C：按 trace 精查

1. 已知 `traceId` 时直接查询单条 trace 明细。
2. 用于定位某一次 HTTP 请求内的细节，不做跨 trace 聚合。

适用：单请求根因分析、慢节点定位。

### 查询约束与实现建议

- run 维度必须使用 `attributes.gen_ai.agent.run_id.keyword` 精确过滤。
- 统一按 `startTime` 升序排序，避免 `@timestamp` 缺省值导致排序失真。
- 大结果集使用 `search_after` 分页，不建议一次拉全。
- 查询超时时返回已完成阶段信息（如 `conversation_lookup`、`run_expansion`、`tree_build`）。

## 与早期设计相比的实际差异

以下内容在当前实现中不存在，文档不应再按“已实现”描述：

- `chat.ts` 中显式创建 `studio.http.chat_agent` 主 span
- Studio 到 OpenClaw 的 `_otel` 载荷实际透传
- `dip.archive.execute`、`dip.skills.lookup`、`dip.workspace_temp.upload` 等工具内部子 span
- 以 `session_start`/`session_end` 维持的长生命周期 session span
- 对 `prompt`、`tool result` 的更细粒度白名单脱敏策略

## Helm 与示例配置

当前需要同步关注的文件：

- `studio/.env.example`
- `studio/chart/values.yaml`
- `studio/chart/templates/configmap.yaml`

要求：

- `OTEL_EXPORTER_OTLP_ENDPOINT` 必须写为完整 URL
- 不再使用 `OTEL_TRACE_CONSOLE_EXPORTER`
- 本次实现统一使用 `OTEL_TRACE_EXPORTER` / `OTEL_LOG_ENABLED` / `OTEL_LOG_EXPORTER`

## 当前限制

1. Studio 与 OpenClaw 之间尚未形成真正的单条端到端 trace，只能通过 `gen_ai.agent.run_id` 做跨段关联。
2. DIP 插件若成功把 `ConsoleSpanExporter` 追加到现有 provider，会直接返回，不会继续为日志 exporter 再启动独立 `NodeSDK`。
3. 插件工具内部目前没有新增 `dip.*` 子 span，只有 hook 级 `openclaw.tool.call`。
4. `_otel` 恢复只依赖 `traceparent`，不会恢复 `tracestate` / `baggage`。
