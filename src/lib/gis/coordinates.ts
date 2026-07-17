export type KakaoPoint = {
  lat: number;
  lng: number;
};

export type GeoJsonCoordinateTree = readonly number[] | readonly GeoJsonCoordinateTree[];
export type KakaoPath = KakaoPoint | KakaoPath[];

function isPosition(input: readonly unknown[]): input is readonly number[] {
  return typeof input[0] === "number";
}

export function geoJsonToKakaoPath(position: readonly number[]): KakaoPoint;
export function geoJsonToKakaoPath(path: readonly GeoJsonCoordinateTree[]): KakaoPath[];
export function geoJsonToKakaoPath(input: readonly unknown[]): KakaoPath {
  if (isPosition(input)) {
    const [lng, lat] = input;

    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      throw new TypeError("GeoJSON position must contain finite longitude and latitude values.");
    }

    return { lat, lng };
  }

  return input.map((child) => {
    if (!Array.isArray(child)) {
      throw new TypeError("GeoJSON path must be a nested coordinate array.");
    }

    return geoJsonToKakaoPath(child);
  });
}
