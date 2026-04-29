import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

import { registerDipOtelGatewayHooks } from "./otel-runtime.js";

describe("registerDipOtelGatewayHooks", () => {
  it("registers gateway_start and gateway_stop handlers", () => {
    const on = vi.fn<OpenClawPluginApi["on"]>();
    const api = {
      on,
      logger: { warn: vi.fn(), info: vi.fn() }
    } as unknown as OpenClawPluginApi;

    registerDipOtelGatewayHooks(api);

    expect(on.mock.calls.map(([hookName]) => hookName)).toEqual([
      "gateway_start",
      "gateway_stop"
    ]);
  });
});
