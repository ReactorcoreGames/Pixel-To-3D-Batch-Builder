import { defineConfig } from 'vitest/config';

// The app lives in index.html at the project root.
// The desktop app (src-tauri/) loads the dev server at a fixed port, so it must not move to another one.
export default defineConfig({
  base: './',
  clearScreen: false,
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  build: { target: 'es2022', outDir: 'dist' },
  test: { include: ['tests/**/*.test.ts'] },
});
