#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('Finding all conflicting exports...');

// Find all export statements in pkg/core/src
const findAllExports = () => {
  const exports = {};
  
  const scanFile = (filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative('pkg/core/src', filePath);
    
    // Match export const/function/async function
    const matches = content.matchAll(/export\s+(const|function|async\s+function)\s+(\w+)/g);
    for (const match of matches) {
      const exportName = match[2];
      if (!exports[exportName]) {
        exports[exportName] = [];
      }
      exports[exportName].push(relativePath);
    }
  };
  
  const scanDir = (dir) => {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
        scanDir(fullPath);
      } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
        scanFile(fullPath);
      }
    }
  };
  
  scanDir('pkg/core/src');
  
  // Find conflicts
  const conflicts = {};
  for (const [name, files] of Object.entries(exports)) {
    if (files.length > 1) {
      conflicts[name] = files;
    }
  }
  
  return conflicts;
};

// Check which files are exported from index.ts
const checkIndexExports = () => {
  const indexPath = 'pkg/core/src/index.ts';
  const content = fs.readFileSync(indexPath, 'utf8');
  
  const exportedFiles = new Set();
  
  // Match export * from statements
  const starMatches = content.matchAll(/export\s+\*\s+from\s+["']\.\/([^"']+)["']/g);
  for (const match of starMatches) {
    exportedFiles.add(match[1] + '.ts');
  }
  
  // Match export { ... } from statements
  const namedMatches = content.matchAll(/export\s+\{[^}]+\}\s+from\s+["']\.\/([^"']+)["']/g);
  for (const match of namedMatches) {
    exportedFiles.add(match[1] + '.ts');
  }
  
  return exportedFiles;
};

// Main
const conflicts = findAllExports();
const exportedFromIndex = checkIndexExports();

console.log(`Found ${Object.keys(conflicts).length} conflicting exports:\n`);

const toRemove = [];

for (const [name, files] of Object.entries(conflicts)) {
  console.log(`${name}:`);
  
  // Determine which one to keep
  let keepFile = null;
  let removeFiles = [];
  
  // Priority:
  // 1. Keep the one in a file that's directly exported from index
  // 2. Keep the one NOT in settings.ts (as those are stubs)
  // 3. Keep the one in utils over services
  
  for (const file of files) {
    if (file === 'services/settings.ts') {
      removeFiles.push(file);
    } else if (!keepFile) {
      keepFile = file;
    } else {
      // We have multiple non-stub files
      // Prefer utils over services
      if (file.includes('utils/') && !keepFile.includes('utils/')) {
        removeFiles.push(keepFile);
        keepFile = file;
      } else {
        removeFiles.push(file);
      }
    }
  }
  
  console.log(`  Keep: ${keepFile}`);
  console.log(`  Remove from: ${removeFiles.join(', ')}`);
  
  for (const file of removeFiles) {
    toRemove.push({ file, exportName: name });
  }
}

// Remove the conflicting exports
console.log('\nRemoving conflicting exports...');

const fileUpdates = {};

for (const { file, exportName } of toRemove) {
  if (!fileUpdates[file]) {
    fileUpdates[file] = [];
  }
  fileUpdates[file].push(exportName);
}

for (const [file, exportsToRemove] of Object.entries(fileUpdates)) {
  const filePath = path.join('pkg/core/src', file);
  let content = fs.readFileSync(filePath, 'utf8');
  
  for (const exportName of exportsToRemove) {
    // Remove export statements for this name
    const patterns = [
      new RegExp(`export const ${exportName} = async \\([^)]*\\) => \\{[^}]*\\};\\n?`, 'g'),
      new RegExp(`export const ${exportName} = \\([^)]*\\) => \\{[^}]*\\};\\n?`, 'g'),
      new RegExp(`export function ${exportName}\\([^)]*\\)\\s*\\{[^}]*\\}\\n?`, 'g'),
      new RegExp(`export async function ${exportName}\\([^)]*\\)\\s*\\{[^}]*\\}\\n?`, 'g'),
      // For one-liner arrow functions
      new RegExp(`export const ${exportName} = async \\([^)]*\\) => \\{ console\\.log\\('[^']*'\\); return [^;]*; \\};\\n?`, 'g')
    ];
    
    for (const pattern of patterns) {
      const before = content.length;
      content = content.replace(pattern, '');
      if (content.length !== before) {
        console.log(`  Removed ${exportName} from ${file}`);
        break;
      }
    }
  }
  
  fs.writeFileSync(filePath, content);
}

console.log('\nDone! Conflicting exports have been resolved.');