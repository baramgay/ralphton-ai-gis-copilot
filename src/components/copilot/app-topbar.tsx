"use client";

import { dataModeLabel, dataModeTitle } from "@/lib/analysis/data-mode";

import type { AnalysisSnapshot } from "./types";

/**
 * 늘 보이는 상단 바.
 *
 * 예전에는 이 markup이 로딩 게이트 **안쪽**에만 있었다. 그래서 스냅샷(1.6MB)과 경계
 * (2.3MB)가 다 도착해 첫 렌더가 끝날 때까지 화면에는 제품 이름조차 없었다 — 실측으로
 * 첫 픽셀이 0.5초, 제목이 1.9초였다. 그 1.4초 동안 사용자가 본 것은 어느 사이트인지도
 * 알 수 없는 회색 상자 하나다.
 *
 * 상단 바가 필요로 하는 것은 스냅샷의 **요약 몇 줄**뿐이고, 제품 정체성은 아무것도
 * 필요로 하지 않는다. 그래서 컴포넌트로 빼서 로딩 화면과 본 화면이 같은 것을 쓰게 한다
 * (따로 적으면 갈라진다 — 이 h1은 한 번 패널 안으로 들어갔다가 접근성 트리에서 사라진
 * 전력이 있다).
 *
 * `snapshot`이 없으면 기준월·건수·데이터 모드 자리를 **비워 두지 않고 준비 중이라고
 * 적는다**. 모르는 값을 그럴듯한 값으로 채우면 시연 데이터를 실데이터로 읽게 된다.
 */
export function AppTopbar({
  snapshot,
  onOpenTab,
}: {
  snapshot: AnalysisSnapshot | null;
  onOpenTab?: (tab: "help" | "data") => void;
}) {
  return (
    <header className="copilot-topbar">
      <img
        src="/brand-mark.svg"
        alt=""
        width={28}
        height={28}
        className="size-7 shrink-0 rounded-lg shadow-sm ring-1 ring-slate-200/80"
      />
      <div className="min-w-0">
        <h1 className="ui-body-lg truncate font-black text-slate-950">누리맵</h1>
      </div>
      {snapshot ? (
        <p className="copilot-topbar-meta ui-caption truncate text-slate-500">
          {dataModeLabel(snapshot.mode, snapshot.sourceNotes)} · {snapshot.referenceMonth} ·{" "}
          {snapshot.regions.length.toLocaleString("ko-KR")}개 읍면동
        </p>
      ) : (
        <p
          className="copilot-topbar-meta ui-caption truncate text-slate-500"
          data-testid="topbar-loading-meta"
        >
          경남 공간 데이터를 준비하는 중…
        </p>
      )}
      {/*
        이용법·데이터 출처는 접힌 조작 패널 안에만 있어서, 처음 온 사람이 출처를 보려면
        "조작"을 먼저 눌러야 했다. 공공기관 자료로 쓰는 도구에서 출처는 한 번에 닿아야
        한다. 눌러 두 단계를 한 번에 처리한다(패널 열기 + 해당 탭 선택).

        아직 열 패널이 없는 로딩 화면에서는 버튼을 내보내지 않는다. 눌러도 아무 일이
        일어나지 않는 버튼은 고장으로 읽힌다.
      */}
      {onOpenTab ? (
        <nav className="ml-auto flex items-center gap-1" aria-label="도움말·데이터">
          {(
            [
              ["help", "이용"],
              ["data", "데이터"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="copilot-topbar-link"
              onClick={() => onOpenTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      ) : null}
      {snapshot ? (
        <span
          className={`ui-status ${snapshot.mode === "live" ? "ui-status-live" : "ui-status-demo"}`}
          title={dataModeTitle(snapshot.mode, snapshot.sourceNotes)}
        >
          {dataModeLabel(snapshot.mode, snapshot.sourceNotes)}
        </span>
      ) : null}
    </header>
  );
}
