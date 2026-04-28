import { describe, expect, it } from "vitest";

import {
  readOtelConfig,
  resolveTraceExporterUrl
} from "./config";

describe("readOtelConfig", () => {
  it("reads explicit otel settings", () => {
    expect(readOtelConfig({
      OTEL_TRACE_ENABLED: "true",
      OTEL_SERVICE_NAME: "studio-api",
      OTEL_SERVICE_VERSION: "1.2.3",
      OTEL_ENVIRONMENT: "prod",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel:4318",
      OTEL_TRACE_SAMPLING_RATE: "0.25"
    })).toEqual({
      enabled: true,
      serviceName: "studio-api",
      serviceVersion: "1.2.3",
      environment: "prod",
      exporterEndpoint: "http://otel:4318",
      samplingRate: 0.25
    });
  });

  it("falls back to defaults for missing and invalid values", () => {
    expect(readOtelConfig({
      OTEL_TRACE_ENABLED: "",
      OTEL_SERVICE_NAME: "   ",
      OTEL_TRACE_SAMPLING_RATE: "9"
    })).toEqual({
      enabled: false,
      serviceName: "studio",
      serviceVersion: undefined,
      environment: undefined,
      exporterEndpoint: undefined,
      samplingRate: 1
    });
  });
});

describe("resolveTraceExporterUrl", () => {
  it("appends the traces suffix when absent", () => {
    expect(resolveTraceExporterUrl("http://otel:4318")).toBe(
      "http://otel:4318/v1/traces"
    );
    expect(resolveTraceExporterUrl("http://otel:4318/collector/")).toBe(
      "http://otel:4318/collector/v1/traces"
    );
  });

  it("keeps an existing traces suffix", () => {
    expect(resolveTraceExporterUrl("http://otel:4318/v1/traces")).toBe(
      "http://otel:4318/v1/traces"
    );
  });
});
