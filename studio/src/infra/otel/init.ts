import { DiagConsoleLogger, DiagLogLevel, diag } from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  BatchLogRecordProcessor,
  ConsoleLogRecordExporter,
  SimpleLogRecordProcessor
} from "@opentelemetry/sdk-logs";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  ParentBasedSampler,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler
} from "@opentelemetry/sdk-trace-base";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT
} from "@opentelemetry/semantic-conventions";

import {
  readOtelConfig,
  resolveLogExporterUrl,
  resolveTraceExporterUrl
} from "./config";

let sdk: NodeSDK | undefined;
let initPromise: Promise<void> | undefined;

/**
 * Initializes the Studio OpenTelemetry SDK once.
 */
export async function initOtel(): Promise<void> {
  if (initPromise !== undefined) {
    return initPromise;
  }

  const config = readOtelConfig();
  const enableLocalExporter =
    config.traceExporter === "local" || config.traceExporter === "both";
  const enableOtlpExporter =
    config.traceExporter === "otlp" || config.traceExporter === "both";
  const enableLocalLogExporter =
    config.logEnabled &&
    (config.logExporter === "local" || config.logExporter === "both");
  const enableOtlpLogExporter =
    config.logEnabled &&
    (config.logExporter === "otlp" || config.logExporter === "both");
  const diagLogLevel = resolveDiagLogLevel(config.logLevel);
  configureDiagLogLevel(config.logLevel);

  if (
    (!config.enabled && !config.logEnabled) ||
    ((enableOtlpExporter || enableOtlpLogExporter) && config.exporterEndpoint === undefined)
  ) {
    setDiagLogger(diagLogLevel);
    if (!config.enabled && !config.logEnabled) {
      diag.info("studio-otel: tracing and logging are both disabled; skip sdk startup");
    } else {
      diag.warn("studio-otel: OTLP exporter selected but OTEL_EXPORTER_OTLP_ENDPOINT is missing; skip sdk startup");
    }
    initPromise = Promise.resolve();
    return initPromise;
  }

  const spanProcessors = [];

  if (enableLocalExporter) {
    spanProcessors.push(
      new SimpleSpanProcessor(new ConsoleSpanExporter())
    );
  }

  if (enableOtlpExporter && config.exporterEndpoint !== undefined) {
    spanProcessors.push(
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: resolveTraceExporterUrl(config.exporterEndpoint)
        })
      )
    );
  }

  const logRecordProcessors = [];

  if (enableLocalLogExporter) {
    logRecordProcessors.push(
      new SimpleLogRecordProcessor(new ConsoleLogRecordExporter())
    );
  }

  if (enableOtlpLogExporter && config.exporterEndpoint !== undefined) {
    logRecordProcessors.push(
      new BatchLogRecordProcessor(
        new OTLPLogExporter({
          url: resolveLogExporterUrl(config.exporterEndpoint)
        })
      )
    );
  }

  if (spanProcessors.length === 0 && logRecordProcessors.length === 0) {
    setDiagLogger(diagLogLevel);
    diag.info("studio-otel: no active span/log processors after config evaluation; skip sdk startup");
    initPromise = Promise.resolve();
    return initPromise;
  }

  configureDiagLogLevel(config.logLevel);
  diag.debug(
    `studio-otel: init with trace=${config.enabled ? config.traceExporter : "off"}, log=${config.logEnabled ? config.logExporter : "off"}, level=${config.logLevel}`
  );

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: config.environment
    }),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(config.samplingRate)
    }),
    spanProcessors,
    logRecordProcessors
  });
  initPromise = Promise.resolve(sdk.start());
  diag.info(
    `studio-otel: sdk started with spanProcessors=${spanProcessors.length}, logRecordProcessors=${logRecordProcessors.length}`
  );

  return initPromise;
}

function configureDiagLogLevel(logLevel: string | undefined): void {
  const normalized = (logLevel ?? "info").trim();

  if (process.env.OTEL_LOG_LEVEL === undefined || process.env.OTEL_LOG_LEVEL.trim() === "") {
    process.env.OTEL_LOG_LEVEL = normalized;
  }
}

function setDiagLogger(logLevel: DiagLogLevel): void {
  diag.setLogger(new DiagConsoleLogger(), logLevel);
}

function resolveDiagLogLevel(logLevel: string | undefined): DiagLogLevel {
  switch ((logLevel ?? "info").trim().toLowerCase()) {
    case "none":
      return DiagLogLevel.NONE;
    case "error":
      return DiagLogLevel.ERROR;
    case "warn":
      return DiagLogLevel.WARN;
    case "info":
      return DiagLogLevel.INFO;
    case "debug":
      return DiagLogLevel.DEBUG;
    case "verbose":
      return DiagLogLevel.VERBOSE;
    case "all":
      return DiagLogLevel.ALL;
    default:
      return DiagLogLevel.INFO;
  }
}

/**
 * Shuts down the SDK when the process exits.
 */
export async function shutdownOtel(): Promise<void> {
  if (sdk === undefined) {
    return;
  }

  await sdk.shutdown();
  sdk = undefined;
  initPromise = undefined;
}
