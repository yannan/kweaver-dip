/**
 * Normalized OpenTelemetry runtime configuration for Studio.
 */
export interface OtelConfig {
  enabled: boolean;
  serviceName: string;
  serviceVersion?: string;
  environment?: string;
  exporterEndpoint?: string;
  samplingRate: number;
}

const DEFAULT_SERVICE_NAME = "studio";

/**
 * Reads Studio OpenTelemetry environment variables.
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
