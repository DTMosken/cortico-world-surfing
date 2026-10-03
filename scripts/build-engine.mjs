import { build } from 'esbuild';

await build({ entryPoints: ['src/page-engine.ts'], bundle: true, platform: 'node', format: 'esm',
  packages: 'external', outfile: 'dist/page-engine.mjs', target: 'node22' });
await build({ entryPoints: ['src/console/client.ts'], bundle: true, platform: 'browser', format: 'esm',
  outfile: 'dist/console.js', target: 'es2022', minify: true });
