#!/bin/bash
# Test script for Hanzo Platform MCP integration

echo "🚀 Hanzo Platform Local Setup & MCP Test"
echo "========================================"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check prerequisites
check_command() {
    if ! command -v $1 &> /dev/null; then
        echo -e "${RED}❌ $1 is not installed${NC}"
        exit 1
    else
        echo -e "${GREEN}✓ $1 is installed${NC}"
    fi
}

echo -e "\n${YELLOW}Checking prerequisites...${NC}"
check_command docker
check_command node
check_command pnpm

# Start Platform
echo -e "\n${YELLOW}Starting Hanzo Platform...${NC}"
docker compose -f docker-compose.dev.yml up -d postgres redis

# Wait for services
echo -e "\n${YELLOW}Waiting for services to be ready...${NC}"
sleep 10

# Run platform in background
echo -e "\n${YELLOW}Starting platform development server...${NC}"
docker compose -f docker-compose.dev.yml up -d platform-dev

echo -e "\n${YELLOW}Waiting for platform to initialize (this may take a few minutes)...${NC}"
# Wait for platform to be ready
for i in {1..60}; do
    if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
        echo -e "\n${GREEN}✓ Platform is ready!${NC}"
        break
    fi
    echo -n "."
    sleep 5
done

# Get API key (mock for now)
echo -e "\n${YELLOW}Platform is running at: ${GREEN}http://localhost:3000${NC}"
echo -e "${YELLOW}Default credentials:${NC}"
echo -e "  Email: ${GREEN}admin@localhost${NC}"
echo -e "  Password: ${GREEN}admin${NC}"

# Test platform-mcp
echo -e "\n${YELLOW}Testing platform-mcp connection...${NC}"
cd ../platform-mcp

# Create test script
cat > test-connection.js << 'EOF'
const { exec } = require('child_process');
const path = require('path');

console.log('Testing Hanzo Platform MCP connection...\n');

const env = {
    ...process.env,
    PLATFORM_URL: 'http://localhost:3000',
    PLATFORM_API_KEY: 'test-key' // You'll need to get this from the UI
};

// Test stdio transport
const mcpPath = path.join(__dirname, 'dist', 'index.js');
const child = exec(`node ${mcpPath}`, { env }, (error, stdout, stderr) => {
    if (error) {
        console.error('Error:', error);
        return;
    }
    console.log('stdout:', stdout);
    if (stderr) console.error('stderr:', stderr);
});

// Send a test command
child.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/list',
    id: 1
}) + '\n');

setTimeout(() => {
    child.kill();
    console.log('\nTest complete. Check output above.');
}, 2000);
EOF

npm run build
node test-connection.js

echo -e "\n${GREEN}Setup complete!${NC}"
echo -e "\n${YELLOW}Next steps:${NC}"
echo "1. Visit http://localhost:3000 and login"
echo "2. Create a new API key in the platform settings"
echo "3. Update PLATFORM_API_KEY in your platform-mcp config"
echo "4. Configure platform-mcp in Claude Desktop:"
echo ""
cat << 'EOF'
{
  "mcpServers": {
    "platform": {
      "command": "node",
      "args": ["/Users/z/work/hanzo/platform-mcp/dist/index.js"],
      "env": {
        "PLATFORM_URL": "http://localhost:3000",
        "PLATFORM_API_KEY": "your-api-key-here"
      }
    }
  }
}
EOF

echo -e "\n${YELLOW}To stop the platform:${NC}"
echo "  docker compose -f docker-compose.dev.yml down"

echo -e "\n${YELLOW}To view logs:${NC}"
echo "  docker compose -f docker-compose.dev.yml logs -f platform-dev"