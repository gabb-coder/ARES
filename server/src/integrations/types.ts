/** A tool the agent can call: from an MCP integration or built into ARES. */
export interface AgentTool {
  /** API-safe unique name ([a-zA-Z0-9_-], ≤ 64 chars). */
  name: string;
  /** Human label, e.g. "github · create_issue". */
  title: string;
  description: string;
  /** JSON Schema for the arguments (type: "object"). */
  inputSchema: Record<string, unknown>;
  /** Ask the user before running (sends, creates, changes or deletes something). */
  requiresConfirmation: boolean;
  /** "ares" for built-ins, otherwise the integration name. */
  source: string;
  call(args: Record<string, unknown>): Promise<ToolOutput>;
}

export interface ToolOutput {
  text: string;
  isError?: boolean;
}
