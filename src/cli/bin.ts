/* The bundled command-line tool's entry (`npm run cli:build` → `cli/p3d.mjs`). It carries manifold's WASM inside the
   one file (vite.cli.config.ts), so the tool needs nothing beside it but `presets/`, and even that has a built-in copy. */

import wasm from 'virtual:manifold-wasm';
import { main } from './p3d';

process.exitCode = await main(process.argv.slice(2), { wasmBinary: Buffer.from(wasm, 'base64') });
