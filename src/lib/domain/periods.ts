export function selectLatestCommonMonth(monthArrays: string[][]): string | null {
  if (monthArrays.length === 0) {
    return null;
  }

  const [first, ...rest] = monthArrays;
  const common = first.filter((month) => rest.every((array) => array.includes(month)));

  if (common.length === 0) {
    return null;
  }

  return common.sort().at(-1) ?? null;
}
