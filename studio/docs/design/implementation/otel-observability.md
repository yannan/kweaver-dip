# Agent Chat OTel 接入设计

## 目标

本设计只覆盖 `agent chat` 主链路，但链路内部需要包含完整的运行时可观测性：

- `studio` HTTP 入站
- Hydra 鉴权
- OpenClaw WebSocket RPC
- SSE / 流式回传
- OpenClaw agent run
- tool call 细粒度 span
- llm call 细粒度 span
- subagent span
- `session_start` / `session_end`
- `dip.archive.execute` 等工具内部子 span

本次唯一明确排除的范围是：

- `studio` 其他 HTTP 路由

目标链路如下：

```text
POST /api/dip-studio/v1/chat/agent
  -> studio.http.chat_agent
    -> studio.auth.hydra_introspect
    -> studio.openclaw.connect
    -> studio.openclaw.sessions_patch
    -> studio.openclaw.chat_send
    -> studio.openclaw.stream
      -> openclaw.session.start
      -> openclaw.agent.run
        -> openclaw.llm.call
        -> openclaw.tool.call
          -> dip.archive.execute
        -> openclaw.subagent.run
      -> openclaw.session.end
```

## 范围

纳入本次接入范围：

- `studio` `/api/dip-studio/v1/chat/agent`
- Hydra introspect
- OpenClaw Gateway WebSocket 连接
- `sessions.patch`
- `chat.send`
- SSE / 流式回传
- OpenClaw `before_agent_start` / `agent_end`
- OpenClaw `before_tool_call` / `after_tool_call`
- OpenClaw `llm_input` / `llm_output`
- OpenClaw `subagent_spawning` / `subagent_spawned` / `subagent_ended`
- OpenClaw `session_start` / `session_end`
- `dip` 工具内部关键子 span

明确不纳入本次范围：

- `studio` 其他 HTTP 路由
- 与 agent chat 无关的后台任务

## 现状

`studio` 当前关键路径：

- 应用组装：`src/app.ts`
- 服务启动：`src/server.ts`
- chat 入口：`src/routes/chat.ts`
- OpenClaw WebSocket RPC / SSE 桥接：`src/infra/openclaw-chat-agent-client.ts`
- Hydra 鉴权：`src/middleware/hydra-auth.ts`
- Hydra HTTP Client：`src/infra/hydra-http-client.ts`

`dip` 插件当前入口：

- `deploy/openclaw-extensions/dip/index.ts`

当前 `dip` 本身不是 agent runner，因此不能只在单个工具实现中埋点；必须通过 OpenClaw Runtime Hook 为 agent run、tool、llm、subagent、session 生命周期建 span。

## 设计原则

1. HTTP 调用使用标准 `traceparent` / `tracestate` / `baggage`
2. WebSocket RPC 使用显式 `_otel` 字段透传上下文
3. `studio` 创建外层业务主 span
4. OpenClaw 在 Hooks 中创建运行时主 span与子 span
5. 高基数字段只能做 attribute，不能做 span name
6. prompt、tool 参数、tool 结果不做无控制全量上报，默认只写摘要、截断值或白名单字段
7. `dip` 工具实现只负责补充工具内部子 span，不负责创建运行时主 span

## Trace 结构

本次保留的最小完整可用树如下：

```text
studio.http.chat_agent
  -> studio.auth.hydra_introspect
  -> studio.openclaw.connect
  -> studio.openclaw.sessions_patch
  -> studio.openclaw.chat_send
  -> studio.openclaw.stream
    -> openclaw.session.start
    -> openclaw.agent.run
      -> openclaw.llm.call
      -> openclaw.tool.call
        -> dip.archive.execute
      -> openclaw.subagent.run
    -> openclaw.session.end
```

说明：

