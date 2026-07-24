export function filterGyeongnam(features) {
  return features.filter((f) => String(f.properties.adm_cd2).startsWith("48"));
}

export function listSggFromDong(features) {
  const map = new Map();
  for (const f of features) {
    const { sgg, sggnm } = f.properties;
    if (!map.has(sgg)) map.set(sgg, { code: sgg, name: sggnm });
  }
  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
}
