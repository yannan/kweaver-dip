import type { NextFunction, Request, Response } from "express";
import {
  SpanKind,
  SpanStatusCode,
  context,
  propagation,
  trace,
  type Attributes,
  type Span,
  type SpanOptions
} from "@opentelemetry/api";

import { ensureGlobalPropagator } from "./propagation";

const CHAT_AGENT_ROUTE = "/api/dip-studio/v1/chat/agent";
const TRACER_NAME = "studio";

/**
 * Returns the shared Studio tracer.
 */
export function getTracer() {
  return trace.getTracer(TRACER_NAME);
}

/**
 * Starts one internal span as a child of the provided context.
 *
 * @param name Span name.
 * @param options Span options.
 * @param parentContext Parent context.
 * @returns The created span.
 */
export function startInternalSpan(
  name: string,
  options: SpanOptions = {},
  parentContext = context.active()
): Span {
  return getTracer().startSpan(
    name,
    {
      kind: SpanKind.INTERNAL,
      ...options
    },
    parentContext
  );
}

/**
 * Runs one callback inside the provided span context.
 *
 * @param span Active span.
 * @param callback Work to execute.
 * @returns Callback result.
 */
export function withSpanContext<T>(span: Span, callback: () => T): T {
  return context.with(trace.setSpan(context.active(), span), callback);
}

/**
 * Writes attributes, dropping undefined values.
 *
 * @param span Target span.
 * @param attributes Attribute map.
 */
export function setSpanAttributes(span: Span, attributes: Attributes): void {
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) {
      span.setAttribute(key, value);
    }
  }
}

/**
 * Records one error on a span and marks it failed.
 *
 * @param span Target span.
 * @param error Error-like value.
 */
export function recordError(span: Span, error: unknown): void {
  const normalizedError =
    error instanceof Error ? error : new Error(String(error));

  span.recordException(normalizedError);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: normalizedError.message
  });
  setSpanAttributes(span, {
    "error.type": normalizedError.name,
    "error.message": normalizedError.message
  });
}

/**
 * Creates the HTTP tracing middleware for the chat agent route.
 *
 * @returns Express middleware.
 */
export function createChatAgentTracingMiddleware() {
  return (
    request: Request,
    response: Response,
    next: NextFunction
  ): void => {
    if (request.path !== CHAT_AGENT_ROUTE) {
      next();
      return;
    }

    ensureGlobalPropagator();

    const extractedContext = propagation.extract(
      context.active(),
      request.headers,
      {
        keys(carrier) {
          return Object.keys(carrier);
        },
        get(carrier, key) {
          const value = carrier[key];

          if (Array.isArray(value)) {
            return value;
          }

          return typeof value === "string" ? value : undefined;
        }
      }
    );
    const span = getTracer().startSpan(
      "studio.http.chat_agent",
      {
        kind: SpanKind.SERVER,
        attributes: {
          "gen_ai.operation.name": "invoke_agent",
          "http.route": CHAT_AGENT_ROUTE,
          "http.request.method": request.method
        }
      },
      extractedContext
    );
    const spanContext = trace.setSpan(extractedContext, span);
    let ended = false;

    const endSpan = (abortReason?: string) => {
      if (ended) {
        return;
      }

      ended = true;
      setSpanAttributes(span, {
        "http.response.status_code": response.statusCode,
        "studio.abort.reason": abortReason
      });
      if (abortReason !== undefined) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: abortReason
        });
      }
      span.end();
    };

    request.on("aborted", () => {
      endSpan("request_aborted");
    });
    response.on("finish", () => {
      endSpan();
    });
    response.on("close", () => {
      if (!response.writableEnded) {
        endSpan("response_closed");
      }
    });

    context.with(spanContext, () => {
      next();
    });
  };
}
