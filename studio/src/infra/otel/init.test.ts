import { beforeEach, describe, expect, it, vi } from "vitest";

const diagSetLoggerMock = vi.fn();
const diagDebugMock = vi.fn();
const diagInfoMock = vi.fn();
const diagWarnMock = vi.fn();
const diagConsoleLoggerCtor = vi.fn(() => ({}));

const startMock = vi.fn();
const shutdownMock = vi.fn();
const nodeSdkCtor = vi.fn(() => ({
  start: startMock,
  shutdown: shutdownMock
}));
const exporterCtor = vi.fn((options) => options);
const logExporterCtor = vi.fn((options) => options);
const processorCtor = vi.fn((exporter) => ({
  exporter
}));
const logProcessorCtor = vi.fn((exporter) => ({
  exporter
}));
const simpleProcessorCtor = vi.fn((exporter) => ({
  kind: "simple",
  exporter
}));
const simpleLogProcessorCtor = vi.fn((exporter) => ({
  kind: "simple-log",
  exporter
}));
const consoleExporterCtor = vi.fn(() => ({}));
const consoleLogExporterCtor = vi.fn(() => ({}));
const ratioSamplerCtor = vi.fn((ratio) => ({
  ratio
}));
const parentSamplerCtor = vi.fn((config) => config);
const resourceFromAttributesMock = vi.fn((attributes) => ({
  attributes
}));
const readOtelConfigMock = vi.fn();
const resolveTraceExporterUrlMock = vi.fn((url: string) => `${url}/v1/traces`);
const resolveLogExporterUrlMock = vi.fn((url: string) => `${url}/v1/logs`);

vi.mock("@opentelemetry/api", () => ({
  diag: {
    setLogger: diagSetLoggerMock,
    debug: diagDebugMock,
    info: diagInfoMock,
    warn: diagWarnMock
  },
  DiagConsoleLogger: diagConsoleLoggerCtor,
  DiagLogLevel: {
    NONE: 0,
    ERROR: 30,
    WARN: 50,
    INFO: 60,
    DEBUG: 70,
    VERBOSE: 80,
    ALL: 9999
  }
}));
vi.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: nodeSdkCtor
}));
vi.mock("@opentelemetry/exporter-trace-otlp-proto", () => ({
  OTLPTraceExporter: exporterCtor
}));
vi.mock("@opentelemetry/exporter-logs-otlp-proto", () => ({
  OTLPLogExporter: logExporterCtor
}));
vi.mock("@opentelemetry/sdk-logs", () => ({
  BatchLogRecordProcessor: logProcessorCtor,
  SimpleLogRecordProcessor: simpleLogProcessorCtor,
  ConsoleLogRecordExporter: consoleLogExporterCtor
}));
vi.mock("@opentelemetry/sdk-trace-base", () => ({
  BatchSpanProcessor: processorCtor,
  SimpleSpanProcessor: simpleProcessorCtor,
  ConsoleSpanExporter: consoleExporterCtor,
  ParentBasedSampler: parentSamplerCtor,
  TraceIdRatioBasedSampler: ratioSamplerCtor
}));
vi.mock("@opentelemetry/resources", () => ({
  resourceFromAttributes: resourceFromAttributesMock
}));
vi.mock("./config", () => ({
  readOtelConfig: readOtelConfigMock,
  resolveTraceExporterUrl: resolveTraceExporterUrlMock,
  resolveLogExporterUrl: resolveLogExporterUrlMock
}));

