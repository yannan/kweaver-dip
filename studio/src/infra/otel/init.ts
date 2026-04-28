import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler
} from "@opentelemetry/sdk-trace-base";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT
} from "@opentelemetry/semantic-conventions";

import { readOtelConfig, resolveTraceExporterUrl } from "./config";
import { ensureGlobalPropagator } from "./propagation";

let sdk: NodeSDK | undefined;
let initPromise: Promise<void> | undefined;

/**
 * Initializes the Studio OpenTelemetry SDK once.
 */
export async function initOtel(): Promise<void> {
  ensureGlobalPropagator();

  if (initPromise !== undefined) {
    return initPromise;
  }

  const config = readOtelConfig();

  if (!config.enabled || config.exporterEndpoint === undefined) {
    initPromise = Promise.resolve();
    return initPromise;
  }

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: config.environment
    }),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(config.samplingRate)
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: resolveTraceExporterUrl(config.exporterEndpoint)
        })
      )
    ]
  });
  initPromise = Promise.resolve(sdk.start());

  return initPromise;
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
