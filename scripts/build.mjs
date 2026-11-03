import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

async function build() {
  await esbuild.build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: 'agentsEye.mjs',
    minify: false,
    keepNames: false,
    banner: {
      js: '#!/usr/bin/env node',
    },
    packages: 'external',
  });

  // Ensure exactly one shebang line at line 1
  let content = fs.readFileSync('agentsEye.mjs', 'utf8');
  const lines = content.split(/\r?\n/);
  while (lines.length > 0 && lines[0].startsWith('#!')) {
    lines.shift();
  }
  content = '#!/usr/bin/env node\n' + lines.join('\n');
  fs.writeFileSync('agentsEye.mjs', content, 'utf8');
  console.log('Build complete: agentsEye.mjs');
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
