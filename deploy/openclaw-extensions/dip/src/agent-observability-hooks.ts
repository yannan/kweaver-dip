import type {
  OpenClawPluginApi,
  PluginHookAgentContext,
  PluginHookAfterToolCallEvent,
  PluginHookBeforeAgentStartEvent,
  PluginHookBeforeToolCallEvent,
  PluginHookLlmInputEvent,
  PluginHookLlmOutputEvent,
  PluginHookSessionEndEvent,
  PluginHookSessionStartEvent,
  PluginHookSubagentEndedEvent,
  PluginHookSubagentSpawnedEvent,
  PluginHookSubagentSpawningEvent,
  PluginHookToolContext
} from "openclaw/plugin-sdk";

import {
  extractParentContextFromPayload
} from "./otel-context.js";
import {
  endSpan,
  otelContextStore,
  recordError,
  setAttributes,
  startSpan
} from "./otel-trace.js";

function runLookup(ctx: {
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
}) {
  return otelContextStore.getAgentRun({
    sessionKey: ctx.sessionKey,
    sessionId: ctx.sessionId,
    runId: ctx.runId
  });
}

function summarizeValue(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const serialized =
    typeof value === "string" ? value : JSON.stringify(value);

  return serialized.length > 512 ? `${serialized.slice(0, 512)}...` : serialized;
}

