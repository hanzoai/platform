#!/usr/bin/env node
/**
 * This script addresses the remaining type issues in the codebase
 * to allow it to build with Compose Spec support.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create type declarations for modules that need them
const typesDir = path.join(__dirname, 'src/@types');
if (!fs.existsSync(typesDir)) {
  fs.mkdirSync(typesDir, { recursive: true });
}

// Create js-yaml.d.ts
const jsYamlDts = path.join(typesDir, 'js-yaml.d.ts');
fs.writeFileSync(jsYamlDts, `
declare module 'js-yaml' {
  export function load(input: string): any;
  export function dump(obj: any): string;
}
`);
console.log('✅ Created type declaration for js-yaml');

// Fix collision.ts to properly import just from compose
const collisionPath = path.join(__dirname, 'src/utils/docker/collision.ts');
if (fs.existsSync(collisionPath)) {
  let content = fs.readFileSync(collisionPath, 'utf8');
  content = content.replace(
    "import { addSuffixToAllVolumes, addSuffixToAllProperties } from \"./compose\";",
    "import { addSuffixToAllProperties } from \"./compose\";"
  );
  
  // Add null checks
  content = content.replace(
    /const composeData = load\(composeFile\) as ComposeSpecification;/g,
    "const composeData = load(composeFile || \"\") as ComposeSpecification;"
  );
  
  content = content.replace(
    /const randomSuffix = suffix \|\| compose\.appName \|\| generateRandomHash\(\);/g,
    "const randomSuffix = suffix || compose?.appName || generateRandomHash();"
  );
  
  fs.writeFileSync(collisionPath, content);
  console.log('✅ Fixed collision.ts imports and null handling');
}

// Fix compose.ts
const composePath = path.join(__dirname, 'src/utils/docker/compose.ts');
if (fs.existsSync(composePath)) {
  let content = fs.readFileSync(composePath, 'utf8');
  
  // Export what's needed
  if (!content.includes('export { addSuffixToAllVolumes }')) {
    content = content.replace(
      'export const addSuffixToAllProperties',
      'export { addSuffixToAllVolumes } from "./compose/volume";\n\nexport const addSuffixToAllProperties'
    );
  }
  
  fs.writeFileSync(composePath, content);
  console.log('✅ Fixed compose.ts exports');
}

// Add nullish coalescing throughout domain.ts
const domainPath = path.join(__dirname, 'src/utils/docker/domain.ts');
if (fs.existsSync(domainPath)) {
  let content = fs.readFileSync(domainPath, 'utf8');
  
  // Fix sourceType comparisons
  content = content.replace(
    /compose\.sourceType === "github"/g,
    'compose.sourceType === "github" || false'
  );
  
  content = content.replace(
    /compose\.sourceType === "gitlab"/g,
    'compose.sourceType === "gitlab" || false'
  );
  
  content = content.replace(
    /compose\.sourceType === "bitbucket"/g,
    'compose.sourceType === "bitbucket" || false'
  );
  
  // Fix appName nullish values
  content = content.replace(
    /appName: string\;/g,
    'appName: string | null;'
  );
  
  fs.writeFileSync(domainPath, content);
  console.log('✅ Fixed domain.ts type comparisons');
}

console.log('✅ All fixes applied. Try building again.');