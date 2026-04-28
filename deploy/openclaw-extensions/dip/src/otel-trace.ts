import {
  SpanStatusCode,
  context,
  trace,
  type Attributes,
  type Context,
  type Span
} from "@opentelemetry/api";

import {
  DipOtelContextStore
} from "./otel-context.js";

const tracer = trace.getTracer("openclaw-dip-plugin");

export const otelContextStore = new DipOtelContextStore();

export function startSpan(
  name: string,
  attributes: Attributes = {},
  parentContext = context.active()
): { span: Span; context: Context } {
  const span = tracer.startSpan(name, { attributes }, parentContext);

  return {
    span,
    context: trace.setSpan(parentContext, span)
  };
}

export function endSpan(span: Span, attributes: Attributes = {}): void {
  setAttributes(span, attributes);
  span.end();
}

export function recordError(span: Span, error: unknown): void {
  const normalizedError =
    error instanceof Error ? error : new Error(String(error));

  span.recordException(normalizedError);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: normalizedError.message
  });
  setAttributes(span, {
    "error.type": normalizedError.name,
    "error.message": normalizedError.message
  });
}

export function setAttributes(span: Span, attributes: Attributes): void {
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) {
      span.setAttribute(key, value);
    }
  }
}

export async function withChildSpan<T>(
  name: string,
  parentContext: Context | undefined,
  attributes: Attributes,
  callback: () => Promise<T>
): Promise<T> {
  const child = startSpan(name, attributes, parentContext ?? context.active());

  try {
    return await callback();
  } catch (error) {
    recordError(child.span, error);
    throw error;
  } finally {
    child.span.end();
  }
}
