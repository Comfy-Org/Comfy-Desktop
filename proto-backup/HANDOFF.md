# Handoff: asset detail + app panel prototype work (Nov 25)

## Where everything is
Branch `claude/pr-screenshots` in Comfy-Org/Comfy-Desktop, folder `proto-backup/`:
- `asset-detail/asset-detail-types.patch`: staged diff, base 45584b4a4 (PR #1903 head). README inside.
- `asset-detail/*.png`: all screenshots (final: exr-details, exr-viewer, 3d-details, 3d-viewer, audio, image; plus history).
- `app-panel/` (when finished): app detail panel redesign patch + before/after shots.

## To deploy to Vercel (one-comfy-new-ui)
Start a new Claude Code session with repository `mariana953/Comfy-Desktop`, branch `mar/ui-tests`, and say:
"Apply proto-backup/asset-detail/asset-detail-types.patch from Comfy-Org/Comfy-Desktop branch claude/pr-screenshots onto mar/ui-tests
(it was made on 45584b4a4, so resolve conflicts in mar/assets/AssetDetail.vue keeping the Milestone 13 look), fix the existing
pre-commit failures (mar/ds/stages.ts 'rhythm' view type, Prettier on mar/apps/AppRhythmTile.vue and parts/env/SidebarGroup.vue),
commit and push so Vercel deploys."

## Final asset detail design (decisions)
- Full-window asset view (Milestone 13 look) everywhere; old framed modal removed.
- EXR and 3D: underline tabs "Details | Viewer" at the very top of the right panel; ⋯ on the right of that row.
- Other types: same row shows a plain "Details" label (not a tab).
- Close (×) is a round button on the viewer's top-right corner for every type.
- Viewer tab shows only the file name (no subtitle/chips). Details shows title, subtitle, chips.
- Sections separated by ~24px spacing, no dividers.
- 3D Viewer: old layout (big swatches, full-width Material and Camera segmented, FOV and Intensity sliders, Export in panel).
- EXR Viewer: Exposure slider with value at right, Display (channel, gamut, checkboxes), Histogram.
- Empty rows hidden; never show file paths ("Saved in" = folder + build).

## Reply to Jae One (#product-prd-reviews thread 1794382511.442049), English
Thanks Jae, super useful to know this now. I mocked it in the prototype so you can see it:
1. EXR / 3D: one full-window modal for every type (b). Agree with Pablo on tabs at the top of the right panel, but only where there are viewer controls (EXR, 3D): Details and Viewer. Other types show a plain "Details" title in that row. The close button sits on the viewer's corner so it doesn't clash with the tabs. Viewer keeps only the file name on top; file info lives in Details.
2. Less info: hiding empty rows works. Type, size and date always show (as chips under the name) so audio/3D don't look broken. Never show file_path; "Saved in" shows folder + build.
3. Opening: keep double-click and Inspect asset for v1. Single click + hover checkbox changes selection across the whole panel, so I'd do it with the panel redesign (filters/folders).
4. Zoom yes, before/after out of v1. Agreed. Zoom hides for audio, 3D and types with no viewer.
5. Inspect for types with no viewer: yes, details and actions still help there.
Screenshot links: https://raw.githubusercontent.com/Comfy-Org/Comfy-Desktop/claude/pr-screenshots/asset-detail-proto/<exr-details|exr-viewer|3d-details|3d-viewer|audio|image>.png

## Pending
- Delete the old Slack draft in that thread, then post the text above.
- "New workflow" header button: should be a labeled primary button ("+ New workflow"), not icon-only. Location to confirm.
- App detail panel redesign (6 changes): see app-panel/.
