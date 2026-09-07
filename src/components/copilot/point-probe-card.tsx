"use client";

import { useState } from "react";

import type { RadiusProbe } from "@/lib/gis/point-probe";

/**
 * 찍은 지점의 둘레를 읽어 주는 카드.
 *
 * ## 여기 없는 것이 설계다
 *
 * 「반경 2km 안 생활인구 3만 8천 명」 같은 큰 숫자가 없다. 인구·소비는 행정동 단위라
 * 원이 동을 자르면 면적 비례 배분을 가정해야 하는데, 산이 절반인 읍에서 그 가정은
 * 사람을 산에 올려놓는다. 대신 **걸치는 동을 이름으로** 보여 주고, 현재 분석이
 * 있으면 그 동의 분석 값을 **조회만** 해서 함께 보여 준다(합산·분할 없음).
 * 격자는 중심점이 원 안에 든 칸의 값을 그대로 보여 준다(칸을 자르지 않는다).
 */

const KM = (value: number) => (value < 1 ? `${Math.round(value * 1000)}m` : `${value.toFixed(1)}km`);

export type ProbeRegionValue = {
  code: string;
  name: string;
  /** 현재 분석의 그 지역 값(순위표와 같은 문장). */
  text: string;
};

export type ProbeGridValue = {
  code: string;
  /** 현재 지표의 그 칸 값. 칸 코드는 내부 값이라 화면에 내지 않는다. */
  text: string;
  distanceKm: number;
};

type Props = {
  probe: RadiusProbe;
  radiusKm: number;
  onRadiusChange: (radiusKm: number) => void;
  onClose: () => void;
  /** 지금 보고 있는 분석 제목. 없으면 분석 연동을 쉬고 정직하게 말한다. */
  analysisTitle?: string | null;
  /** 걸치는 동 × 현재 분석값(조회만, 8곳까지). */
  regionValues?: readonly ProbeRegionValue[];
  /** 격자 모드일 때의 지표 라벨. 있으면 격자 섹션만 낸다. */
  gridLabel?: string | null;
  /** 원 안에 든 격자 칸의 값(가까운 8칸까지). */
  gridValues?: readonly ProbeGridValue[];
  gridTotal?: number;
};

const MAX_LISTED_REGIONS = 8;

