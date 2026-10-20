---
paths:
  - "src/app/**/*.tsx"
  - "src/app/globals.css"
---

# Interface (español, accesible)

- All user-facing text is Spanish (es-PE). Dates as `dd/MM/yyyy`, times as 24-hour `HH:mm` with the label "hora de Lima", money with `formatPEN` ("S/ 120.50").
- Use only the tokens from `globals.css` (`bg-canvas`, `text-ink`, `text-brand`, `border-line`, `text-danger`…). No raw hex values and no arbitrary pixel sizes.
- Every input has a visible `<label>`; errors render in an element with `role="alert"`; never rely on color alone (add text or an icon-free symbol such as "−").
- Interactive targets are at least 44×44 CSS px. Everything reachable and operable by keyboard; focus is visible (the `:focus-visible` rule in `globals.css` must not be removed).
- Every list and page has an empty state, a loading state and an error state.
- Server Components by default; add `"use client"` only for interactivity, and never import `src/server` or `pg` from a client component.
- Forms post to Server Actions (`"use server"`), validate with zod, and redirect or return errors; no client `fetch` for mutations.
