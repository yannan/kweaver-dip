import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { registerArchivesAccess } from "./src/archives-access.js";
import { registerAgentObservabilityHooks } from "./src/agent-observability-hooks.js";
import { registerDipOtelGatewayHooks } from "./src/otel-runtime.js";
import { registerSkillsControl } from "./src/skills-control.js";
import { registerWorkspaceTempUpload } from "./src/workspace-temp-upload.js";

/**
 * DIP OpenClaw plugin (`dip`): agent skills HTTP/CLI, workspace archives, bundled contextloader skill discovery.
 */
export default function register(api: OpenClawPluginApi): void {
  registerDipOtelGatewayHooks(api);
  registerAgentObservabilityHooks(api);
  registerSkillsControl(api);
  registerArchivesAccess(api);
  registerWorkspaceTempUpload(api);
}
