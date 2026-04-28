import { context, propagation, trace, type Context, type SpanContext } from "@opentelemetry/api";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator
} from "@opentelemetry/core";

let hasConfiguredPropagator = false;

/**
 * Internal `_otel` payload carried through OpenClaw RPC params.
 */
export interface OpenClawOtelCarrier {
  traceparent?: string;
  tracestate?: string;
  baggage?: string;
}

/**
 * Payload shape that may contain `_otel`.
 */
export interface OpenClawOtelPayload {
  _otel?: OpenClawOtelCarrier;
}

/**
 * Ensures the global propagator supports W3C trace context and baggage.
 */
export function ensureGlobalPropagator(): void {
  if (hasConfiguredPropagator) {
    return;
  }

  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [
        new W3CTraceContextPropagator(),
        new W3CBaggagePropagator()
      ]
    })
  );
  hasConfiguredPropagator = true;
}

/**
 * Injects the active trace context into HTTP headers.
 *
 * @param headers Existing headers.
 * @param carrierContext Explicit trace context override.
 * @returns Headers including tracing state.
 */
export function injectContextToHeaders(
  headers: HeadersInit = new Headers(),
  carrierContext = context.active()
): Headers {
  const nextHeaders = new Headers(headers);
  const carrier = readContextCarrier(carrierContext);

  if (carrier.traceparent !== undefined) {
    nextHeaders.set("traceparent", carrier.traceparent);
  }
  if (carrier.tracestate !== undefined) {
    nextHeaders.set("tracestate", carrier.tracestate);
  }
  if (carrier.baggage !== undefined) {
    nextHeaders.set("baggage", carrier.baggage);
  }

  return nextHeaders;
}

/**
 * Injects the active trace context into an OpenClaw request payload.
 *
 * @param payload Base RPC payload.
 * @param carrierContext Explicit trace context override.
 * @returns Payload with `_otel` when context exists.
 */
export function injectContextToOpenClawPayload<T extends Record<string, unknown>>(
  payload: T,
  carrierContext = context.active()
): T & OpenClawOtelPayload {
  const carrier = readContextCarrier(carrierContext);

  if (
    carrier.traceparent === undefined
    && carrier.tracestate === undefined
    && carrier.baggage === undefined
  ) {
    return payload as T & OpenClawOtelPayload;
  }

  return {
    ...payload,
    _otel: carrier
  };
}

/**
 * Restores one OpenTelemetry context from OpenClaw `_otel` payload.
 *
 * @param payload Payload that may contain `_otel`.
 * @param baseContext Parent context to extract into.
 * @returns Extracted context or the original base context.
 */
export function extractContextFromOpenClawPayload(
  payload: OpenClawOtelPayload | undefined,
  baseContext = context.active()
) {
  const carrier = payload?._otel;

  if (
    carrier === undefined
    || typeof carrier.traceparent !== "string"
    || carrier.traceparent.trim() === ""
  ) {
    return baseContext;
  }

  const spanContext = parseTraceparent(carrier.traceparent);

  if (spanContext === undefined) {
    return baseContext;
  }

  return trace.setSpan(baseContext, trace.wrapSpanContext(spanContext));
}

/**
 * Builds the active W3C `traceparent` header value when a span is active.
 *
 * @returns Serialized traceparent or undefined.
 */
export function getActiveTraceparent(): string | undefined {
  const spanContext = trace.getSpanContext(context.active());

  if (spanContext === undefined) {
    return undefined;
  }

  return `00-${spanContext.traceId}-${spanContext.spanId}-${spanContext.traceFlags.toString(16).padStart(2, "0")}`;
}

function readContextCarrier(carrierContext: Context): OpenClawOtelCarrier {
  ensureGlobalPropagator();

  const spanContext = trace.getSpanContext(carrierContext);

  if (spanContext === undefined) {
    return {};
  }

  return {
    traceparent: formatTraceparent(spanContext),
    tracestate: spanContext.traceState?.serialize()
  };
}

function formatTraceparent(spanContext: SpanContext): string {
  return `00-${spanContext.traceId}-${spanContext.spanId}-${spanContext.traceFlags.toString(16).padStart(2, "0")}`;
}

function parseTraceparent(traceparent: string): SpanContext | undefined {
  const match =
    /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i.exec(
      traceparent.trim()
    );

  if (match === null) {
    return undefined;
  }

  return {
    traceId: match[1].toLowerCase(),
    spanId: match[2].toLowerCase(),
    traceFlags: Number.parseInt(match[3], 16)
  };
}