- `studio.http.chat_agent` 是本次请求的业务主 span
- `studio.openclaw.stream` 覆盖流式回传生命周期
- `openclaw.agent.run` 是 OpenClaw 主运行 span
- `openclaw.llm.call`、`openclaw.tool.call`、`openclaw.subagent.run` 是 `agent.run` 下的细粒度子 span
- `openclaw.session.start` / `openclaw.session.end` 用于标记会话级生命周期事件

## Attributes 规范

### 通用属性

- `gen_ai.operation.name`
- `gen_ai.agent.id`
- `gen_ai.agent.run_id`
- `gen_ai.conversation.id`
- `user.id`

### OpenClaw 属性

- `openclaw.session.key`
- `openclaw.sequence`
- `openclaw.stream.id`
- `openclaw.tool.name`
- `openclaw.tool_call.id`
- `openclaw.subagent.id`
- `openclaw.subagent.run_id`
- `openclaw.parent_run_id`

### 模型属性

- `gen_ai.request.model`
- `gen_ai.response.model`
- `gen_ai.provider.name`
- `gen_ai.usage.input_tokens`
- `gen_ai.usage.output_tokens`
- `gen_ai.finish_reason`

### 网络属性

- `http.route`
- `http.request.method`
- `upstream.service`

### 摘要属性约束

以下内容默认只允许以摘要、截断值或白名单形式进入 attributes：

- 用户输入
- system prompt
- tool 参数
- tool 结果
- 模型输出

## Span 命名

本次固定使用以下 span name：

### `studio`

- `studio.http.chat_agent`
- `studio.auth.hydra_introspect`
- `studio.openclaw.connect`
- `studio.openclaw.sessions_patch`
- `studio.openclaw.chat_send`
- `studio.openclaw.stream`

### OpenClaw

- `openclaw.session.start`
- `openclaw.session.end`
- `openclaw.agent.run`
- `openclaw.llm.call`
- `openclaw.tool.call`
- `openclaw.subagent.run`

### `dip`

- `dip.archive.execute`
- `dip.skills.lookup`
- `dip.workspace_temp.upload`

约束：

- 不允许把 `sessionKey`、`runId`、`toolCallId`、用户输入拼进 span name
- 这些值只允许进入 attributes

## `studio` 接入设计

### 初始化

新增目录：`src/infra/otel/`

新增文件：

- `src/infra/otel/config.ts`
- `src/infra/otel/init.ts`
- `src/infra/otel/tracing.ts`
- `src/infra/otel/propagation.ts`

职责：

- `config.ts`
  - 读取 `OTEL_SERVICE_NAME`
  - 读取 `OTEL_EXPORTER_OTLP_ENDPOINT`
  - 读取 `OTEL_TRACE_ENABLED`
  - 读取采样率与环境名
- `init.ts`
  - 初始化 `TracerProvider`
  - 设置 `BatchSpanProcessor`
  - 设置 propagator 为 `TraceContext + Baggage`
- `tracing.ts`
  - 提供 `startInternalSpan`
  - 提供 `recordError`
  - 提供通用属性写入
- `propagation.ts`
  - 负责 HTTP Header 注入
  - 负责 `_otel` 载荷注入与恢复

初始化时机：

- 在 `src/server.ts` 启动 HTTP 服务前初始化

### Express 入站

接入点：`src/app.ts`

职责：

- 从请求头提取 trace context
- 创建 HTTP server span
- 若请求命中 `/api/dip-studio/v1/chat/agent`，补写：
  - `gen_ai.agent.id`
  - `gen_ai.conversation.id`
  - `user.id`

说明：

- 可以使用官方 Express instrumentation
- 但仍需要一层自定义补充逻辑来写业务属性

### Hydra 鉴权

接入点：

- `src/middleware/hydra-auth.ts`
- `src/infra/hydra-http-client.ts`

要求：

- 为 Hydra introspect 请求建立 `studio.auth.hydra_introspect`
- 通过统一的 traced fetch 注入 `traceparent`
- 记录：
  - `upstream.service=hydra`
  - HTTP 状态码
  - 错误状态

