import { context } from "@opentelemetry/api";

import { injectContextToHeaders } from "../otel/propagation";

/**
 * Fetch wrapper that injects the active trace context into outbound headers.
 *
 * @param fetchImpl Fetch implementation.
 * @param input Request input.
 * @param init Request init.
 * @param carrierContext Explicit trace context override.
 * @returns Fetch response promise.
 */
export function fetchWithTrace(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit = {},
  carrierContext = context.active()
): Promise<Response> {
  return fetchImpl(input, {
    ...init,
    headers: injectContextToHeaders(init.headers, carrierContext)
  });
}
