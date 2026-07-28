import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: r("index.html"),
        typingSpeedTest: r("tools/typing-speed-test.html"),
        weakKeyPractice: r("tools/weak-key-practice.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@type-burst/typing-engine": r("../../packages/typing-engine/src/index.ts"),
      "@type-burst/game-core": r("../../packages/game-core/src/index.ts"),
      "@type-burst/phrase-content": r("../../packages/phrase-content/src/index.ts"),
      "@type-burst/progression": r("../../packages/progression/src/index.ts"),
    },
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: false,
  },
});
