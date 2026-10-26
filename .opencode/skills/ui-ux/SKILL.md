---
name: D-Shift UI/UX
description: Redesign and improve the D-Shift Workouts interface, mobile usability, accessibility, and responsive interaction patterns
---

# D-Shift UI/UX

Use this skill when the user asks to change the visual design, layout, navigation, interaction patterns, mobile behavior, accessibility, copy, or overall user experience of D-Shift Workouts.

## Workflow

1. Read `index.html`, `styles.css`, and the relevant rendering and event-binding sections in `app.js` before editing.
2. Preserve the app's black, white, and grayscale visual system unless the user explicitly asks for a new visual direction.
3. Design for iOS Safari first: thumb reach, safe-area insets, large tap targets, keyboard behavior, bottom navigation, and standalone PWA mode.
4. Keep primary actions obvious and progressive disclosure intentional. Empty states must say exactly what the user should press next.
5. Keep number inputs empty by default and use descriptive placeholders. Do not replace standard form controls with inaccessible custom controls without a clear benefit.
6. Add accessible labels, focus states, semantic buttons, dialog semantics, and useful ARIA only where native HTML does not already provide the behavior.
7. Check narrow mobile widths and a wider desktop layout after each change. Avoid overflow, clipped controls, and horizontal scrolling.
8. Test the changed interaction in a real browser when possible, including touch-sized controls, modal close behavior, accordions, forms, and offline shell loading.
9. Keep changes focused, preserve IndexedDB data compatibility, and report the affected files and verification results.

## D-Shift interaction rules

- Every tab keeps its help icon in the top-right.
- Rota editing must retain the user's open/closed accordion state across rerenders.
- Food search results appear as a clear selectable dropdown; selecting a result must expose an unambiguous add action.
- Workout logging shows weight and reps inputs for every set, not a single value shared by the whole exercise.
- Destructive or reset actions remain visually distinct and require no hidden gesture.