### Chat 主流程

接入点：`src/routes/chat.ts`

在 agent chat 路由中显式创建业务主 span：

- `studio.http.chat_agent`

建议属性：

- `gen_ai.operation.name=invoke_agent`
- `gen_ai.agent.id`
- `gen_ai.conversation.id=sessionKey`
- `user.id`
- `request.idempotency_key`

这个 span 覆盖整个请求生命周期，直到 SSE 流结束、报错或被取消。

### OpenClaw WebSocket / SSE 桥接

接入点：`src/infra/openclaw-chat-agent-client.ts`

拆分四个关键 span：

1. `studio.openclaw.connect`
   - 建立或获取 Gateway WebSocket 连接

2. `studio.openclaw.sessions_patch`
   - 发送 `sessions.patch`

3. `studio.openclaw.chat_send`
   - 发送 `chat.send`

4. `studio.openclaw.stream`
   - 覆盖整个流式回传过程

`studio.openclaw.stream` 的结束时机：

- 收到 `chat final`
- 收到 `chat error`
- 收到 `chat aborted`
- 请求被取消
- WebSocket 关闭且流已终止

建议记录的事件：

- 首包到达
- 首次拿到 `runId`
- tool frame 到达
- llm 相关事件到达
- stream 结束状态

当首次拿到 `runId` 时，补写：

- `gen_ai.agent.run_id`

## `studio` 到 OpenClaw 的上下文透传

主链路是 WebSocket RPC，不能依赖 HTTP Header 自动传播。因此需要在请求体中增加内部字段 `_otel`。

推荐格式：

```json
{
  "sessionKey": "sess_xxx",
  "message": "user input",
  "_otel": {
    "traceparent": "00-<traceid>-<spanid>-01",
    "tracestate": "...",
    "baggage": "user.id=u123"
  }
}
```

约束：

- `_otel` 仅用于 OpenClaw 恢复 trace context
- 不进入 prompt
- 不暴露给最终模型输入
- 不作为业务字段使用

不建议复用 `inputProvenance`，因为那是业务语义字段，不适合作为 tracing 通道。

## OpenClaw 接入设计

新增文件：

- `deploy/openclaw-extensions/dip/src/otel-context.ts`
- `deploy/openclaw-extensions/dip/src/otel-trace.ts`
- `deploy/openclaw-extensions/dip/src/agent-observability-hooks.ts`

修改：

- `deploy/openclaw-extensions/dip/index.ts`

### `otel-context.ts`

职责：

- 解析 `_otel.traceparent` / `_otel.tracestate` / `_otel.baggage`
- 恢复父 context
- 按 `runId` 缓存当前 run span 句柄
- 按 `toolCallId` 缓存当前 tool span 句柄
- 按模型调用实例缓存当前 llm span 句柄

建议结构：

- `Map<runId, RunTraceContext>`
- `Map<toolCallId, ToolTraceContext>`
- `Map<llmCallKey, LlmTraceContext>`

清理时机：

- `agent_end`
- `after_tool_call`
- `llm_output`
- `session_end`
- 超时保护

### `otel-trace.ts`

职责：

- 创建 / 结束 `openclaw.session.start`
- 创建 / 结束 `openclaw.session.end`
- 创建 / 结束 `openclaw.agent.run`
- 创建 / 结束 `openclaw.tool.call`
- 创建 / 结束 `openclaw.llm.call`
- 创建 / 结束 `openclaw.subagent.run`
- 记录错误状态
- 写入统一属性

建议接口：

- `startSessionSpan(...)`
- `endSessionSpan(...)`
- `startAgentRunSpan(...)`
- `endAgentRunSpan(...)`
- `startToolCallSpan(...)`
- `endToolCallSpan(...)`
- `startLlmSpan(...)`
- `endLlmSpan(...)`
- `startSubagentSpan(...)`
- `endSubagentSpan(...)`
- `recordError(...)`

