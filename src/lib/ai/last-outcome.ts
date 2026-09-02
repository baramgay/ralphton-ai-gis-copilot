/**
 * 마지막 AI 파싱 시도의 결과를 이 서버 인스턴스가 기억한다.
 *
 * 설정 검사만으로는 "붙을 수 있게 생겼다"까지밖에 못 본다. 키가 맞는지, 잔액이 있는지,
 * 상대가 살아 있는지는 실제로 걸어 봐야 안다 — 그리고 그 실패를 조용히 삼키던 동안
 * 운영에서 AI 파서가 한 번도 동작하지 않았는데 상태표는 켜짐이었다.
 *
 * 상태 확인 때마다 시험 호출을 하면 그것대로 돈이 든다. 그래서 시험하지 않고, 사용자가
 * 이미 일으킨 호출의 결과를 적어 둔다. 인스턴스가 새로 뜨면 비어 있고(아직 모름),
 * 그것도 사실대로 적는다.
 */
import type { LlmFailureCode } from "./llm";

export type AiLastOutcome =
  | { state: "unknown" }
  | { state: "ok"; at: string }
  | { state: "failed"; at: string; code: LlmFailureCode };

let lastOutcome: AiLastOutcome = { state: "unknown" };

export function recordAiSuccess(now: () => Date = () => new Date()): void {
  lastOutcome = { state: "ok", at: now().toISOString() };
}

export function recordAiFailure(
  code: LlmFailureCode,
  now: () => Date = () => new Date(),
): void {
  lastOutcome = { state: "failed", at: now().toISOString(), code };
}

export function readAiLastOutcome(): AiLastOutcome {
  return lastOutcome;
}

/** 테스트 전용. 인스턴스 기억을 지운다. */
export function resetAiLastOutcome(): void {
  lastOutcome = { state: "unknown" };
}
