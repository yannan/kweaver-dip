import { context, trace, type Context, type Span } from "@opentelemetry/api";

interface OpenClawOtelPayload {
  _otel?: {
    traceparent?: string;
  };
}

interface AgentRunEntry {
  span: Span;
  context: Context;
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
}

interface ChildSpanEntry {
  span: Span;
  context: Context;
  runId?: string;
  key: string;
}

/**
 * In-memory span registry for OpenClaw runtime hooks.
 */
export class DipOtelContextStore {
  private readonly agentRunsBySessionKey = new Map<string, AgentRunEntry>();
  private readonly agentRunsBySessionId = new Map<string, AgentRunEntry>();
  private readonly agentRunsByRunId = new Map<string, AgentRunEntry>();
  private readonly toolSpansByKey = new Map<string, ChildSpanEntry>();
  private readonly llmSpansByKey = new Map<string, ChildSpanEntry>();
  private readonly subagentSpansByKey = new Map<string, ChildSpanEntry>();

  public setAgentRun(entry: AgentRunEntry): void {
    if (entry.sessionKey) {
      this.agentRunsBySessionKey.set(entry.sessionKey, entry);
    }
    if (entry.sessionId) {
      this.agentRunsBySessionId.set(entry.sessionId, entry);
    }
    if (entry.runId) {
      this.agentRunsByRunId.set(entry.runId, entry);
    }
  }

  public getAgentRun(match: {
    sessionKey?: string;
    sessionId?: string;
    runId?: string;
  }): AgentRunEntry | undefined {
    return (
      (match.runId ? this.agentRunsByRunId.get(match.runId) : undefined)
      ?? (match.sessionId ? this.agentRunsBySessionId.get(match.sessionId) : undefined)
      ?? (match.sessionKey ? this.agentRunsBySessionKey.get(match.sessionKey) : undefined)
    );
  }

  public deleteAgentRun(match: {
    sessionKey?: string;
    sessionId?: string;
    runId?: string;
  }): void {
    const entry = this.getAgentRun(match);

    if (entry === undefined) {
      return;
    }

    if (entry.sessionKey) {
      this.agentRunsBySessionKey.delete(entry.sessionKey);
    }
    if (entry.sessionId) {
      this.agentRunsBySessionId.delete(entry.sessionId);
    }
    if (entry.runId) {
      this.agentRunsByRunId.delete(entry.runId);
    }
  }

  public setToolSpan(key: string, entry: ChildSpanEntry): void {
    this.toolSpansByKey.set(key, entry);
  }

  public getToolSpan(key: string): ChildSpanEntry | undefined {
    return this.toolSpansByKey.get(key);
  }

  public deleteToolSpan(key: string): void {
    this.toolSpansByKey.delete(key);
  }

  public setLlmSpan(key: string, entry: ChildSpanEntry): void {
    this.llmSpansByKey.set(key, entry);
  }

  public getLlmSpan(key: string): ChildSpanEntry | undefined {
    return this.llmSpansByKey.get(key);
  }

  public deleteLlmSpan(key: string): void {
    this.llmSpansByKey.delete(key);
  }

  public setSubagentSpan(key: string, entry: ChildSpanEntry): void {
    this.subagentSpansByKey.set(key, entry);
  }

  public getSubagentSpan(key: string): ChildSpanEntry | undefined {
    return this.subagentSpansByKey.get(key);
  }

  public deleteSubagentSpan(key: string): void {
    this.subagentSpansByKey.delete(key);
  }
}

/**
 * Restores one parent context from `_otel` payload when available.
 *
 * @param payload Unknown hook payload.
 * @returns Extracted context or current context.
 */
export function extractParentContextFromPayload(
  payload: unknown
): Context {
  const carrier = readOtelPayload(payload);

  if (carrier?._otel?.traceparent === undefined) {
    return context.active();
  }

  const traceparent = carrier._otel.traceparent.trim();
  const match =
    /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i.exec(traceparent);

  if (match === null) {
    return context.active();
  }

  return trace.setSpan(
    context.active(),
    trace.wrapSpanContext({
      traceId: match[1].toLowerCase(),
      spanId: match[2].toLowerCase(),
      traceFlags: Number.parseInt(match[3], 16)
    })
  );
}

function readOtelPayload(payload: unknown): OpenClawOtelPayload | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }

  if ("_otel" in payload) {
    return payload as OpenClawOtelPayload;
  }

  return undefined;
}
