# Hanzo MCP Server

[![npm version](https://img.shields.io/npm/v/@hanzo/hanzo-mcp.svg)](https://www.npmjs.com/package/@hanzo/hanzo-mcp) [<img alt="Install in VS Code (npx)" src="https://img.shields.io/badge/VS_Code-VS_Code?style=flat-square&label=Install%20Hanzo%20MCP&color=0098FF">](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%7B%22name%22%3A%22hanzo-mcp%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40hanzo%2Fhanzo-mcp%40latest%22%5D%7D)

Hanzo MCP Server exposes Hanzo functionalities as tools consumable via the Model Context Protocol (MCP). It allows MCP-compatible clients (e.g., AI models, other applications) to interact with your Hanzo server programmatically.

This server focuses exclusively on **tools** for direct Hanzo API operations, providing a clean and efficient interface for project and application management.

## 🛠️ Getting Started

### Requirements

- Node.js >= v18.0.0 (or Docker)
- Cursor, VS Code, Claude Desktop, or another MCP Client
- A running Hanzo server instance

### Install in Cursor

Go to: `Settings` -> `Cursor Settings` -> `MCP` -> `Add new global MCP server`

Add this to your Cursor `~/.cursor/mcp.json` file. You may also install in a specific project by creating `.cursor/mcp.json` in your project folder. See [Cursor MCP docs](https://docs.cursor.com/context/model-context-protocol) for more info.

```json
{
  "mcpServers": {
    "hanzo-mcp": {
      "command": "npx",
      "args": ["-y", "@hanzo/hanzo-mcp"],
      "env": {
        "HANZO_URL": "https://your-hanzo-server.com/api",
        "HANZO_API_KEY": "your-hanzo-api-token"
      }
    }
  }
}
```

<details>
<summary>Alternative: Use Bun</summary>

```json
{
  "mcpServers": {
    "hanzo-mcp": {
      "command": "bunx",
      "args": ["-y", "@hanzo/hanzo-mcp"],
      "env": {
        "HANZO_URL": "https://your-hanzo-server.com/api",
        "HANZO_API_KEY": "your-hanzo-api-token"
      }
    }
  }
}
```

</details>

<details>
<summary>Alternative: Use Deno</summary>

```json
{
  "mcpServers": {
    "hanzo-mcp": {
      "command": "deno",
      "args": ["run", "--allow-env", "--allow-net", "npm:@hanzo/hanzo-mcp"],
      "env": {
        "HANZO_URL": "https://your-hanzo-server.com/api",
        "HANZO_API_KEY": "your-hanzo-api-token"
      }
    }
  }
}
```

</details>

### Install in Windsurf

Add this to your Windsurf MCP config file. See [Windsurf MCP docs](https://docs.windsurf.com/windsurf/mcp) for more info.

```json
{
  "mcpServers": {
    "hanzo-mcp": {
      "command": "npx",
      "args": ["-y", "@hanzo/hanzo-mcp"],
      "env": {
        "HANZO_URL": "https://your-hanzo-server.com/api",
        "HANZO_API_KEY": "your-hanzo-api-token"
      }
    }
  }
}
```

### Install in VS Code

[<img alt="Install in VS Code (npx)" src="https://img.shields.io/badge/VS_Code-VS_Code?style=flat-square&label=Install%20Hanzo%20MCP&color=0098FF">](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%7B%22name%22%3A%22hanzo-mcp%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40hanzo%2Fhanzo-mcp%40latest%22%5D%7D)
[<img alt="Install in VS Code Insiders (npx)" src="https://img.shields.io/badge/VS_Code_Insiders-VS_Code_Insiders?style=flat-square&label=Install%20Hanzo%20MCP&color=24bfa5">](https://insiders.vscode.dev/redirect?url=vscode-insiders%3Amcp%2Finstall%3F%7B%22name%22%3A%22hanzo-mcp%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40hanzo%2Fhanzo-mcp%40latest%22%5D%7D)

Add this to your VS Code MCP config file. See [VS Code MCP docs](https://code.visualstudio.com/docs/copilot/chat/mcp-servers) for more info.

```json
{
  "servers": {
    "hanzo-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@hanzo/hanzo-mcp"],
      "env": {
        "HANZO_URL": "https://your-hanzo-server.com/api",
        "HANZO_API_KEY": "your-hanzo-api-token"
      }
    }
  }
}
```

### Install in Zed

Add this to your Zed `settings.json`. See [Zed Context Server docs](https://zed.dev/docs/assistant/context-servers) for more info.

```json
{
  "context_servers": {
    "hanzo-mcp": {
      "command": {
        "path": "npx",
        "args": ["-y", "@hanzo/hanzo-mcp"]
      },
      "settings": {
        "HANZO_URL": "https://your-hanzo-server.com/api",
        "HANZO_API_KEY": "your-hanzo-api-token"
      }
    }
  }
}
```

### Install in Claude Desktop

Add this to your Claude Desktop `claude_desktop_config.json` file. See [Claude Desktop MCP docs](https://modelcontextprotocol.io/quickstart/user) for more info.

```json
{
  "mcpServers": {
    "hanzo-mcp": {
      "command": "npx",
      "args": ["-y", "@hanzo/hanzo-mcp"],
      "env": {
        "HANZO_URL": "https://your-hanzo-server.com/api",
        "HANZO_API_KEY": "your-hanzo-api-token"
      }
    }
  }
}
```

### Install in BoltAI

Open the "Settings" page of the app, navigate to "Plugins," and enter the following JSON:

```json
{
  "mcpServers": {
    "hanzo-mcp": {
      "command": "npx",
      "args": ["-y", "@hanzo/hanzo-mcp"],
      "env": {
        "HANZO_URL": "https://your-hanzo-server.com/api",
        "HANZO_API_KEY": "your-hanzo-api-token"
      }
    }
  }
}
```

### Using Docker

The Docker container supports both **stdio** and **HTTP** transport modes, making it flexible for different deployment scenarios.

1.  **Build the Docker Image:**

    ```bash
    git clone https://github.com/Hanzo/mcp.git
    cd hanzo-mcp
    docker build -t hanzo-mcp .
    ```

2.  **Manual Docker Commands:**

    **Stdio Mode (for MCP clients):**

    ```bash
    docker run -it --rm \
      -e HANZO_URL=https://your-hanzo-server.com/api \
      -e HANZO_API_KEY=your_token_here \
      hanzo-mcp
    ```

    **HTTP Mode (for web applications):**

    ```bash
    docker run -it --rm \
      -p 8080:3000 \
      -e MCP_TRANSPORT=http \
      -e HANZO_URL=https://your-hanzo-server.com/api \
      -e HANZO_API_KEY=your_token_here \
      hanzo-mcp
    ```

3.  **Docker Compose:**

    Use the provided `docker-compose.yml` for production deployments:

    ```bash
    # Start HTTP service
    docker-compose up -d hanzo-mcp-http

    # View logs
    docker-compose logs -f hanzo-mcp-http
    ```

4.  **MCP Client Configuration:**

    **For stdio mode (Claude Desktop, VS Code, etc.):**

    ```json
    {
      "mcpServers": {
        "hanzo-mcp": {
          "command": "docker",
          "args": [
            "run",
            "-i",
            "--rm",
            "-e",
            "HANZO_URL=https://your-hanzo-server.com/api",
            "-e",
            "HANZO_API_KEY=your_token_here",
            "hanzo-mcp"
          ]
        }
      }
    }
    ```

    **For HTTP mode (web applications):**

    Start the HTTP server first, then configure your client to connect to `http://localhost:3000/mcp`.

### Install in Windows

The configuration on Windows is slightly different compared to Linux or macOS. Use `cmd` as the command wrapper:

```json
{
  "mcpServers": {
    "hanzo-mcp": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@hanzo/hanzo-mcp"],
      "env": {
        "HANZO_URL": "https://your-hanzo-server.com/api",
        "HANZO_API_KEY": "your-hanzo-api-token"
      }
    }
  }
}
```

### Environment Variables

- `HANZO_URL`: Your Hanzo server API URL (required)
- `HANZO_API_KEY`: Your Hanzo API authentication token (required)

## 🚀 Transport Modes

This MCP server supports multiple transport modes to suit different use cases:

### Stdio Mode (Default)

The default mode uses stdio for direct process communication, ideal for desktop applications and command-line usage.

```bash
# Run with stdio (default)
npx -y @hanzo/hanzo-mcp
# or
npm run start:stdio
```

### HTTP Mode (Streamable HTTP + Legacy SSE)

Modern HTTP mode exposes the server via HTTP/HTTPS supporting **both modern and legacy protocols** for maximum compatibility:

- **Streamable HTTP (MCP 2025-03-26)** - Modern protocol with session management
- **Legacy SSE (MCP 2024-11-05)** - Backwards compatibility for older clients

```bash
# Run with HTTP mode
npm run start:http
# or
npx -y @hanzo/hanzo-mcp --http
# or via environment variable
MCP_TRANSPORT=http npx -y @hanzo/hanzo-mcp
```

**Modern Streamable HTTP Endpoints:**

- **POST /mcp** - Client-to-server requests
- **GET /mcp** - Server-to-client notifications
- **DELETE /mcp** - Session termination
- **GET /health** - Health check endpoint

**Legacy SSE Endpoints (Backwards Compatibility):**

- **GET /sse** - SSE stream initialization
- **POST /messages** - Client message posting

**Configuration:**

- Internal port: `3000` (fixed)
- External port: configurable via `EXTERNAL_PORT` (default: `3000`)
- Supports both modern Streamable HTTP (MCP 2025-03-26) and legacy SSE (MCP 2024-11-05)
- Session management with automatic cleanup for both transport types

**Client Compatibility:**

Modern clients automatically use the Streamable HTTP endpoints, while legacy clients can connect using the SSE endpoints. The server handles both protocols simultaneously, ensuring compatibility with:

- **Modern MCP clients** (Claude Desktop, Cline, etc.) → Use `/mcp` endpoints
- **Legacy MCP clients** → Use `/sse` and `/messages` endpoints
- **Custom integrations** → Choose the appropriate protocol for your needs

For detailed transport mode documentation and client examples, refer to the configuration examples above.

## 📚 Available Tools

This MCP server provides comprehensive tools for Hanzo project, application, and database management through **56 tools** organized into four main categories:

### 🗂️ Project Management (6 tools)

Complete project lifecycle management including creation, updates, duplication, and deletion:

- **`project-all`** - List all projects
- **`project-one`** - Get project details
- **`project-create`** - Create new projects
- **`project-update`** - Update project configurations
- **`project-duplicate`** - Duplicate projects with selective service copying
- **`project-remove`** - Delete projects

### 🚀 Application Management (24 tools)

Comprehensive application lifecycle and configuration management:

#### Core Operations

- **CRUD Operations**: Create, read, update, delete applications
- **Lifecycle Management**: Deploy, redeploy, start, stop, reload applications
- **Utility Operations**: Move between projects, clean queues, refresh tokens

#### Git Provider Integrations

Support for multiple Git providers with specific configurations:

- **GitHub Provider** - Full GitHub integration with webhooks
- **GitLab Provider** - Complete GitLab project integration
- **Bitbucket Provider** - Bitbucket repository management
- **Gitea Provider** - Self-hosted Gitea integration
- **Git Provider** - Custom Git repository support
- **Docker Provider** - Direct Docker image deployment

#### Configuration Management

- **Build Settings** - Configure build types (Dockerfile, Heroku, Nixpacks, etc.)
- **Environment Management** - Environment variables and build arguments
- **Monitoring Integration** - Application monitoring and metrics
- **Traefik Configuration** - Load balancer and reverse proxy settings

### 🐘 PostgreSQL Database Management (13 tools)

Complete PostgreSQL database lifecycle management:

#### Core Database Operations

- **CRUD Operations**: Create, read, update, remove PostgreSQL databases
- **Lifecycle Management**: Deploy, start, stop, reload, rebuild databases
- **Configuration Management**: External ports, environment variables, status changes
- **Project Management**: Move databases between projects

#### Available PostgreSQL Tools

- **`postgres-create`** - Create new PostgreSQL databases
- **`postgres-one`** - Get database details
- **`postgres-update`** - Update database configurations
- **`postgres-remove`** - Delete databases
- **`postgres-deploy`** - Deploy databases
- **`postgres-start`** - Start database instances
- **`postgres-stop`** - Stop database instances
- **`postgres-reload`** - Reload database configurations
- **`postgres-rebuild`** - Rebuild database instances
- **`postgres-move`** - Move databases between projects
- **`postgres-changeStatus`** - Change database status
- **`postgres-saveExternalPort`** - Configure external database ports
- **`postgres-saveEnvironment`** - Manage database environment variables

### 🐬 MySQL Database Management (13 tools)

Complete MySQL database lifecycle management with MySQL-specific features:

#### Core Database Operations

- **CRUD Operations**: Create, read, update, remove MySQL databases
- **Lifecycle Management**: Deploy, start, stop, reload, rebuild databases
- **Configuration Management**: External ports, environment variables, status changes
- **Project Management**: Move databases between projects
- **MySQL-Specific Features**: Root password management, MySQL 8.0 support

#### Available MySQL Tools

- **`mysql-create`** - Create new MySQL databases (includes root password setup)
- **`mysql-one`** - Get database details
- **`mysql-update`** - Update database configurations
- **`mysql-remove`** - Delete databases
- **`mysql-deploy`** - Deploy databases
- **`mysql-start`** - Start database instances
- **`mysql-stop`** - Stop database instances
- **`mysql-reload`** - Reload database configurations
- **`mysql-rebuild`** - Rebuild database instances
- **`mysql-move`** - Move databases between projects
- **`mysql-changeStatus`** - Change database status
- **`mysql-saveExternalPort`** - Configure external database ports
- **`mysql-saveEnvironment`** - Manage database environment variables

For detailed information about each tool, including input schemas, required fields, and usage examples, see **[TOOLS.md](TOOLS.md)**.

### Tool Annotations

All tools include semantic annotations to help MCP clients understand their behavior:

- **Read-Only Tools** (`readOnlyHint: true`): Safe operations that only retrieve data
- **Destructive Tools** (`destructiveHint: true`): Operations that modify or delete resources
- **Creation Tools** (`destructiveHint: false`): Operations that create new resources
- **Idempotent Tools** (`idempotentHint: true`): Operations safe to repeat
- **External API Tools** (`openWorldHint: true`): All tools interact with Hanzo API

## 🏗️ Architecture

The Hanzo MCP Server is built using:

- **`@modelcontextprotocol/sdk`**: For creating the MCP server and defining tools
- **Node.js & TypeScript**: As the underlying runtime and language
- **Stdio Transport**: Communicates with MCP clients over standard input/output (stdio)
- **Hanzo API Integration**: Direct interaction with Hanzo server's REST API
- **Comprehensive Tool Coverage**: Complete implementation of all Hanzo application and project endpoints
- **Robust Error Handling**: Centralized HTTP client with retry logic and structured error responses
- **Schema Validation**: Full Zod-based input validation matching OpenAPI specifications
- **Tool Annotations**: Semantic annotations (readOnlyHint, destructiveHint, etc.) for enhanced MCP client understanding

The server architecture supports:

- **56 Tools** covering all project, application, and database management operations
- **Multiple Database Types** (PostgreSQL and MySQL with full lifecycle management)
- **Multiple Git Providers** (GitHub, GitLab, Bitbucket, Gitea, custom Git)
- **Flexible Configuration** for builds, deployments, and monitoring
- **Type-Safe Operations** with comprehensive TypeScript support

Each tool includes input validation, API integration, and structured response formatting for consistent MCP client interaction.

## 🔧 Development

Clone the project and install dependencies:

```bash
git clone https://github.com/Hanzo/mcp.git
cd hanzo-mcp
npm install
```

Build:

```bash
npm run build
```

### Local Configuration Example

```json
{
  "mcpServers": {
    "hanzo-mcp": {
      "command": "npx",
      "args": ["tsx", "/path/to/hanzo-mcp/src/index.ts"],
      "env": {
        "HANZO_URL": "https://your-hanzo-server.com/api",
        "HANZO_API_KEY": "your-hanzo-api-token"
      }
    }
  }
}
```

### Testing with MCP Inspector

```bash
npx -y @modelcontextprotocol/inspector npx @hanzo/hanzo-mcp
```

### Documentation

- **[TOOLS.md](TOOLS.md)** - Complete tool reference with schemas and examples
- **[CONTRIBUTING.md](CONTRIBUTING.md)** - Contributing guidelines

## 🔧 Troubleshooting

### MCP Client Errors

1. Try adding `@latest` to the package name.

2. Make sure you are using Node v18 or higher to have native fetch support with `npx`.

3. Verify your `HANZO_URL` and `HANZO_API_KEY` environment variables are correctly set.

## 🤝 Contributing

We welcome contributions! If you'd like to contribute to the Hanzo MCP Server, please check out our [Contributing Guide](CONTRIBUTING.md).

## 🆘 Support

If you encounter any issues, have questions, or want to suggest a feature, please [open an issue](https://github.com/Hanzo/mcp/issues) in our GitHub repository.

## 📄 License

This project is licensed under the [Apache License](LICENSE).