export function registerAgentObservabilityHooks(api: OpenClawPluginApi): void {
  api.on("session_start", (event: PluginHookSessionStartEvent, ctx) => {
    const session = startSpan("openclaw.session.start", {
      "openclaw.session.key": event.sessionKey,
      "gen_ai.conversation.id": event.sessionKey ?? ctx.sessionKey
    });

    session.span.end();
  });

  api.on("before_agent_start", (event: PluginHookBeforeAgentStartEvent, ctx: PluginHookAgentContext) => {
    const parentContext = extractParentContextFromPayload(
      (event as Record<string, unknown>)._otel ?? (ctx as Record<string, unknown>)._otel ?? event
    );
    const run = startSpan("openclaw.agent.run", {
      "gen_ai.operation.name": "agent_run",
      "gen_ai.agent.id": ctx.agentId,
      "gen_ai.conversation.id": ctx.sessionKey,
      "openclaw.session.key": ctx.sessionKey
    }, parentContext);

    otelContextStore.setAgentRun({
      span: run.span,
      context: run.context,
      sessionKey: ctx.sessionKey,
      sessionId: ctx.sessionId
    });
  });

  api.on("llm_input", (event: PluginHookLlmInputEvent, ctx) => {
    const run = runLookup({
      sessionKey: ctx.sessionKey,
      sessionId: ctx.sessionId,
      runId: event.runId
    });

    if (run === undefined) {
      return;
    }

    setAttributes(run.span, {
      "gen_ai.agent.run_id": event.runId
    });
    otelContextStore.setAgentRun({
      ...run,
      runId: event.runId
    });

    const llm = startSpan("openclaw.llm.call", {
      "gen_ai.agent.run_id": event.runId,
      "gen_ai.request.model": event.model,
      "gen_ai.provider.name": event.provider
    }, run.context);

    otelContextStore.setLlmSpan(event.runId, {
      key: event.runId,
      runId: event.runId,
      span: llm.span,
      context: llm.context
    });
  });

  api.on("llm_output", (event: PluginHookLlmOutputEvent) => {
    const llm = otelContextStore.getLlmSpan(event.runId);

    if (llm === undefined) {
      return;
    }

    endSpan(llm.span, {
      "gen_ai.response.model": event.model,
      "gen_ai.usage.input_tokens": event.usage?.input,
      "gen_ai.usage.output_tokens": event.usage?.output
    });
    otelContextStore.deleteLlmSpan(event.runId);
  });

  api.on("before_tool_call", (event: PluginHookBeforeToolCallEvent, ctx: PluginHookToolContext) => {
    const run = runLookup({
      sessionKey: ctx.sessionKey,
      sessionId: ctx.sessionId,
      runId: ctx.runId ?? event.runId
    });

    if (run === undefined) {
      return;
    }

    if (ctx.runId ?? event.runId) {
      otelContextStore.setAgentRun({
        ...run,
        runId: ctx.runId ?? event.runId
      });
      setAttributes(run.span, {
        "gen_ai.agent.run_id": ctx.runId ?? event.runId
      });
    }

    const toolKey = ctx.toolCallId ?? event.toolCallId ?? `${ctx.runId ?? event.runId}:${event.toolName}`;
    const tool = startSpan("openclaw.tool.call", {
      "openclaw.tool.name": event.toolName,
      "openclaw.tool_call.id": ctx.toolCallId ?? event.toolCallId,
      "gen_ai.agent.run_id": ctx.runId ?? event.runId,
      "gen_ai.conversation.id": ctx.sessionKey,
      "tool.params.summary": summarizeValue(event.params)
    }, run.context);

    otelContextStore.setToolSpan(toolKey, {
      key: toolKey,
      runId: ctx.runId ?? event.runId,
      span: tool.span,
      context: tool.context
    });
  });

  api.on("after_tool_call", (event: PluginHookAfterToolCallEvent, ctx: PluginHookToolContext) => {
    const toolKey = ctx.toolCallId ?? event.toolCallId ?? `${ctx.runId ?? event.runId}:${event.toolName}`;
    const tool = otelContextStore.getToolSpan(toolKey);

    if (tool === undefined) {
      return;
    }

    if (event.error) {
      recordError(tool.span, new Error(event.error));
    }

    endSpan(tool.span, {
      "tool.result.summary": summarizeValue(event.result),
      "tool.duration_ms": event.durationMs
    });
    otelContextStore.deleteToolSpan(toolKey);
  });

  api.on("subagent_spawning", (event: PluginHookSubagentSpawningEvent, ctx) => {
    const run = runLookup({
      sessionKey: ctx.requesterSessionKey,
      runId: ctx.runId
    });

    if (run === undefined) {
      return;
    }

    const subagent = startSpan("openclaw.subagent.run", {
      "openclaw.subagent.id": event.agentId,
      "openclaw.parent_run_id": ctx.runId
    }, run.context);

    otelContextStore.setSubagentSpan(event.childSessionKey, {
      key: event.childSessionKey,
      runId: ctx.runId,
      span: subagent.span,
      context: subagent.context
    });
  });

  api.on("subagent_spawned", (event: PluginHookSubagentSpawnedEvent) => {
    const subagent = otelContextStore.getSubagentSpan(event.childSessionKey);

    if (subagent === undefined) {
      return;
    }

    setAttributes(subagent.span, {
      "openclaw.subagent.run_id": event.runId
    });
  });

  api.on("subagent_ended", (event: PluginHookSubagentEndedEvent) => {
    const subagent = otelContextStore.getSubagentSpan(event.targetSessionKey);

    if (subagent === undefined) {
      return;
    }

    if (event.error) {
      recordError(subagent.span, new Error(event.error));
    }

    endSpan(subagent.span, {
      "gen_ai.finish_reason": event.outcome,
      "openclaw.subagent.run_id": event.runId
    });
    otelContextStore.deleteSubagentSpan(event.targetSessionKey);
  });

  api.on("agent_end", (event, ctx) => {
    const run = runLookup({
      sessionKey: ctx.sessionKey,
      sessionId: ctx.sessionId
    });

    if (run === undefined) {
      return;
    }

    if (!event.success && event.error) {
      recordError(run.span, new Error(event.error));
    }

    endSpan(run.span, {
      "gen_ai.finish_reason": event.success ? "completed" : "error"
    });
    otelContextStore.deleteAgentRun({
      sessionKey: ctx.sessionKey,
      sessionId: ctx.sessionId,
      runId: run.runId
    });
  });

  api.on("session_end", (event: PluginHookSessionEndEvent, ctx) => {
    const session = startSpan("openclaw.session.end", {
      "openclaw.session.key": event.sessionKey,
      "gen_ai.conversation.id": event.sessionKey ?? ctx.sessionKey
    });

    session.span.end();
    otelContextStore.deleteAgentRun({
      sessionKey: ctx.sessionKey,
      sessionId: ctx.sessionId
    });
  });
}