### `agent-observability-hooks.ts`

本次接入以下 hook：

- `before_agent_start`
- `agent_end`
- `before_tool_call`
- `after_tool_call`
- `llm_input`
- `llm_output`
- `session_start`
- `session_end`
- `subagent_spawning`
- `subagent_spawned`
- `subagent_ended`

## Hook 到 Span 的映射

### `session_start`

作用：

- 创建 `openclaw.session.start`
- 标记本次 chat 链路下的 session 生命周期开始

建议属性：

- `openclaw.session.key`
- `gen_ai.conversation.id=sessionKey`

### `before_agent_start`

作用：

- 从 `_otel` 恢复父 context
- 创建 `openclaw.agent.run`

建议属性：

- `gen_ai.operation.name=agent_run`
- `gen_ai.agent.id`
- `gen_ai.agent.run_id`
- `gen_ai.conversation.id=sessionKey`
- `openclaw.session.key`
- `user.id`

### `llm_input` / `llm_output`

作用：

- 以一次完整模型调用创建 `openclaw.llm.call`

建议属性：

- `gen_ai.request.model`
- `gen_ai.response.model`
- `gen_ai.provider.name`
- `gen_ai.usage.input_tokens`
- `gen_ai.usage.output_tokens`
- `gen_ai.finish_reason`

说明：

- prompt 与 completion 原文不默认写入 attributes

### `before_tool_call` / `after_tool_call`

作用：

- 创建与结束 `openclaw.tool.call`

建议属性：

- `openclaw.tool.name`
- `openclaw.tool_call.id`
- `gen_ai.agent.run_id`
- `gen_ai.conversation.id`
- 参数摘要

说明：

- 参数摘要必须截断或白名单化

### `subagent_spawning` / `subagent_spawned` / `subagent_ended`

作用：

- 为子代理建立 `openclaw.subagent.run`

建议属性：

- `openclaw.subagent.id`
- `openclaw.subagent.run_id`
- `openclaw.parent_run_id`

### `agent_end`

作用：

- 结束 `openclaw.agent.run`
- 写入成功或失败状态
- 清理 `runId` 对应缓存

建议补写：

- `gen_ai.finish_reason`
- `error.message`，若存在

### `session_end`

作用：

- 创建或结束 `openclaw.session.end`
- 标记本次链路中的 session 生命周期结束

建议补写：

- `openclaw.session.key`
- session 结束原因

## `dip` 工具内部子 Span

本次不仅要有 Hook 级 `openclaw.tool.call`，还要保留工具内部关键阶段子 span。

建议：

- `archive` 工具内部建立 `dip.archive.execute`
- 若 `skills` 查询有明确的远端查找阶段，建立 `dip.skills.lookup`
- 若 `workspace temp` 上传本身耗时明显，建立 `dip.workspace_temp.upload`

约束：

- 这些 `dip.*` span 必须挂在当前 `openclaw.tool.call` 下
- 不允许这些 span 脱离当前 active context 自行起根

## 错误处理

统一约定：

- 抛出异常：span `status=Error`
- OpenClaw 返回 error frame：`studio.openclaw.stream` 标记 `Error`
- OpenClaw run 失败：`openclaw.agent.run` 标记 `Error`
- tool 调用失败：`openclaw.tool.call` 标记 `Error`
- llm 调用失败：`openclaw.llm.call` 标记 `Error`
- 用户取消：`studio.openclaw.stream` 与 `studio.http.chat_agent` 统一记录取消原因

建议字段：

- `error.type`
- `error.message`
- `studio.abort.reason`

## 配置

`studio` 侧环境变量：

- `OTEL_SERVICE_NAME=studio`
- `OTEL_SERVICE_VERSION=...`
- `OTEL_ENVIRONMENT=...`
- `OTEL_TRACE_ENABLED=true|false`
- `OTEL_EXPORTER_OTLP_ENDPOINT=http://otelcol-contrib:4318`
- `OTEL_TRACE_SAMPLING_RATE=1.0`

