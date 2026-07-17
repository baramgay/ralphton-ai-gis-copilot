import { afterEach, describe, expect, test, vi } from "vitest";

import { buildKakaoSdkUrl } from "@/components/copilot/kakao-sdk";

describe("buildKakaoSdkUrl", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll("script[data-kakao-maps-sdk]").forEach((script) => script.remove());
  });

  test("loads Kakao Maps manually with all required libraries", () => {
    const url = new URL(buildKakaoSdkUrl("public app key"));

    expect(url.origin).toBe("https://dapi.kakao.com");
    expect(url.pathname).toBe("/v2/maps/sdk.js");
    expect(url.searchParams.get("appkey")).toBe("public app key");
    expect(url.searchParams.get("autoload")).toBe("false");
    expect(url.searchParams.get("libraries")).toBe("services,clusterer,drawing");
  });

  test("rejects when the SDK never finishes loading", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { loadKakaoSdk } = await import("@/components/copilot/kakao-sdk");

    const rejection = expect(loadKakaoSdk("public-app-key")).rejects.toThrow(
      "Kakao Maps SDK 로드 시간 초과",
    );

    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
  });
});
