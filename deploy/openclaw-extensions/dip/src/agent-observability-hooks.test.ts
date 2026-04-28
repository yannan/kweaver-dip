import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

import { registerAgentObservabilityHooks } from "./agent-observability-hooks.js";

describe("registerAgentObservabilityHooks", () => {
  it("registers the expected runtime hook handlers", () => {
    const on = vi.fn<OpenClawPluginApi["on"]>();
    const api = {
      on
    } as unknown as OpenClawPluginApi;

    registerAgentObservabilityHooks(api);

    expect(on).toHaveBeenCalled();
    expect(on.mock.calls.map(([hookName]) => hookName)).toEqual([
      "session_start",
      "before_agent_start",
      "llm_input",
      "llm_output",
      "before_tool_call",
      "after_tool_call",
      "subagent_spawning",
      "subagent_spawned",
      "subagent_ended",
      "agent_end",
      "session_end"
    ]);
  });
});
