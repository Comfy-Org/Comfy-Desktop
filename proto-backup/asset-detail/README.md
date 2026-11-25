# Asset detail prototype backup

Base: Comfy-Org/Comfy-Desktop PR #1903 head (mariana953/Comfy-Desktop mar/ui-tests at 45584b4a4d689d11d0928fbfa91297006378691a).

Apply on that commit:

    git checkout 45584b4a4d689d11d0928fbfa91297006378691a
    git apply asset-detail-types.patch

All changes are under src/renderer/src/design/landing/mar/.
Final design: full-window asset view (Milestone 13 look), Details | Viewer underline tabs for EXR and 3D,
plain "Details" label for other types, close button on the viewer corner, name-only Viewer header,
sections separated by spacing, old 3D Viewer layout.
