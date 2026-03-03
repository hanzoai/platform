const { parse } = require("dotenv");

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

const environmentVars = parse(environmentEnv);
const serviceVars = parse(serviceWithEnvVars);

console.log("Environment vars:", environmentVars);
console.log("\nService vars:", serviceVars);

// Now simulate the resolveValue function
const resolveValue = (value) => {
  let resolvedValue = value;
  
  resolvedValue = resolvedValue.replace(
    /\$\{\{environment\.(.*?)\}\}/g,
    (_, ref) => {
      console.log(`  Replacing environment.${ref}`);
      if (environmentVars && environmentVars[ref] !== undefined) {
        console.log(`    Found: ${environmentVars[ref]}`);
        return environmentVars[ref];
      }
      throw new Error(`Invalid environment variable: environment.${ref}`);
    }
  );
  
  return resolvedValue;
};

console.log("\nResolving SERVICE_PORT:", resolveValue(serviceVars.SERVICE_PORT));
console.log("Resolving NODE_ENV:", resolveValue(serviceVars.NODE_ENV));
console.log("Resolving API_URL:", resolveValue(serviceVars.API_URL));
