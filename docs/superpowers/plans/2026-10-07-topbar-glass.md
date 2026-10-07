# Transparent desktop topbar

The desktop navigation should show the map through the same glass material as the sidebars. The query workspace keeps its readable background. Mobile retains its current layout. No additional library, paid service, or data change is needed.

- [x] Extend the desktop map behind navigation and apply the existing light/dark glass material.
- [x] Measure the occupied header height and keep camera bounds and map controls below it.
- [x] Verify build, focused camera tests, responsive themes, and user flows.
- [x] Push and verify the actual production map, glass pixels, scoped region bounds, and point analysis.

Success requires visible map influence on the header, all Yangsan polygons inside the unobstructed map area, working navigation controls, and preserved reduced-transparency/high-contrast rendering.

Local verification: production build passed; 12 focused camera/render tests passed; 15 responsive/theme cases passed; 36 browser journey tests passed. ESLint reported no errors and existing warnings. Actual Kakao verification requires the registered production domain.

Production app version: `f360f7fbdbed0e0baabef1156847968aa1091f8f`, confirmed by `/api/health`.

- Actual Kakao map covers the desktop viewport behind the header and panels. Hiding only the map changes 86.1% of header pixels and 54.4% of sidebar pixels at a channel difference threshold greater than 6. These measure visible background influence, not opacity percentages.
- Yangsan analysis displays 13 polygons, all inside the area below the query workspace and between the panels. Map controls and Kakao attribution remain visible.
- Desktop and mobile scoped zoom, whole-region restoration, and typing without overlay replacement passed.
- Point analysis passed at 1440×900, 1440×600, and Pixel 5, including visible cards, collapse, and updated coordinates.
- Map-movement style verification reads its temporary class and computed style in one browser call so an SDK idle event cannot reset the class between measurements.

Evidence: `logs/topbar-glass-prod-pixels.log`, `logs/topbar-glass-prod-scope.log`, `logs/topbar-glass-prod-probe.log`, and screenshots in `test-results/desktop-glass/`.

Production responsive/theme verification: 15 cases passed. CI `37589820119`: verify and smoke-prod both passed, including numeric and fixed Korean RAG gates. Report: `logs/liquid-glass-geometry-2026-10-07T07-53-13-491Z.json`.
