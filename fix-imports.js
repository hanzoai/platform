#!/usr/bin/env node

// Simple script to fix all import paths in dist folder
const fs = require('fs');
const path = require('path');

function fixImports(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });

  for (const file of files) {
    const fullPath = path.join(dir, file.name);

    if (file.isDirectory()) {
      fixImports(fullPath);
    } else if (file.name.endsWith('.js')) {
      let content = fs.readFileSync(fullPath, 'utf8');

      // Fix imports to add .js extension if missing
      content = content.replace(/from ["'](\.[^"']+)["']/g, (match, p1) => {
        if (!p1.endsWith('.js') && !p1.endsWith('.json')) {
          // Check if it's a directory with index.js
          const importPath = path.resolve(path.dirname(fullPath), p1);
          try {
            if (fs.statSync(importPath).isDirectory()) {
              return `from "${p1}/index.js"`;
            }
          } catch {}
          return `from "${p1}.js"`;
        }
        return match;
      });

      // Fix specific broken paths
      content = content.replace(/from "\.\.\/\.\.\/constants/g, 'from "../constants/index');
      content = content.replace(/from "\.\.\/\.\.\/db/g, 'from "../db');
      content = content.replace(/from "\.\.\/\.\.\/services/g, 'from "../services');
      content = content.replace(/from "\.\.\/\.\.\/utils/g, 'from "../utils');
      content = content.replace(/from "\.\.\/verification\//g, 'from "./');
      content = content.replace(/from "\.\.\/wss\//g, 'from "../utils/wss/');

      fs.writeFileSync(fullPath, content);
    }
  }
}

fixImports('/home/z/platform/pkg/paas/dist');
console.log('Fixed imports in dist folder');