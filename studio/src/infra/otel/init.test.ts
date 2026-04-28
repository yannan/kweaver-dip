import { beforeEach, describe, expect, it, vi } from "vitest";

const startMock = vi.fn();
const shutdownMock = vi.fn();
const nodeSdkCtor = vi.fn(() => ({
  start: startMock,
  shutdown: shutdownMock
}));
const exporterCtor = vi.fn((options) => options);
const processorCtor = vi.fn((exporter) => ({
  exporter
}));
const ratioSamplerCtor = vi.fn((ratio) => ({
  ratio
}));
const parentSamplerCtor = vi.fn((config) => config);
const resourceFromAttributesMock = vi.fn((attributes) => ({
  attributes
}));
const ensureGlobalPropagatorMock = vi.fn();
const readOtelConfigMock = vi.fn();
const resolveTraceExporterUrlMock = vi.fn((url: string) => `${url}/v1/traces`);

vi.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: nodeSdkCtor
}));
vi.mock("@opentelemetry/exporter-trace-otlp-proto", () => ({
  OTLPTraceExporter: exporterCtor
}));
vi.mock("@opentelemetry/sdk-trace-base", () => ({
  BatchSpanProcessor: processorCtor,
  ParentBasedSampler: parentSamplerCtor,
  TraceIdRatioBasedSampler: ratioSamplerCtor
}));
vi.mock("@opentelemetry/resources", () => ({
  resourceFromAttributes: resourceFromAttributesMock
}));
vi.mock("./propagation", () => ({
  ensureGlobalPropagator: ensureGlobalPropagatorMock
}));
vi.mock("./config", () => ({
  readOtelConfig: readOtelConfigMock,
  resolveTraceExporterUrl: resolveTraceExporterUrlMock
}));

describe("initOtel", () => {
  beforeEach(() => {
    vi.resetModules();
    startMock.mockReset();
    shutdownMock.mockReset();
    nodeSdkCtor.mockClear();
    exporterCtor.mockClear();
    processorCtor.mockClear();
    ratioSamplerCtor.mockClear();
    parentSamplerCtor.mockClear();
    resourceFromAttributesMock.mockClear();
    ensureGlobalPropagatorMock.mockClear();
    resolveTraceExporterUrlMock.mockClear();
    readOtelConfigMock.mockReset();
  });

  it("skips sdk startup when tracing is disabled", async () => {
    readOtelConfigMock.mockReturnValue({
      enabled: false,
      serviceName: "studio",
      samplingRate: 1
    });
    const { initOtel } = await import("./init");

    await expect(initOtel()).resolves.toBeUndefined();

    expect(ensureGlobalPropagatorMock).toHaveBeenCalledOnce();
    expect(nodeSdkCtor).not.toHaveBeenCalled();
  });

  it("initializes the sdk once when tracing is enabled", async () => {
    startMock.mockResolvedValue(undefined);
    readOtelConfigMock.mockReturnValue({
      enabled: true,
      serviceName: "studio",
      serviceVersion: "1.0.0",
      environment: "test",
      exporterEndpoint: "http://otel:4318",
      samplingRate: 0.5
    });
    const { initOtel } = await import("./init");

    await initOtel();
    await initOtel();

    expect(nodeSdkCtor).toHaveBeenCalledOnce();
    expect(resourceFromAttributesMock).toHaveBeenCalledOnce();
    expect(resolveTraceExporterUrlMock).toHaveBeenCalledWith("http://otel:4318");
    expect(exporterCtor).toHaveBeenCalledWith({
      url: "http://otel:4318/v1/traces"
    });
    expect(startMock).toHaveBeenCalledOnce();
  });

  it("shuts down the sdk and resets local state", async () => {
    startMock.mockResolvedValue(undefined);
    shutdownMock.mockResolvedValue(undefined);
    readOtelConfigMock.mockReturnValue({
      enabled: true,
      serviceName: "studio",
      exporterEndpoint: "http://otel:4318",
      samplingRate: 1
    });
    const { initOtel, shutdownOtel } = await import("./init");

    await initOtel();
    await shutdownOtel();
    await shutdownOtel();

    expect(shutdownMock).toHaveBeenCalledOnce();
  });
});