OpenClaw / `dip` 插件侧环境变量：

- `OTEL_SERVICE_NAME=openclaw-dip-plugin`
- `OTEL_SERVICE_VERSION=...`
- `OTEL_ENVIRONMENT=...`
- `OTEL_TRACE_ENABLED=true|false`
- `OTEL_EXPORTER_OTLP_ENDPOINT=...`
- `OTEL_TRACE_SAMPLING_RATE=...`

需要同步补到：

- `studio/chart/values.yaml`
- `studio/chart/templates/configmap.yaml`

## 落地文件清单

### `studio`

新增：

- `src/infra/otel/config.ts`
- `src/infra/otel/init.ts`
- `src/infra/otel/tracing.ts`
- `src/infra/otel/propagation.ts`
- `src/infra/http/fetch-with-trace.ts`

修改：

- `src/server.ts`
- `src/app.ts`
- `src/routes/chat.ts`
- `src/middleware/hydra-auth.ts`
- `src/infra/hydra-http-client.ts`
- `src/infra/openclaw-chat-agent-client.ts`

### `dip`

新增：

- `deploy/openclaw-extensions/dip/src/otel-context.ts`
- `deploy/openclaw-extensions/dip/src/otel-trace.ts`
- `deploy/openclaw-extensions/dip/src/agent-observability-hooks.ts`

修改：

- `deploy/openclaw-extensions/dip/index.ts`
- `deploy/openclaw-extensions/dip/src/archive-tool.ts`
- 其他需要补充内部子 span 的工具实现文件

## 验收标准

完成后至少满足以下结果：

1. 调用一次 `/api/dip-studio/v1/chat/agent`，能看到 `studio.http.chat_agent`
2. 同一 trace 下能看到：
   - `studio.auth.hydra_introspect`
   - `studio.openclaw.connect`
   - `studio.openclaw.sessions_patch`
   - `studio.openclaw.chat_send`
   - `studio.openclaw.stream`
3. OpenClaw 内部能看到：
   - `openclaw.session.start`
   - `openclaw.agent.run`
   - `openclaw.llm.call`
   - `openclaw.tool.call`
   - `openclaw.subagent.run`，若实际发生
   - `openclaw.session.end`
4. `dip.archive.execute` 等工具内部子 span 能挂在对应 `openclaw.tool.call` 下
5. `agentId`、`sessionKey`、`runId`、`toolCallId` 可作为查询条件
6. 失败、取消、上游异常会正确反映到 span status

## 主要风险

1. `_otel` 字段若没有被带到 `before_agent_start`，OpenClaw trace 会断链
2. `runId` 若只在流中途拿到，需要在 `studio.openclaw.stream` 中补写，不能假设发送时就可得
3. 长流如果没有在 `final`、`error`、`aborted`、`cancel` 路径统一收口，span 会泄漏
4. `runId -> span`、`toolCallId -> span`、`llmCallKey -> span` 缓存如果未清理，会造成内存泄漏
5. tool 参数、prompt、模型输出若不做约束直接写 attributes，会带来敏感信息和大属性问题

## 实施顺序

建议按以下顺序落地：

1. `studio` OTel 初始化与 Express 入站
2. Hydra traced fetch
3. `chat.ts` 业务主 span
4. `openclaw-chat-agent-client.ts` 的 connect / patch / send / stream spans
5. `_otel` 载荷透传
6. OpenClaw `session_start` / `before_agent_start` / `agent_end` / `session_end`
7. OpenClaw `llm_input` / `llm_output`
8. OpenClaw `before_tool_call` / `after_tool_call`
9. OpenClaw `subagent_*`
10. `dip.*` 工具内部子 span

这样可以保持“只做 agent chat 一条链”，同时把这条链内部该有的观测节点一次纳入。
