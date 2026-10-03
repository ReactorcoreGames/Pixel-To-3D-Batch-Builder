import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';

// The command-line tool: one Node file, cli/p3d.mjs, with every dependency bundled in.
// `npm run cli:build`, then `node cli/p3d.mjs --help`.

/** manifold's WASM as a base64 string (`virtual:manifold-wasm`), so the tool needs no file beside it. */
function manifoldWasm(): Plugin {
  const id = 'virtual:manifold-wasm';
  return {
    name: 'manifold-wasm',
    resolveId: s => (s === id ? '\0' + id : null),
    load(s) {
      if (s !== '\0' + id) return null;
      const file = createRequire(import.meta.url).resolve('manifold-3d/manifold.wasm');
      return `export default ${JSON.stringify(readFileSync(file).toString('base64'))};`;
    },
  };
}

export default defineConfig({
  plugins: [manifoldWasm()],
  publicDir: false,
  build: {
    ssr: 'src/cli/bin.ts',
    outDir: 'cli',
    emptyOutDir: false,
    target: 'node20',
    minify: false,
    rollupOptions: { output: { entryFileNames: 'p3d.mjs', format: 'es', codeSplitting: false } },
  },
  ssr: { noExternal: true, target: 'node' },
});
