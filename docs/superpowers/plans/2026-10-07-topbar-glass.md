# Transparent desktop topbar

The desktop navigation should show the map through the same glass material as the sidebars. The query workspace keeps its readable background. Mobile retains its current layout. No additional library, paid service, or data change is needed.

- [x] Extend the desktop map behind navigation and apply the existing light/dark glass material.
- [x] Measure the occupied header height and keep camera bounds and map controls below it.
- [x] Verify build, focused camera tests, responsive themes, and user flows.
- [ ] Push and verify the actual production map, glass pixels, scoped region bounds, and point analysis.

Success requires visible map influence on the header, all Yangsan polygons inside the unobstructed map area, working navigation controls, and preserved reduced-transparency/high-contrast rendering.

Local verification: production build passed; 12 focused camera/render tests passed; 15 responsive/theme cases passed; 36 browser journey tests passed. ESLint reported no errors and existing warnings. Actual Kakao verification requires the registered production domain.
