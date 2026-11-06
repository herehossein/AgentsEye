import esbuild from 'esbuild';
import fs from 'node:fs';

async function build() {
  // SSOT Quality Gate: Verify package.json version matches src/config/constants.ts TOOL_VERSION
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const constantsContent = fs.readFileSync('src/config/constants.ts', 'utf8');
  const match = constantsContent.match(/export const TOOL_VERSION = ['"]([^'"]+)['"]/);

  if (!match || match[1] !== pkg.version) {
    console.error(
      `[BUILD ERROR] SSOT version mismatch: package.json version is "${pkg.version}" but src/config/constants.ts TOOL_VERSION is "${match?.[1]}"`
    );
    process.exit(1);
  }

  const outfile = 'dist/agentsEye.mjs';
  await esbuild.build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile,
    minify: false,
    keepNames: false,
    banner: {
      js: '#!/usr/bin/env node',
    },
    packages: 'external',
  });

  // Ensure exactly one shebang line at line 1
  let content = fs.readFileSync(outfile, 'utf8');
  const lines = content.split(/\r?\n/);
  while (lines.length > 0 && lines[0].startsWith('#!')) {
    lines.shift();
  }
  content = '#!/usr/bin/env node\n' + lines.join('\n');
  fs.writeFileSync(outfile, content, 'utf8');
  console.log(`Build complete: ${outfile}`);
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
