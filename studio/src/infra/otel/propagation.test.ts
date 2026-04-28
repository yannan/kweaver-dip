import { context, trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it } from "vitest";

import {
  ensureGlobalPropagator,
  extractContextFromOpenClawPayload,
  getActiveTraceparent,
  injectContextToHeaders,
  injectContextToOpenClawPayload,
  type OpenClawOtelPayload
} from "./propagation";

describe("otel propagation helpers", () => {
  const activeContext = trace.setSpan(
    context.active(),
    trace.wrapSpanContext({
      traceId: "0123456789abcdef0123456789abcdef",
      spanId: "0123456789abcdef",
      traceFlags: 1
    })
  );

  afterEach(() => {
    // Reset is handled by helper-local lazy initialization.
  });

  it("injects trace context into HTTP headers", () => {
    const headers = injectContextToHeaders(new Headers(), activeContext);

    expect(String(headers.get("traceparent"))).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[0-9a-f]$/
    );
  });

  it("injects and extracts `_otel` payloads for OpenClaw RPC", () => {
    const payload = injectContextToOpenClawPayload(
      {
        sessionKey: "sess-1",
        message: "hello"
      },
      activeContext
    );

    expect(payload._otel).toBeDefined();
    expect(payload._otel?.traceparent).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[0-9a-f]$/
    );

    const extracted = extractContextFromOpenClawPayload(payload);
    const extractedSpanContext = trace.getSpanContext(extracted);

    expect(extractedSpanContext?.traceId).toBe(
      "0123456789abcdef0123456789abcdef"
    );
  });

  it("ignores invalid `_otel` payloads", () => {
    const payload = {
      _otel: {
        traceparent: ""
      }
    } as OpenClawOtelPayload;

    const extracted = extractContextFromOpenClawPayload(payload);

    expect(trace.getSpanContext(extracted)).toBeUndefined();
  });

  it("leaves headers and payload unchanged when there is no active span context", () => {
    const headers = injectContextToHeaders(new Headers({
      existing: "1"
    }), context.active());
    const payload = injectContextToOpenClawPayload({
      sessionKey: "sess-1"
    }, context.active());

    expect(headers.get("existing")).toBe("1");
    expect(headers.get("traceparent")).toBeNull();
    expect(payload).toEqual({
      sessionKey: "sess-1"
    });
  });

  it("handles invalid extraction and repeated propagator setup", () => {
    const extracted = extractContextFromOpenClawPayload({
      _otel: {
        traceparent: "not-a-traceparent"
      }
    });

    ensureGlobalPropagator();
    ensureGlobalPropagator();

    expect(trace.getSpanContext(extracted)).toBeUndefined();
    expect(getActiveTraceparent()).toBeUndefined();
  });
});
