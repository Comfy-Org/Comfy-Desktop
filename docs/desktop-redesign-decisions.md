# Desktop redesign: decision log

Product and engineering decisions taken while implementing [the plan](desktop-redesign-plan.md) without a product review. Each entry says what was decided, why, and how to reverse it. Review them; anything marked **Revisit** is a judgement call worth a second opinion.

## Process

| # | Decision | Why |
| --- | --- | --- |
| P1 | The plan is cut from 44 PRs to 19 (M1 5, M2 9, M3 5). Each commit on `PabloWiedemann/desktop-redesign` is one planned PR, in order. | Asked for about half. A PR now covers one surface or one data domain. |
| P2 | Work branches from `origin/main` (last rebased onto `195ae80a`), in a separate worktree. The prototype branch is untouched and still uncommitted. | Start clean; keep the prototype as the visual reference. Push the prototype branch before the team reviews, or the plan's references are not reachable. |
| P3 | Each commit is one pull request, stacked: each PR is based on the one before it, so it shows only its own change. | One reviewable change per PR, merged in order. |
| P4 | E2E tests are not run locally. | On macOS the harness overwrites the real `~/Library/Application Support/comfyui-desktop-2`. They run in CI. |

## Milestone 1: design system

| # | Decision | Why | Reverse by |
| --- | --- | --- | --- |
| M1.1 | The legacy palette bridge lives in `src/renderer/src/assets/palette-void.css`, not in `design-system/`. It holds the re-pointed variables **and** the shapes of legacy components (radii, row heights, fills), written as `:is(:root.palette-void, .palette-void) .legacy-class`. | One file to review instead of edits scattered over ~20 scoped styles; it only applies under the class, so out-of-scope screens cannot change; each block is deleted when its component is rebuilt on the design system. `design-system/` stays the new system only. | Moving each block into its component's scoped style. |
| M1.2 | Raw values in the bridge are replaced by design-system tokens where the value matches exactly and the meaning fits; the rest (in-between hover fills) stay as `oklch()` literals copied from the prototype. | Avoids tokens used for the wrong meaning just because the value matches. | — |
| M1.3 | Design-system components never hold English strings: `SearchInput` takes `placeholder` and `clearLabel`; `LocationIcon` is decorative (the text beside it says where). | The tooltip and system-modal renderers have no vue-i18n, and all user-facing text must be translatable. | — |
| M1.4 | The update splash keeps the old plum (`#211927`) on its own constant. | It is out of scope for M1 and was coupled to `TITLEBAR_BG` by accident. | Point `SPLASH_PURPLE.bg` back at `TITLEBAR_BG`. |
| M1.5 | The account chip and workspace selector keep their components and logic; they get the new look through the palette bridge (ghost 28px faces, 20px avatars, design-system menus). They are not rebuilt as Reka dropdowns. | Both are also used by Performance Tests and Benchmarks, and e2e selects them by their existing hooks. A rebuild is a separate change with no visible gain at M1. | Rebuild on `DropdownMenu*` when M2's sidebar foot replaces them on the dashboard. |
| M1.6 | Tiles show the `LocationIcon` (this computer / Comfy Cloud), as in the prototype, instead of the install-type icon. The install type stays in the meta line and in the icon's tooltip. | The design system has one place-of-run mark. **Revisit:** builds from the Developer Platform lose their build glyph on the tile. | Put `typeMeta.icon` back in `ChooserInstallTile`. |
| M1.7 | Tiles have no "last used" line (main removed it before this work) and show the prototype's hover **Launch** / **Open** button in its place. Update and migrate badges sit top right, next to the status, as in the prototype. | Keeps an earlier product decision; the hover button makes the click target explicit. | — |
| M1.8 | The dashboard wordmark is the Comfy mark plus "Comfy" in the heading gradient. The mark keeps a solid colour. | In the prototype the gradient made the mark transparent, which looked unintended. | — |
| M1.9 | Dialogs (`ModalDialog`, `BaseModal`, `BaseAlert`, `AnnouncementModal`) take the Void palette on every screen, including dialogs raised from the install wizard and first-run (`TermsModal`, `McpSetupModal`). | One dialog style instead of per-caller variants. **Revisit** if a Void dialog over the plum wizard looks wrong. | Bind `usePaletteScope()` on the overlays instead of the fixed class. |
| M1.10 | Performance Tests and Benchmarks get the palette on their root only; their brand background and layout are unchanged. | "Palette only" (D2). | — |