export function PointProbeCard({
  probe,
  radiusKm,
  onRadiusChange,
  onClose,
  analysisTitle = null,
  regionValues = [],
  gridLabel = null,
  gridValues = [],
  gridTotal = 0,
}: Props) {
  const total = probe.byType.reduce((sum, entry) => sum + entry.count, 0);
  /*
   * 좁은 화면에서 이 카드는 세로 314px을 차지한다 — 727px 기기에서 지도에 남는 자리가
   * 173px(24%)뿐이었다(배포본 실측). 한 곳을 찍고 나면 **다른 곳을 찍을 자리가 없다.**
   * 이 도구의 쓰임새가 "여기, 그리고 저기"인데 그 두 번째를 못 한다.
   *
   * 그래서 접을 수 있게 한다. 접으면 한 줄만 남아 지도가 61%까지 돌아오고, 접은 채로
   * 여기저기 눌러 가며 동 이름과 시설 수만 훑을 수 있다. 접힘은 카드가 살아 있는 동안
   * 유지되므로 찍을 때마다 다시 접지 않아도 된다.
   */
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section
      className={collapsed ? "probe-card is-collapsed" : "probe-card"}
      data-testid="probe-card"
      data-collapsed={collapsed ? "yes" : "no"}
      aria-label="지점 분석 결과"
    >
      <header className="probe-card-head">
        <div className="min-w-0">
          <p className="ui-caption font-bold">
            지점 분석
            {collapsed ? ` · 반경 ${radiusKm}km 시설 ${total}곳` : ""}
          </p>
          <p className="truncate ui-body font-bold" data-testid="probe-region">
            {probe.containing ? probe.containing.name.replace("경상남도 ", "") : "경상남도 경계 밖"}
          </p>
          {collapsed ? null : (
            <p className="ui-caption">
              {probe.point.lat.toFixed(5)}, {probe.point.lng.toFixed(5)}
            </p>
          )}
          {/*
            "어느 동인가"에 대한 단서는 접힌 각주에 두면 안 된다. 카드 얼굴에 적힌 동
            이름 바로 밑에 있어야 그 이름을 읽는 사람이 같이 본다.
          */}
          {probe.boundaryEdgeKm != null && probe.boundaryEdgeKm <= 0.1 ? (
            <p className="probe-edge-warn" data-testid="probe-edge-warn">
              경계에서 {Math.round(probe.boundaryEdgeKm * 1000)}m · 이웃 동으로 볼 수도 있음
            </p>
          ) : null}
        </div>
        <div className="probe-head-actions">
          <button
            type="button"
            className="probe-close"
            data-testid="probe-collapse"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "지점 분석 펼치기" : "지점 분석 접기"}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? "▴" : "▾"}
          </button>
          <button type="button" className="probe-close" onClick={onClose} aria-label="지점 분석 닫기">
            ✕
          </button>
        </div>
      </header>

      {collapsed ? null : (
      <>
      <div className="probe-radius" role="group" aria-label="반경 선택">
        {[1, 2, 3].map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={radiusKm === value}
            className={radiusKm === value ? "probe-radius-on" : "probe-radius-off"}
            onClick={() => onRadiusChange(value)}
          >
            {value}km
          </button>
        ))}
      </div>

      <div className="probe-section" data-testid="probe-analysis">
        {gridLabel != null ? (
          <>
            <p className="ui-caption font-bold">
              반경 {radiusKm}km 안 격자 {gridTotal.toLocaleString("ko-KR")}칸 · {gridLabel}
            </p>
            {gridValues.length === 0 ? (
              <p className="ui-body">둘레 안에 {gridLabel} 값이 있는 칸이 없습니다.</p>
            ) : (
              <ul className="probe-regions">
                {gridValues.map((cell) => (
                  <li key={cell.code}>
                    <span className="truncate">{cell.text}</span>
                    <span className="probe-region-distance">중심 {KM(cell.distanceKm)}</span>
                  </li>
                ))}
              </ul>
            )}
            {gridTotal > gridValues.length ? (
              <p className="ui-caption">외 {gridTotal - gridValues.length}칸</p>
            ) : null}
          </>
        ) : analysisTitle == null ? (
          <>
            <p className="ui-caption font-bold">둘레 안 분석 값</p>
            <p className="ui-body">
              질문이나 지표 선택으로 분석을 먼저 실행하면, 걸치는 동의 값을 여기서 보여 드립니다.
            </p>
          </>
        ) : (
          <>
            <p className="ui-caption font-bold">
              둘레 안 분석 값 · {analysisTitle}
            </p>
            {regionValues.length === 0 ? (
              <p className="ui-body">걸치는 동에 현재 분석 값이 없습니다.</p>
            ) : (
              <ul className="probe-regions">
                {regionValues.map((entry) => (
                  <li key={entry.code}>
                    <span className="truncate">{entry.name}</span>
                    <span className="probe-region-distance">{entry.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="probe-section">
        <p className="ui-caption font-bold">
          걸치는 행정동 {probe.regions.length}곳
        </p>
        <ul className="probe-regions" data-testid="probe-regions">
          {probe.regions.slice(0, MAX_LISTED_REGIONS).map((region) => (
            <li key={region.code}>
              <span className="truncate">{region.name.replace("경상남도 ", "")}</span>
              <span className="probe-region-distance">
                {region.contains ? "지점 포함" : KM(region.distanceKm)}
              </span>
            </li>
          ))}
        </ul>
        {probe.regions.length > MAX_LISTED_REGIONS ? (
          <p className="ui-caption">외 {probe.regions.length - MAX_LISTED_REGIONS}곳</p>
        ) : null}
      </div>

      <div className="probe-section">
        <p className="ui-caption font-bold">반경 {radiusKm}km 안 의료시설</p>
        {total === 0 ? (
          <p className="ui-body" data-testid="probe-facility-empty">
            {/*
              "없습니다"로 끝내면 5.1km에 병원이 있는 곳과 40km에 있는 곳이 같은 답을 받는다.
              그 둘은 전혀 다른 상황이라, 없을 때일수록 가장 가까운 곳을 말해야 한다.
            */}
            없음 ·{" "}
            {probe.nearest
              ? `가장 가까운 곳은 ${probe.nearest.name} ${KM(probe.nearest.distanceKm)}`
              : "시설 자료가 비어 있음"}
          </p>
        ) : (
          <>
            <p className="ui-body font-bold" data-testid="probe-facility-total">
              {total.toLocaleString("ko-KR")}곳
            </p>
            <div className="probe-chips">
              {probe.byType.map((entry) => (
                <span key={entry.type} className="probe-chip">
                  {entry.type} {entry.count}
                </span>
              ))}
            </div>
            {probe.nearest ? (
              <p className="ui-caption">
                최근접 {probe.nearest.name} · {KM(probe.nearest.distanceKm)}
              </p>
            ) : null}
          </>
        )}
      </div>

      <details className="ui-details probe-notes">
        <summary>이 결과의 한계</summary>
        <div className="ui-details-body space-y-1.5">
          {probe.notes.map((note) => (
            <p key={note} className="ui-caption">
              · {note}
            </p>
          ))}
        </div>
      </details>
      </>
      )}
    </section>
  );
}
