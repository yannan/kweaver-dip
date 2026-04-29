import { describe, expect, it } from "vitest";

import {
  readOtelConfig,
  resolveLogExporterUrl,
  resolveTraceExporterUrl
} from "./otel-config.js";

describe("readOtelConfig", () => {
  it("reads explicit otel settings", () => {
    expect(readOtelConfig({
      OTEL_TRACE_ENABLED: "true",
      OTEL_SERVICE_NAME: "dip-test",
      OTEL_SERVICE_VERSION: "1.2.3",
      OTEL_ENVIRONMENT: "prod",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel:4318",
      OTEL_LOG_ENABLED: "true",
      OTEL_LOG_LEVEL: "warn",
      OTEL_LOG_EXPORTER: "both",
      OTEL_TRACE_EXPORTER: "both",
      OTEL_TRACE_SAMPLING_RATE: "0.25"
    })).toEqual({
      enabled: true,
      serviceName: "dip-test",
      serviceVersion: "1.2.3",
      environment: "prod",
      exporterEndpoint: "http://otel:4318",
      traceExporter: "both",
      logEnabled: true,
      logLevel: "warn",
      logExporter: "both",
      samplingRate: 0.25
    });
  });

  it("uses default service name openclaw-dip-plugin", () => {
    expect(readOtelConfig({}).serviceName).toBe("openclaw-dip-plugin");
  });

  it("parses supported trace exporter modes", () => {
    expect(readOtelConfig({
      OTEL_TRACE_EXPORTER: "local"
    }).traceExporter).toBe("local");

    expect(readOtelConfig({
      OTEL_TRACE_EXPORTER: "both"
    }).traceExporter).toBe("both");

    expect(readOtelConfig({
      OTEL_TRACE_EXPORTER: "unknown"
    }).traceExporter).toBe("otlp");
  });
});

describe("resolveTraceExporterUrl", () => {
  it("appends the traces suffix when absent", () => {
    expect(resolveTraceExporterUrl("http://otel:4318")).toBe(
      "http://otel:4318/v1/traces"
    );
  });
});

describe("resolveLogExporterUrl", () => {
  it("appends the logs suffix when absent", () => {
    expect(resolveLogExporterUrl("http://otel:4318")).toBe(
      "http://otel:4318/v1/logs"
    );
  });
});
