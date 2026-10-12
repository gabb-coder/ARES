/**
 * A tiny MCP server (stdio) used by the integration tests: a ticket tracker
 * with one read-only tool, one unannotated "create" tool and one destructive tool.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const tickets: Array<{ id: number; title: string }> = [{ id: 1, title: 'Existing bug' }];
const server = new McpServer({ name: 'tracker', version: '1.0.0' });

server.registerTool(
  'list_tickets',
  { description: 'List open tickets', annotations: { readOnlyHint: true } },
  async () => ({ content: [{ type: 'text', text: tickets.map((t) => `#${t.id} ${t.title}`).join('\n') }] }),
);

server.registerTool(
  'create_ticket',
  { description: 'File a new ticket', inputSchema: { title: z.string() } },
  async ({ title }) => {
    const ticket = { id: tickets.length + 1, title };
    tickets.push(ticket);
    return { content: [{ type: 'text', text: `Created ticket #${ticket.id}: ${title}` }] };
  },
);

server.registerTool(
  'get_and_close_all',
  { description: 'Close every ticket', annotations: { destructiveHint: true } },
  async () => ({ content: [{ type: 'text', text: 'All closed' }] }),
);

await server.connect(new StdioServerTransport());
