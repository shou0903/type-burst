import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@type-burst/typing-engine": r("./packages/typing-engine/src/index.ts"),
      "@type-burst/game-core": r("./packages/game-core/src/index.ts"),
      "@type-burst/phrase-content": r("./packages/phrase-content/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
  },
});
