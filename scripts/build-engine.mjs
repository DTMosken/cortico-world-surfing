import { build } from 'esbuild';

await build({ entryPoints: ['src/page-engine.ts'], bundle: true, platform: 'node', format: 'esm',
  packages: 'external', outfile: 'dist/page-engine.mjs', target: 'node22' });