describe("initOtel", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.OTEL_LOG_LEVEL;
    startMock.mockReset();
    shutdownMock.mockReset();
    diagSetLoggerMock.mockReset();
    diagDebugMock.mockReset();
    diagInfoMock.mockReset();
    diagWarnMock.mockReset();
    diagConsoleLoggerCtor.mockReset();
    nodeSdkCtor.mockClear();
    exporterCtor.mockClear();
    logExporterCtor.mockClear();
    processorCtor.mockClear();
    logProcessorCtor.mockClear();
    simpleProcessorCtor.mockClear();
    simpleLogProcessorCtor.mockClear();
    consoleExporterCtor.mockClear();
    consoleLogExporterCtor.mockClear();
    ratioSamplerCtor.mockClear();
    parentSamplerCtor.mockClear();
    resourceFromAttributesMock.mockClear();
    resolveTraceExporterUrlMock.mockClear();
    resolveLogExporterUrlMock.mockClear();
    readOtelConfigMock.mockReset();
  });

  it("skips sdk startup when tracing is disabled", async () => {
    readOtelConfigMock.mockReturnValue({
      enabled: false,
      serviceName: "studio",
      traceExporter: "otlp",
      samplingRate: 1
    });
    const { initOtel } = await import("./init");

    await expect(initOtel()).resolves.toBeUndefined();

    expect(nodeSdkCtor).not.toHaveBeenCalled();
    expect(diagSetLoggerMock).toHaveBeenCalledOnce();
  });

  it("initializes the sdk once when tracing is enabled", async () => {
    startMock.mockResolvedValue(undefined);
    readOtelConfigMock.mockReturnValue({
      enabled: true,
      serviceName: "studio",
      serviceVersion: "1.0.0",
      environment: "test",
      exporterEndpoint: "http://otel:4318",
      traceExporter: "otlp",
      samplingRate: 0.5
    });
    const { initOtel } = await import("./init");

    await initOtel();
    await initOtel();

    expect(nodeSdkCtor).toHaveBeenCalledOnce();
    expect(resourceFromAttributesMock).toHaveBeenCalledOnce();
    expect(process.env.OTEL_LOG_LEVEL).toBe("info");
    expect(resolveTraceExporterUrlMock).toHaveBeenCalledWith("http://otel:4318");
    expect(exporterCtor).toHaveBeenCalledWith({
      url: "http://otel:4318/v1/traces"
    });
    expect(startMock).toHaveBeenCalledOnce();
    expect(diagSetLoggerMock).not.toHaveBeenCalled();
    expect(simpleProcessorCtor).not.toHaveBeenCalled();
    expect(consoleExporterCtor).not.toHaveBeenCalled();
  });

  it("initializes log exporter when logs are enabled", async () => {
    startMock.mockResolvedValue(undefined);
    readOtelConfigMock.mockReturnValue({
      enabled: false,
      serviceName: "studio",
      exporterEndpoint: "http://otel:4318",
      traceExporter: "otlp",
      logEnabled: true,
      logExporter: "otlp",
      samplingRate: 1
    });
    const { initOtel } = await import("./init");

    await initOtel();

    expect(resolveLogExporterUrlMock).toHaveBeenCalledWith("http://otel:4318");
    expect(logExporterCtor).toHaveBeenCalledWith({
      url: "http://otel:4318/v1/logs"
    });
    expect(logProcessorCtor).toHaveBeenCalledOnce();
    expect(nodeSdkCtor).toHaveBeenCalledOnce();
  });

  it("registers console log exporter when local log exporter is used", async () => {
    startMock.mockResolvedValue(undefined);
    readOtelConfigMock.mockReturnValue({
      enabled: false,
      serviceName: "studio",
      traceExporter: "local",
      logEnabled: true,
      logExporter: "local",
      samplingRate: 1
    });
    const { initOtel } = await import("./init");

    await initOtel();

    expect(consoleLogExporterCtor).toHaveBeenCalledOnce();
    expect(simpleLogProcessorCtor).toHaveBeenCalledOnce();
    expect(logProcessorCtor).not.toHaveBeenCalled();
    const sdkArgs = nodeSdkCtor.mock.calls[0][0];
    expect(sdkArgs.logRecordProcessors).toHaveLength(1);
  });

  it("registers console span exporter when local trace exporter is used", async () => {
    startMock.mockResolvedValue(undefined);
    readOtelConfigMock.mockReturnValue({
      enabled: true,
      serviceName: "studio",
      exporterEndpoint: "http://otel:4318",
      traceExporter: "local",
      samplingRate: 1
    });
    const { initOtel } = await import("./init");

    await initOtel();

    expect(consoleExporterCtor).toHaveBeenCalledOnce();
    expect(simpleProcessorCtor).toHaveBeenCalledOnce();
    expect(processorCtor).not.toHaveBeenCalled();
    const sdkArgs = nodeSdkCtor.mock.calls[0][0];
    expect(sdkArgs.spanProcessors).toHaveLength(1);
  });

  it("registers both exporters when both trace exporter is used", async () => {
    startMock.mockResolvedValue(undefined);
    readOtelConfigMock.mockReturnValue({
      enabled: true,
      serviceName: "studio",
      exporterEndpoint: "http://otel:4318",
      traceExporter: "both",
      samplingRate: 1
    });
    const { initOtel } = await import("./init");

    await initOtel();

    expect(consoleExporterCtor).toHaveBeenCalledOnce();
    expect(simpleProcessorCtor).toHaveBeenCalledOnce();
    expect(processorCtor).toHaveBeenCalledOnce();
    const sdkArgs = nodeSdkCtor.mock.calls[0][0];
    expect(sdkArgs.spanProcessors).toHaveLength(2);
  });

  it("skips sdk startup when otlp exporter is selected but endpoint is missing", async () => {
    readOtelConfigMock.mockReturnValue({
      enabled: true,
      serviceName: "studio",
      traceExporter: "otlp",
      samplingRate: 1
    });
    const { initOtel } = await import("./init");

    await expect(initOtel()).resolves.toBeUndefined();

    expect(nodeSdkCtor).not.toHaveBeenCalled();
  });

  it("shuts down the sdk and resets local state", async () => {
    startMock.mockResolvedValue(undefined);
    shutdownMock.mockResolvedValue(undefined);
    readOtelConfigMock.mockReturnValue({
      enabled: true,
      serviceName: "studio",
      exporterEndpoint: "http://otel:4318",
      traceExporter: "otlp",
      samplingRate: 1
    });
    const { initOtel, shutdownOtel } = await import("./init");

    await initOtel();
    await shutdownOtel();
    await shutdownOtel();

    expect(shutdownMock).toHaveBeenCalledOnce();
  });
});
