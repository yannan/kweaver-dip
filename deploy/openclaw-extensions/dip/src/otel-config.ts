/**
 * Normalized OpenTelemetry runtime configuration for the DIP OpenClaw plugin.
 */
export interface OtelConfig {
  enabled: boolean;
  serviceName: string;
  serviceVersion?: string;
  environment?: string;
  exporterEndpoint?: string;
  traceExporter: "otlp" | "local" | "both";
  logEnabled: boolean;
  logLevel: string;
  logExporter: "otlp" | "local" | "both";
  samplingRate: number;
}

const DEFAULT_SERVICE_NAME = "openclaw-dip-plugin";

/**
 * Reads OpenTelemetry environment variables used by the DIP plugin and Studio.
 *
 * Recognized keys include `OTEL_TRACE_ENABLED`, `OTEL_SERVICE_NAME`,
 * `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_TRACE_EXPORTER`,
 * `OTEL_TRACE_SAMPLING_RATE`, `OTEL_LOG_ENABLED`, `OTEL_LOG_LEVEL`, and
 * `OTEL_LOG_EXPORTER`.
 *
 * @param env Optional environment override used by tests.
 * @returns Normalized tracing config.
 */
export function readOtelConfig(
  env: NodeJS.ProcessEnv = process.env
): OtelConfig {
  return {
    enabled: readBoolean(env.OTEL_TRACE_ENABLED, false),
    serviceName: readTrimmed(env.OTEL_SERVICE_NAME) ?? DEFAULT_SERVICE_NAME,
    serviceVersion: readTrimmed(env.OTEL_SERVICE_VERSION),
    environment: readTrimmed(env.OTEL_ENVIRONMENT),
    exporterEndpoint: readTrimmed(env.OTEL_EXPORTER_OTLP_ENDPOINT),
    traceExporter: readTraceExporter(env.OTEL_TRACE_EXPORTER),
    logEnabled: readBoolean(env.OTEL_LOG_ENABLED, false),
    logLevel: readTrimmed(env.OTEL_LOG_LEVEL) ?? "info",
    logExporter: readLogExporter(env.OTEL_LOG_EXPORTER),
    samplingRate: readSamplingRate(env.OTEL_TRACE_SAMPLING_RATE)
  };
}

/**
 * Appends the trace path segment expected by OTLP/HTTP exporters.
 *
 * @param endpoint Base OTLP endpoint.
 * @returns Trace export endpoint.
 */
export function resolveTraceExporterUrl(endpoint: string): string {
  const url = new URL(endpoint);

  if (url.pathname.endsWith("/v1/traces")) {
    return url.toString();
  }

  url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/traces`;

  return url.toString();
}

/**
 * Appends the logs path segment expected by OTLP/HTTP exporters.
 *
 * @param endpoint Base OTLP endpoint.
 * @returns Log export endpoint.
 */
export function resolveLogExporterUrl(endpoint: string): string {
  const url = new URL(endpoint);

  if (url.pathname.endsWith("/v1/logs")) {
    return url.toString();
  }

  url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/logs`;

  return url.toString();
}

function readTrimmed(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed === "" ? undefined : trimmed;
}

function readBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  return value.trim().toLowerCase() === "true";
}

function readSamplingRate(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return 1;
  }

  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return 1;
  }

  return parsed;
}

function readTraceExporter(value: string | undefined): "otlp" | "local" | "both" {
  if (value === undefined || value.trim() === "") {
    return "otlp";
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "otlp" || normalized === "local" || normalized === "both") {
    return normalized;
  }

  return "otlp";
}

function readLogExporter(value: string | undefined): "otlp" | "local" | "both" {
  if (value === undefined || value.trim() === "") {
    return "otlp";
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "otlp" || normalized === "local" || normalized === "both") {
    return normalized;
  }

  return "otlp";
}
