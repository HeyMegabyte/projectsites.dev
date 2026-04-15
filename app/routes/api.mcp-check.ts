import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.mcp-check');

export async function loader() {
  try {
    const { MCPService } = await import('~/lib/services/mcpService');
    const mcpService = MCPService.getInstance();
    const serverTools = await mcpService.checkServersAvailabilities();

    return Response.json(serverTools);
  } catch {
    // MCP requires Node.js features — not available on Cloudflare Pages.
    return Response.json({});
  }
}
