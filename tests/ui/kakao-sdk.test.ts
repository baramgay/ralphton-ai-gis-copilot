import { afterEach, describe, expect, test, vi } from "vitest";

import { buildKakaoSdkUrl } from "@/components/copilot/kakao-sdk";

describe("buildKakaoSdkUrl", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.getElementById("kakao-maps-sdk")?.remove();
    document.querySelectorAll("script[data-kakao-maps-sdk]").forEach((script) => script.remove());
  });

  test("loads Kakao Maps core without libraries (avoids hung library chain)", () => {
    const url = new URL(buildKakaoSdkUrl("public app key"));

    expect(url.origin).toBe("https://dapi.kakao.com");
    expect(url.pathname).toBe("/v2/maps/sdk.js");
    expect(url.searchParams.get("appkey")).toBe("public app key");
    expect(url.searchParams.get("autoload")).toBe("false");
    // libraries=services,clusterer hung at readyState=1 in prod — omit by default
    expect(url.searchParams.get("libraries")).toBeNull();
  });

  test("exports dedicated clusterer CDN URL for 2-stage load", async () => {
    const { KAKAO_CLUSTERER_URL } = await import("@/components/copilot/kakao-sdk");
    expect(KAKAO_CLUSTERER_URL).toContain("clusterer");
    expect(KAKAO_CLUSTERER_URL).toContain("t1.daumcdn.net");
  });

  test("rejects when the SDK never finishes loading", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { loadKakaoSdk, resetKakaoSdkCache } = await import("@/components/copilot/kakao-sdk");
    resetKakaoSdkCache();

    // Script will never fire load in this test environment.
    const rejection = expect(loadKakaoSdk("public-app-key")).rejects.toThrow(
      /Kakao Maps SDK 로드 시간 초과|스크립트 로드 실패/,
    );

    await vi.advanceTimersByTimeAsync(13_000);
    await rejection;
  }, 15_000);
});
