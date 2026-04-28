import { context, trace } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

import {
  createChatAgentTracingMiddleware,
  recordError,
  setSpanAttributes,
  startInternalSpan,
  withSpanContext
} from "./tracing";

function createSpanDouble() {
  return {
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    end: vi.fn()
  };
}

describe("tracing helpers", () => {
  it("sets defined attributes only", () => {
    const span = createSpanDouble();

    setSpanAttributes(span as never, {
      a: "1",
      b: undefined,
      c: 2
    });

    expect(span.setAttribute).toHaveBeenCalledTimes(2);
    expect(span.setAttribute).toHaveBeenNthCalledWith(1, "a", "1");
    expect(span.setAttribute).toHaveBeenNthCalledWith(2, "c", 2);
  });

  it("records errors with normalized metadata", () => {
    const span = createSpanDouble();

    recordError(span as never, "boom");

    expect(span.recordException).toHaveBeenCalledOnce();
    expect(span.setStatus).toHaveBeenCalledWith({
      code: 2,
      message: "boom"
    });
  });

  it("runs callbacks inside span context", () => {
    const spanContext = {
      traceId: "0123456789abcdef0123456789abcdef",
      spanId: "0123456789abcdef",
      traceFlags: 1
    };
    const span = trace.wrapSpanContext(spanContext);
    const callback = vi.fn(() => "ok");

    const result = withSpanContext(span, callback);

    expect(callback).toHaveBeenCalledOnce();
    expect(result).toBe("ok");
  });

  it("starts internal spans through the shared tracer", () => {
    const span = startInternalSpan("child");

    expect(span).toBeDefined();
    span.end();
  });
});

describe("createChatAgentTracingMiddleware", () => {
  function createRequest(path: string, method = "POST") {
    const listeners = new Map<string, Array<() => void>>();

    return {
      path,
      method,
      headers: {},
      on: vi.fn((event: string, handler: () => void) => {
        const list = listeners.get(event) ?? [];
        list.push(handler);
        listeners.set(event, list);
      }),
      emit(event: string) {
        for (const handler of listeners.get(event) ?? []) {
          handler();
        }
      }
    } as unknown as Request & { emit: (event: string) => void };
  }

  function createResponse() {
    const listeners = new Map<string, Array<() => void>>();

    return {
      statusCode: 200,
      writableEnded: false,
      on: vi.fn((event: string, handler: () => void) => {
        const list = listeners.get(event) ?? [];
        list.push(handler);
        listeners.set(event, list);
      }),
      emit(event: string) {
        for (const handler of listeners.get(event) ?? []) {
          handler();
        }
      }
    } as unknown as Response & { emit: (event: string) => void };
  }

  it("skips non-chat-agent routes", () => {
    const middleware = createChatAgentTracingMiddleware();
    const next = vi.fn<NextFunction>();

    middleware(
      createRequest("/health"),
      createResponse(),
      next
    );

    expect(next).toHaveBeenCalledOnce();
  });

  it("ends the span on finish", () => {
    const middleware = createChatAgentTracingMiddleware();
    const request = createRequest("/api/dip-studio/v1/chat/agent");
    const response = createResponse();
    const next = vi.fn<NextFunction>();

    middleware(request, response, next);
    response.emit("finish");

    expect(next).toHaveBeenCalledOnce();
  });

  it("records aborted and premature close reasons", () => {
    const middleware = createChatAgentTracingMiddleware();
    const abortedRequest = createRequest("/api/dip-studio/v1/chat/agent");
    const abortedResponse = createResponse();
    const next = vi.fn<NextFunction>();

    middleware(abortedRequest, abortedResponse, next);
    abortedRequest.emit("aborted");

    const closingRequest = createRequest("/api/dip-studio/v1/chat/agent");
    const closingResponse = createResponse();

    middleware(closingRequest, closingResponse, next);
    closingResponse.emit("close");

    expect(next).toHaveBeenCalledTimes(2);
  });

  it("does not end twice after finish or close on completed response", () => {
    const middleware = createChatAgentTracingMiddleware();
    const request = createRequest("/api/dip-studio/v1/chat/agent");
    const response = createResponse();
    const next = vi.fn<NextFunction>();

    middleware(request, response, next);
    response.writableEnded = true;
    response.emit("finish");
    response.emit("close");

    expect(next).toHaveBeenCalledOnce();
  });
});
