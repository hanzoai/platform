import { prepareEnvironmentVariables } from "./pkg/core/src/index.ts";

const environmentEnv = `
NODE_ENV=development
API_URL=https://api.dev.example.com
REDIS_URL=redis://localhost:6379
DATABASE_NAME=dev_database
SECRET_KEY=env-secret-123
`;

const serviceWithEnvVars = `
NODE_ENV=${{environment.NODE_ENV}}
API_URL=${{environment.API_URL}}
SERVICE_PORT=4000
`;

const result = prepareEnvironmentVariables(serviceWithEnvVars, "", environmentEnv);
console.log("Result:", JSON.stringify(result, null, 2));
console.log("Expected:", JSON.stringify([
  "NODE_ENV=development",
  "API_URL=https://api.dev.example.com", 
  "SERVICE_PORT=4000"
], null, 2));
