import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { DemoMap } from "@/components/copilot/demo-map";
import type { BoundaryCollection } from "@/components/copilot/types";

function boundary(minLng: number, maxLng: number): BoundaryCollection {
  return { type: "FeatureCollection", features: [{
    type: "Feature", properties: { adm_cd2: "48330", adm_nm: "양산시" },
    geometry: { type: "Polygon", coordinates: [[[minLng, 35], [maxLng, 35], [maxLng, 36], [minLng, 35]]] },
  }] };
}

test("demo map keeps manual zoom for equivalent scope, resets for narrowed and restored scope", () => {
  const props = { regions: [], facilities: [], scores: new Map<string, number>(), selectedRegionCode: null,
    radiusKm: 2 as const, showFacilities: false, onSelectRegion: () => {} };
  const full = boundary(127, 130);
  const { container, rerender } = render(<DemoMap {...props} boundary={full} />);
  const scale = () => (container.querySelector("svg > g") as SVGGElement).style.transform;
  fireEvent.click(screen.getByRole("button", { name: "지도 확대" }));
  expect(scale()).toBe("scale(1.2)");
  rerender(<DemoMap {...props} boundary={boundary(127, 130)} scores={new Map([["48330", 10]])} />);
  expect(scale()).toBe("scale(1.2)");
  rerender(<DemoMap {...props} boundary={boundary(128.8, 129.2)} />);
  expect(scale()).toBe("scale(1)");
  fireEvent.click(screen.getByRole("button", { name: "지도 확대" }));
  rerender(<DemoMap {...props} boundary={full} />);
  expect(scale()).toBe("scale(1)");
});
