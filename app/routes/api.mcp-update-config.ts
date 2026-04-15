import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import type { MCPConfig } from '~/lib/services/mcpService';

const logger = createScopedLogger('api.mcp-update-config');

export async function action({ request }: ActionFunctionArgs) {
  try {
    const mcpConfig = (await request.json()) as MCPConfig;

    if (!mcpConfig || typeof mcpConfig !== 'object') {
      return Response.json({ error: 'Invalid MCP servers configuration' }, { status: 400 });
    }

    try {
      const { MCPService } = await import('~/lib/services/mcpService');
      const mcpService = MCPService.getInstance();
      const serverTools = await mcpService.updateConfig(mcpConfig);
      return Response.json(serverTools);
    } catch {
      return Response.json({});
    }
  } catch (error) {
    logger.error('Error updating MCP config:', error);
    return Response.json({}, { status: 200 });
  }
}
