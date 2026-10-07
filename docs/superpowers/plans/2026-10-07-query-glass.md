# Transparent query workspace

Approved design: extend the existing desktop glass material to the query workspace while keeping the input and action backgrounds readable. Mobile layout remains unchanged. Reduced transparency, forced colors, and high contrast use opaque backgrounds. No camera or data behavior changes.

Verification plan: production build; existing responsive/theme audit; actual production pixel comparison and Yangsan unobstructed map bounds. Push the scoped changes and confirm the production SHA.

Verified app version: `459916e9cabf7f327f7233a448f8cf29fb3fff17` on the production health endpoint. Production build passed. Six mobile/desktop theme cases passed, including reduced transparency and custom Pretendard rendering. CI `37592589488` verify and smoke-prod passed.

The actual Kakao background changes 63.6% of query bar pixels when only the map is hidden, using a channel difference threshold above 6. This measures visible background influence, not opacity. All 13 Yangsan polygons remain within the unobstructed map area. Inputs and action backgrounds remain readable. Warning/error text uses the stronger foreground on desktop.

The responsive audit waits for the emulated transparency preference and its computed style to settle before asserting the opaque fallback. Evidence: `logs/query-glass-pixels.log`, `logs/query-glass-responsive.log`, and `logs/liquid-glass-geometry-2026-10-07T08-22-27-929Z.json`.
