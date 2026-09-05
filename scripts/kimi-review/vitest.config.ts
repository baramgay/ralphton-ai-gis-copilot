import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// 의뢰자가 vitest.config.ts의 include를 tests/**로 좁혔으므로, 검증 스크래치는
// 이 설정으로 돌린다: npx vitest run --config scripts/kimi-review/vitest.config.ts
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["scripts/kimi-review/*.test.ts"],
    testTimeout: 120_000,
  },
});
