const { parse } = require("dotenv");

const serviceWithEnvVars = `
NODE_ENV=\${{environment.NODE_ENV}}
API_URL=\${{environment.API_URL}}
SERVICE_PORT=4000
`;

console.log("Input string:");
console.log(serviceWithEnvVars);
console.log("\nParsed:");
console.log(parse(serviceWithEnvVars));

// Test the regex
const testStr = "${{environment.NODE_ENV}}";
const regex = /\$\{\{environment\.(.*?)\}\}/g;
console.log("\nTest string:", testStr);
console.log("Regex match:", testStr.match(regex));
console.log("Replace test:", testStr.replace(regex, (_, ref) => {
  console.log("  Found ref:", ref);
  return "REPLACED";
}));
