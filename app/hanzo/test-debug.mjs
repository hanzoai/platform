import { prepareEnvironmentVariables } from "../../pkg/core/src/utils/docker/utils.js";

const environmentEnv = `
NODE_ENV=development
API_URL=https://api.dev.example.com
REDIS_URL=redis://localhost:6379
DATABASE_NAME=dev_database
SECRET_KEY=env-secret-123
`;

const serviceWithEnvVars = `
NODE_ENV=\${{environment.NODE_ENV}}
API_URL=\${{environment.API_URL}}
SERVICE_PORT=4000
`;

console.log("Service vars string:", JSON.stringify(serviceWithEnvVars));
console.log("Environment vars string:", JSON.stringify(environmentEnv));

const result = prepareEnvironmentVariables(serviceWithEnvVars, "", environmentEnv);
console.log("Result:", result);
