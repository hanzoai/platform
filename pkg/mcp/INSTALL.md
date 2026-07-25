# Installing Platform MCP in Claude Code

## Quick Setup

1. **Create API Key** in Platform:
   - Go to https://platform.hanzo.ai/dashboard/settings/profile
   - Create a new API key
   - Copy the key

2. **Add to Claude Code**:
   - In Claude Code, go to Settings → MCP
   - Add this configuration:

```json
{
  "mcpServers": {
    "platform": {
      "command": "node",
      "args": ["/home/z/platform/pkg/mcp/build/index.js"],
      "env": {
        "PLATFORM_URL": "https://platform.hanzo.ai/v1/trpc",
        "PLATFORM_API_KEY": "your-api-key-from-step-1"
      }
    }
  }
}
```

`PLATFORM_URL` is the tRPC endpoint the tools call (`<PLATFORM_URL>/project.all`,
`<PLATFORM_URL>/compose.deploy`, …). Platform serves tRPC natively at `/v1/trpc`
— never under an `/api` prefix, which 404s.

3. **Restart Claude Code** to load the MCP server

## Available Tools

Once installed, you can ask Claude to:
- List all projects: "Show me all my platform projects"
- Create applications: "Create a new Node.js app in the cloud project"
- Deploy services: "Deploy the cloud compose service"
- Manage databases: "Create a PostgreSQL database for my app"
- View compose services: "Show me the cloud production compose details"

## Testing

Test the connection:
```bash
PLATFORM_URL=https://platform.hanzo.ai/v1/trpc PLATFORM_API_KEY=your-key node /home/z/platform/pkg/mcp/build/index.js
```

Should output: `{"level":"info","message":"MCP Platform CLI server running via stdio"...}`

## Troubleshooting

If the MCP server doesn't work:
1. Verify the API key is valid
2. Check that platform.hanzo.ai is accessible
3. Ensure Node.js v18+ is installed
4. Check Claude Code logs for MCP errors
