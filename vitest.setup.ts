import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// UI 테스트는 앱 전체를 그리고 부트스트랩 fetch가 끝나기를 기다린다. 그 시간이 기본
// 대기 1초를 넘길 때가 있어(워커들이 CPU를 나눠 쓰면 특히) 로직과 무관한 간헐 실패가
// 났다. 실제로 "compare picker"·"pharmacy query"·"mobile panel toggles"가 돌아가며 깨졌다.
configure({ asyncUtilTimeout: 10_000 });

// server-only throws outside Next server graphs; unit tests import API/server modules.
vi.mock("server-only", () => ({}));

afterEach(() => cleanup());
