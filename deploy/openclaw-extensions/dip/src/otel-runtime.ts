import {
  DiagConsoleLogger,
  DiagLogLevel,
  ProxyTracerProvider,
  diag,
  trace,
  type TracerProvider
} from "@opentelemetry/api";
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
  TraceIdRatioBasedSampler,
  type SpanProcessor
} from "@opentelemetry/sdk-trace-base";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT
} from "@opentelemetry/semantic-conventions";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

import {
  readOtelConfig,
  resolveLogExporterUrl,
  resolveTraceExporterUrl
} from "./otel-config.js";

type MultiSpanProcessorInternals = {
  _spanProcessors: SpanProcessor[];
};

type TracerProviderWithProcessors = {
  _activeSpanProcessor?: MultiSpanProcessorInternals;
};

let standaloneSdk: NodeSDK | undefined;
let consoleExporterAttached = false;

/**
 * Resolves the concrete {@link TracerProvider} behind the API proxy, if any.
 *
 * @param provider Value returned from {@link trace.getTracerProvider}.
 * @returns Delegate or the same reference.
 */
function resolveDelegate(provider: TracerProvider): TracerProvider {
  return provider instanceof ProxyTracerProvider ? provider.getDelegate() : provider;
}

/**
 * Returns true when the provider uses an internal {@link MultiSpanProcessor} list
 * that can accept an extra {@link SpanProcessor} (OpenTelemetry JS implementation detail).
 *
 * @param provider Resolved tracer provider.
 */
function isAugmentableTracerProvider(
  provider: TracerProvider
): provider is TracerProvider & TracerProviderWithProcessors {
  const active = (provider as TracerProviderWithProcessors)._activeSpanProcessor;

  return (
    active !== undefined &&
    Array.isArray(active._spanProcessors)
  );
}

/**
 * Appends a {@link ConsoleSpanExporter} to the active global tracer provider when supported.
 *
 * @returns Whether the exporter was attached.
 */
function tryAttachConsoleSpanExporter(): boolean {
  if (consoleExporterAttached) {
    return true;
  }

  const delegate = resolveDelegate(trace.getTracerProvider());

  if (!isAugmentableTracerProvider(delegate)) {
    return false;
  }

  const processors = delegate._activeSpanProcessor?._spanProcessors;

  if (processors === undefined) {
    return false;
  }

  processors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  consoleExporterAttached = true;

  return true;
}

/**
 * Starts a {@link NodeSDK} for this process when no other SDK has registered a tracer provider
 * (same env contract as Studio: {@link readOtelConfig}).
 */
function startStandaloneOtelIfNeeded(): void {
  if (standaloneSdk !== undefined) {
    return;
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

  diag.setLogger(new DiagConsoleLogger(), diagLogLevel);
  diag.debug(
    `dip-otel: init standalone with trace=${config.enabled ? config.traceExporter : "off"}, log=${config.logEnabled ? config.logExporter : "off"}, level=${config.logLevel}`
  );

  if (
    (!config.enabled && !config.logEnabled) ||
    ((enableOtlpExporter || enableOtlpLogExporter) && config.exporterEndpoint === undefined)
  ) {
    if (!config.enabled && !config.logEnabled) {
      diag.info("dip-otel: tracing and logging are both disabled; skip standalone sdk startup");
    } else {
      diag.warn("dip-otel: OTLP exporter selected but OTEL_EXPORTER_OTLP_ENDPOINT is missing; skip standalone sdk startup");
    }
    return;
  }

  const delegate = resolveDelegate(trace.getTracerProvider());

  if (isAugmentableTracerProvider(delegate)) {
    diag.debug("dip-otel: tracer provider already active; skip standalone sdk startup");
    return;
  }

  const spanProcessors: SpanProcessor[] = [];

  if (enableLocalExporter) {
    spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
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
    diag.info("dip-otel: no active span/log processors after config evaluation; skip standalone sdk startup");
    return;
  }

  standaloneSdk = new NodeSDK({
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

  void standaloneSdk.start();
  diag.info(
    `dip-otel: standalone sdk started with spanProcessors=${spanProcessors.length}, logRecordProcessors=${logRecordProcessors.length}`
  );
}

/**
 * Runs OpenTelemetry bootstrap for the DIP plugin after the gateway (and plugin services such
 * as diagnostics-otel) have started: optionally attaches {@link ConsoleSpanExporter} to the
 * active provider, or starts a standalone {@link NodeSDK} when tracing is enabled and the
 * provider is still a no-op.
 *
 * @param logger Optional plugin logger for informational messages.
 */
export function onGatewayOtelStart(logger?: OpenClawPluginApi["logger"]): void {
  const config = readOtelConfig();
  const enableLocalExporter =
    config.traceExporter === "local" || config.traceExporter === "both";

  if (enableLocalExporter) {
    if (tryAttachConsoleSpanExporter()) {
      logger?.info?.("dip-otel: ConsoleSpanExporter attached to active tracer provider");
      return;
    }
  }

  startStandaloneOtelIfNeeded();
}

/**
 * Shuts down the standalone {@link NodeSDK} started by this plugin, if any.
 */
export async function onGatewayOtelStop(): Promise<void> {
  if (standaloneSdk === undefined) {
    return;
  }

  await standaloneSdk.shutdown().catch(() => undefined);
  standaloneSdk = undefined;
}

/**
 * Registers {@link gateway_start} / {@link gateway_stop} hooks so DIP tracing follows the same
 * OTLP and console exporter env vars as Studio after OpenClaw services are up.
 *
 * @param api OpenClaw plugin API.
 */
export function registerDipOtelGatewayHooks(api: OpenClawPluginApi): void {
  api.on("gateway_start", () => {
    try {
      onGatewayOtelStart(api.logger);
    } catch (error) {
      api.logger.warn?.(`dip-otel: gateway_start failed: ${String(error)}`);
    }
  });

  api.on("gateway_stop", () => {
    void onGatewayOtelStop().catch(() => undefined);
  });
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
