/**
 * 통계를 낼 때 **몇 개를 세는가**.
 *
 * KOSIS는 창원시를 한 행으로 준다. 그 값이 5개 자치구(48121·48123·48125·48127·48129)에
 * 그대로 복제되므로, 시군구 22칸을 그대로 세면 **한 도시가 5표를 갖는다.** 실측(2026-09-04,
 * 실제 레이어 JSON):
 *
 * | 쌍 | 22점 ρ | 18점 ρ |
 * |---|---|---|
 * | 재정자립도 × 빈집 | −0.859 | −0.754 |
 * | 재정자립도 × 화재 | −0.914 | −0.845 |
 * | 빈집 × 화재 | +0.798 | +0.647 |
 *
 * 창원은 세 축 모두에서 끝값이라 하필 계수를 가장 세게 끄는 자리에 5표가 있다. 이상치
 * 판정에서는 방향이 **양쪽으로** 뒤집힌다 — 재정자립도는 중복이 창원 자신을 정상으로
 * 만들고(22점 이상치 없음 → 18점 창원 3.3배), 병상은 반대로 MAD를 무너뜨려 22곳 중
 * 8곳을 이상치로 인쇄한다.
 *
 * ## 왜 「창원을 1점으로」가 아닌가
 *
 * 창원 특수 로직으로 박으면 전국으로 넓힐 때 수원·성남·고양·용인에서 그대로 다시 깨진다.
 * 규칙은 **복제된 축을 값으로 알아본다**: 같은 시에 속한 자치구들이 재는 값까지 전부
 * 같으면 그것은 한 번 측정된 값이 여러 칸에 대입된 것이다. 값이 다르면 구별 자료가
 * 실제로 있다는 뜻이라 접지 않는다.
 *
 * 자치구가 아닌 이름(읍면동·군)은 **절대 접지 않는다.** 진주시의 두 동이 우연히 같은
 * 값을 가질 수는 있고 그 둘은 서로 다른 관측이다.
 */

/**
 * 「…시 …구」일 때만 그 시 이름을 돌린다. 아니면 null.
 *
 * ⚠️ 실제 이름에는 **띄어쓰기가 없다** — 「창원시의창구」·「창원시마산합포구」다. 공백으로
 * 잘라 첫 마디를 쓰면 다섯 구가 서로 다른 시가 되어 접기가 통째로 헛돈다(배포본에서
 * 실제로 그랬다: 접기를 넣었는데도 22줄이 그대로 남았다).
 */
export function districtParentCity(name: string): string | null {
  const bare = name.replace(/^경상남도\s*/, "").trim();
  const withDistrict = bare.match(/^(.+?시)\s*[가-힣]+구$/);
  return withDistrict ? withDistrict[1] : null;
}

export type Replicated<T> = {
  /** 접은 뒤 남은 관측. 접힌 묶음은 첫 구성원을 대표로 쓴다. */
  items: T[];
  /** 대표 → 함께 접힌 칸 수(1이면 안 접힘). */
  sharedCount: Map<T, number>;
  /** 접힌 시 이름들. 화면에 「창원시 5개 구를 1곳으로」라고 적기 위해 필요하다. */
  collapsed: { city: string; count: number }[];
};

/**
 * 같은 시의 자치구들이 **재는 값까지 같을 때만** 한 관측으로 접는다.
 *
 * `values`는 그 관측이 통계에 넣는 모든 축이다. 상관이면 두 축, 이상치면 한 축.
 * 한 축이라도 다르면 접지 않는다 — 그때는 구별 자료가 실재한다.
 */
export function collapseReplicatedDistricts<T>(
  items: readonly T[],
  nameOf: (item: T) => string,
  valuesOf: (item: T) => readonly (number | null)[],
): Replicated<T> {
  const groups = new Map<string, T[]>();
  const out: T[] = [];
  const sharedCount = new Map<T, number>();

  for (const item of items) {
    const city = districtParentCity(nameOf(item));
    if (city === null) {
      out.push(item);
      sharedCount.set(item, 1);
      continue;
    }
    // 값까지 키에 넣는다. 값이 다른 구는 서로 다른 관측이라 각자 남는다.
    const key = `${city}|${valuesOf(item)
      .map((value) => (value == null ? "∅" : String(value)))
      .join("|")}`;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(item);
      sharedCount.set(bucket[0], bucket.length);
      continue;
    }
    groups.set(key, [item]);
    out.push(item);
    sharedCount.set(item, 1);
  }

  const byCity = new Map<string, number>();
  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue;
    const city = districtParentCity(nameOf(bucket[0]));
    if (city) byCity.set(city, Math.max(byCity.get(city) ?? 0, bucket.length));
  }

  return {
    items: out,
    sharedCount,
    collapsed: [...byCity].map(([city, count]) => ({ city, count })),
  };
}

/** 「창원시 5개 구가 같은 값이라 1곳으로 셌습니다」— 접은 게 없으면 null. */
export function describeCollapse(collapsed: readonly { city: string; count: number }[]): string | null {
  if (collapsed.length === 0) return null;
  const parts = collapsed.map((entry) => `${entry.city} ${entry.count}개 구`);
  return `${parts.join(" · ")}는 원자료가 시 단위라 소속 구의 값이 모두 같습니다. 같은 값을 여러 번 세면 그 도시가 계수를 그만큼 더 끌어당기므로 1곳으로 셌습니다.`;
}
