import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    /*
     * 계약 검사는 `tests/`에만 있다.
     *
     * 이것을 적어 두지 않으면 vitest가 저장소 전체에서 `*.test.ts`를 주워 온다.
     * `scripts/kimi-review/`의 외부 검증용 실측 스크립트가 그렇게 딸려 들어와,
     * **일부러 붉게 만든 재현 검사**와 85초짜리 전수 대조가 기본 게이트를 무너뜨렸다.
     * 그 스크립트들은 결함을 드러내는 것이 일이라 붉은 것이 정상이고, 게이트가 아니다.
     *
     * 돌릴 때는 이름을 대고 돌린다: `npx vitest run scripts/kimi-review/1-correlation.test.ts`
     */
    include: ["tests/**/*.test.{ts,tsx}"],
    // 대기 상한(10초)보다 넉넉해야 대기가 끝나기 전에 테스트가 먼저 죽지 않는다.
    testTimeout: 20_000,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/tests/e2e/**",
      "**/.{idea,git,cache,output,temp}/**",
    ],
  },
});
