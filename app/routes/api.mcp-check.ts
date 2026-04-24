export async function loader() {
  try {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const { MCPService } = await import('~/lib/services/mcpService');
    const mcpService = MCPService.getInstance();
    const serverTools = await mcpService.checkServersAvailabilities();

    return Response.json(serverTools);
  } catch {
    // MCP requires Node.js features — not available on Cloudflare Pages.
    return Response.json({});
  }
}
