# Comfy Desktop: every screen

Traced from code on `main` @ 1.1.6. Strings come from `locales/en.json`.

## 0. Before any UI
| # | Screen | When | States |
|---|---|---|---|
| 0.1 | Update splash (`src/main/lib/updateSplash.ts`) | A downloaded Desktop update is staged at boot | "Checking for update" · "Updating Comfy Desktop" + "Restarting in {n}s…" |
| 0.2 | macOS folder-access prompt (native) | A legacy Desktop install is detected | OS dialog |

## A. Welcome and consent
| # | Screen | When | States to design |
|---|---|---|---|
| A1 | **"How do you want to run Comfy?"** (`FirstUseTakeover.vue`) | Every launch until setup completes | Cloud / Local cards · nothing selected (Continue disabled) · "Recommended for your hardware" badge on Cloud (weak/no GPU) · "TRY FREE" pill (gated) · Local options: "Migrate existing instance" (legacy only), "Express Install" + "Detected: NVIDIA/AMD/Intel/Apple Silicon" hint · Linux AMD driver warning · consent: EULA/ToS (required), telemetry, beta opt-in (blocked if telemetry off) · terms not accepted → consent row shakes · busy "Preparing your install…" · close → "Quit setup?" |
| A2 | "Why try Cloud?" modal (`WhyTryCloudModal.vue`) | Info button on the Cloud card or dashboard tile | Hero + 5 benefits · "Maybe Later" / "Try Cloud For Free" |
| A3 | Legal modal (`TermsModal.vue`) | EULA / ToS / Privacy / Third-party links | Long scrollable text |
| A4 | "Enable Chinese Mirrors?" | Locale is `zh*` | Old non-brand modal chrome · "Not now" / "Enable Mirrors" |
| A5 | **"It looks like you've installed Comfy before"** | Legacy found, Migrate unticked, Express off | "Migrate" (recommended) / "Start Fresh" · Back |
| A6 | **"Migrate to Standalone"** (`MigrateConfirmTakeover.vue`) | Migrate chosen | Loading · legacy list ("Reuse workflows…", "Add models to shared paths") · "{name} is running and will be stopped first" · other-source variant with merge checkboxes · "Cancel" / "Start Migration" |

## B + C. Choose and configure (local)
| # | Screen | When | States to design |
|---|---|---|---|
| C1 | **"Create a New Instance"** (`InstallWizardModal.vue`) | Local + Express off, Start Fresh, dashboard "New Instance", title-bar "New Instance" | Name field + validation · Method tabs: Public Builds / Managed Builds / Remote Connection · Release: Stable / Latest on GitHub · Version select · Hardware cards (NVIDIA, AMD, Intel Arc, CPU, Apple Silicon; Recommended badge; Mac shows MPS only) · field loading / empty / error · Install location + "Browse…" · disk line "{free} free · ~{required} required" · path errors (app bundle, OneDrive, shared folder, overlaps instance) · GPU line (detecting / detected / none) · Intel Mac unsupported · Remote: URL field, location disabled · Managed Builds: browser sign-in wait, no workspace, builds error, empty, refreshing · Continue disabled state · close → "Discard install setup?" |
| C1a | Blocking dialogs after Continue | Problems found | "Unsafe Install Location", "OneDrive Location", "Shared Directory Location", "Overlapping Instance", "Update NVIDIA Driver" (Continue Anyway), "Low Disk Space" (Continue Anyway), "Not Enough Space for Template Models" (hard block), "Cannot Add" / "Install Failed" (e.g. name taken) |
| C2 | **"Choose a starter workflow"** (`TemplatePickerStep.vue`) | Standalone, templates exist, disk fits one | Tabs Image / Video / Audio / 3D · cards: thumbnail or fallback, selected, Recommended, "Requires credits", size or "Downloaded" · "None – blank canvas" · disk-too-small alert + shake · "Skip & Install" / "Install" · "Don't show this step again" (returning users only) · Back |
| — | Native folder picker | "Browse…" | OS dialog |

## D. Install progress (`ProgressModal.vue` + `BrandProgressView.vue`)
One full-window takeover. Install fills 0–70 %, launch fills 70–100 %, no break between.

| # | State | Content |
|---|---|---|
| D1 | Running – Standalone | Steps: "Downloading ComfyUI…" (starting / {progress} / cached / waiting for other download) → "Unpacking the install…" → "Setting up your Python environment…" → "Tidying up dependencies…" → "Pulling the latest ComfyUI release…" (optional) · % bar · "While you wait" Cloud carousel (9 cards) · "View logs" accordion · "Return to Dashboard" |
| D2 | Running – Migration | Title "Migrating — {name}" · 9 steps (backup, folder access, validate Python, snapshot, allocate, stage source, install requirements, carry over settings, register) |
| D3 | Migration prompts | "Folder access needed" (Full Disk Access) · "Python environment looks broken" → "Adopt anyway" · "ComfyUI source code unavailable" → "Retry" + Details |
| D4 | Cancel confirm | "Cancel current operation?" → rollback, "Counting files…" delete progress |
| D5 | Success | "Completed successfully" (auto-closes in 0.7 s) |
| D6 | Cancelled | "Operation was cancelled" |
| D7 | Error | "Operation failed" + message + copy · "Back" / "Reboot" (label is confusing for a retry) |
| D8 | Carousel link fails | "Couldn't open Comfy Cloud" |

## E. First launch of ComfyUI
| # | Screen | States |
|---|---|---|
| E1 | Launch steps (same takeover) | optional "Repairing installation…", "Restoring GPU PyTorch…" → "Starting ComfyUI…" → "Running security scan…" → "Loading libraries…" → "Initializing GPU…" (sub-activity: Manager, node registry, GPU memory, custom nodes…) → "Loading custom nodes…" → "Starting server…" |
| E2 | Template model download (last step) | "{file} (i of n) — x / y GB at z MB/s · eta" · "Skip & open ComfyUI" · ready / some failed / not enough disk / cancelled / failed + "Opening ComfyUI in {s}…" |
| E3 | "An instance is already running" | Will-be-stopped list · "Close & Launch" / "Run All" |
| E4 | Port conflict | 4 banner variants ("Port already in use", "still running a prompt", "earlier ComfyUI still running", "processes still running") · "Use next available port" / "Stop process and retry" · "Stop Existing Process" confirm · kill-failed text |
| E5 | Launch errors | Folder not found / no access · no Python env · DB locked · prior process stuck · not ready to launch · macOS permission · → "Back" / "Restart ComfyUI" |
| E6 | **ComfyUI loaded + title bar** (`TitleBarApp.vue`) | Menu · refresh · instance pill (+ Update chip) · app-update pill (Update / Downloading / Restart) · zoom % · What's new (dot) · Feedback · Downloads tray (count / error / unseen) |
| E7 | Coachmark on pill | "Switch & manage instances" · "Got it" |
| E8 | Beta notice | "The {feature} beta is on" · "Got it" / "Settings" |
| E9 | Crashed (`ComfyLifecycleView.vue`) | "ComfyUI could not start" / "ComfyUI exited unexpectedly" · exit code / signal / memory violation / VC++ hint · logs · "Back" / "Restart ComfyUI" |
| E10 | Stopped | "ComfyUI is stopped" · "Return to Dashboard" / "Relaunch ComfyUI" |
| E11 | Small splashes | "Preparing…" / "Starting ComfyUI…" / "Stopping ComfyUI…" · "Starting ComfyUI – Launching your ComfyUI instance…" · "Restarting ComfyUI – New model folders were detected…" |

### E-Cloud branch (A1 → Cloud)
| # | Screen | States |
|---|---|---|
| EC1 | "Connecting" takeover | "Connecting to {url}… ({s}s)" · error "Could not connect to {url}" |
| EC2 | cloud.comfy.org in window | Web login (not ours) + injected banner "We opened your browser to sign in. Didn't open?" · Copy link / Open again / Dismiss |
| EC3 | Browser sign-in pages (`bridgeHtml.ts`, hardcoded) | "Sign in to continue" · "Finish in the popup" · "You're signed in – Returning in 3…" · "Sign-in failed" · "Sign-in unavailable" |
| EC4 | Credits checkout | Floating window over dimmed backdrop |

## F. Returning user, getting back into ComfyUI
| # | Screen | States |
|---|---|---|
| F1 | Dashboard (`ChooserView.vue`) | Account chip · search · workspace selector · loading / no match · tiles: New Instance, Cloud (TRY FREE, Why try Cloud?), instances (Running / Starting / Stopping / Error / Update pill / Migrate pill / "Install Failed" / More actions menu) |
| F1a | "Migrate before launching?" | Click on a legacy Desktop tile → "Migrate and launch" |
| F2 | Instance picker popup (`InstancePickerView.vue`) | Search, filter, empty · New Instance / Open Dashboard · row actions Start / Restart / Switch / Open Cloud / Open Remote / new window · "Restart instance?" · "Switch instance?" · inline progress (done / failed / cancelled) |
| F3 | File menu | Normal list · first-run: only "Skip Onboarding" |
| F4 | App update system modals | "Desktop Update Available" (Download / Later) · "Desktop Update Ready" (Restart & Update) · "Desktop Update Error" |
| F5 | Other system modals | "Return to Dashboard?" · "Close Window" · "Quit Desktop" · native "Template models are still downloading" (Quit Anyway / Keep Downloading) |

## Gaps worth fixing in the redesign
1. Express skips every guard (disk, path, NVIDIA driver).
2. Configure in the direct first-run path has no Back link and no "Back to Dashboard".
3. Setup is marked complete when the install starts, so a failed first install lands on the dashboard next time.
4. The retry button says "Reboot" for installs but "Restart ComfyUI" for launches.
5. The Chinese mirrors step still uses the old modal chrome.
6. Start Fresh copy renders "Comfy-{Name}" literally.
7. Quick Install modal has no entry point (dormant).

---

# Part 2: everything after ComfyUI is open

Not shipped (nothing mounts them, skip): `ManageInstallModal`, `DetailModal`, `ConsoleModal`, `SnapshotTab`, `RestoreModal`, `ImportPreviewModal`, `SnapshotInspector`, `MigrationBanner`, `ZoomBanner`, `PickerSnapshotsList`, `PickerInlineProgress`. Tray menu is off. No `comfy://` links, no OS notifications.

## G. Instance settings (instance picker, expanded) – `ComfyUISettingsContent.vue`
Shell states: no instance · loading · error · switching (stale, locked) · < 640 px icon-only tabs · amber dot on Update · op running (other tabs locked; overlay: progress / success "Returning in {n}…" / "Something went wrong" + Try Again / Cancelled).
Footer: split CTA "Start" / "Switch" / "Restart" / "Open Cloud" / "Open Remote" / "Restart to apply changes" · caret "Open in new window", Stop · More menu.

| Tab | Standalone | Portable | Git | Legacy | Remote | Cloud | Managed Build |
|---|---|---|---|---|---|---|---|
| Update | Updates + PyTorch | Updates | – | – | – | – | Build Version |
| Startup Args | ✓ | ✓ | ✓ + venv | – | Browser Cache, Auto-Download | "Storage" | ✓ |
| Snapshots | ✓ | – | – | – | – | – | – |
| Storage | ✓ | ✓ | – | – | – | – | – |
| Terminal | ✓ | ✓ | ✓ | ✓ | – | – | ✓ |
| About | ✓ | ✓ | ✓ | Legacy info | Connection (URL edit) | ✓ | ✓ |
| More | Launch, Rename, Duplicate, Open Dir, Share, Forget, Uninstall | + Migrate | Git Pull, Migrate | Migrate, Open Dir, Forget | Connect, Rename, Forget | Connect | Launch, Rename, Duplicate, Open Dir, Forget, Uninstall |

| # | Section | States to design |
|---|---|---|
| G1 | Update – channels | Stable / Latest cards · installed, latest, last checked · "Update available" / "Up to date" · "Computing commits ahead…" · Check / Update Now / Copy & Update / Switch Channel · Release Notes |
| G2 | Update – PyTorch | Backend → version cascade · nightly note · GPU capability + NVIDIA driver warnings · "Change PyTorch" / "Copy & Change PyTorch" |
| G3 | Update – Build | Installed / Latest Published · "Update to v{version}" |
| G4 | Startup Args | Manager Security Level, Network Mode, Launch Mode, Browser Cache, If Port is Busy, Env Vars (duplicate key, secret reveal) · "Restart to apply" tag · field errors |
| G5 | Startup Arguments sub-page (`ArgsBuilderPage.vue`) | Raw input + autocomplete · search · categories · "Choose one" groups · schema unavailable · no matches · inline validation · "+N beta" pill + popover |
| G6 | Storage | Models: shared toggle, dir list (Downloads / Instance / YAML tags), Add Directory · Input / Output toggles + rows · restart banner · "Custom model paths" modal (folder not found, Refresh) |
| G7 | Terminal | xterm · "This console session ended" + Restart · right-click Copy / Paste / Select All |
| G8 | About | Editable name, source badge, facts (path, disk usage, port, "Copied From"), remote URL edit |
| G9 | Dialogs | Update ComfyUI · Copy & Update · Change PyTorch · Update Build · Duplicate · Rename · Forget · Uninstall · Migrate to Standalone · Low Disk Space · Cancel Operation · Stop ComfyUI · Restart this instance? |

## H. Snapshots (Standalone)
| # | Screen | States to design |
|---|---|---|
| H1 | Snapshots tab (`SnapshotsView.vue`) | Header "Latest…" / "No snapshots yet", Import, Export All · timeline with trigger tags (Boot, Manager, Manual, Update, Restored) and +/−/~ pills · "What changed" / "What restoring would change" diffs · Restore / Export / Delete · loading, error + Retry, empty, diff loading, no changes |
| H2 | Snapshot op card | Create · Restoring (bar, Cancel) · Restored / Rolled back · Restore failed · cancelled |
| H3 | Dialogs | Create Snapshot (label) · "Restore this snapshot?" + diff · Delete · Import · "Snapshot uses a different PyTorch" · save / delete / import errors |
| H4 | "Restore From Snapshot" takeover (`LoadSnapshotModal.vue`) | Drop zone → form: Name, Release, Device, hardware-mismatch warning, Custom Nodes / Pip / History disclosures · "Create Instance" / "Installing…" |

## I. Downloads
| # | Screen | States to design |
|---|---|---|
| I1 | Downloads shelf (`DownloadsView.vue`) | Tray badge: count / failed / finished / pulse · rows done, error, paused, active · Pause / Resume / Retry · "No downloads yet" · "View All Downloads" |
| I2 | Downloads full view (`DownloadsFullView.vue`) | Filters All / Active / Completed / Failed · pending, %, paused, completed (Show in Finder), error, cancelled · Cancel / Remove · empty · "Clear finished" |
| I3 | OS | Dock / taskbar progress · native Save As |

## J. Desktop Settings (`GlobalSettingsView.vue`)
| Tab | Contents and states |
|---|---|
| Preferences | Language · auto-launch, confirm close, warn multiple instances, hide Cloud · telemetry, beta (needs telemetry) · GitHub card (loading skeleton) |
| Updates | Up to date / Update available / Downloading % / Ready to install · Check / Download / Restart & update · auto-install toggle · .deb system-managed note |
| Storage | Shared Models list ("Downloads" tag, Add, row menu) · Shared Input / Output · "Remove shared models directory?" |
| Advanced | Default install location · PyPI mirror · hardware acceleration · Chinese mirrors · cache dir |
| Logs | "Open logs folder" |
Deep-link arrival highlights the target field.

## K. Title bar popups and menus
| # | Item | Contents |
|---|---|---|
| K1 | Waffle menu | Open Dashboard · New Instance · Add Existing Instance · Load Snapshot · Log in · Performance Tests · Benchmarks · Desktop Settings · Send Feedback · Reset Zoom (N%) · Close Window · Quit Desktop · first run: only "Skip Onboarding" |
| K2 | Coachmarks | "Switch & manage instances" · beta on / off notice |
| K3 | Tooltips | Title bar buttons |
| K4 | Dashboard tile menu | Manage, Update, Migrate, Duplicate, Open Folder, Export / Restore Snapshot, Create Build, Stop, Uninstall · disabled "Stop the running instance first." |
| K5 | ComfyUI right-click (native) | Open link, Copy link, Save / Copy image, Cut / Copy / Paste, Add to Dictionary |

## L. Account, workspaces, Managed Builds
| # | Screen | States |
|---|---|---|
| L1 | Account chip | Signed out "Log in" · signed in avatar → "Signed in as {email}" / Sign out |
| L2 | Workspace selector | Personal + workspaces ✓ · loading · "Couldn't load workspaces. Retry" |
| L3 | Sign-in | Browser opened banner · macOS passkey warning · browser pages (signed in / failed / unavailable) |
| L4 | "Installation in progress" | Sign out during install → "Cancel Installation & Sign Out" |
| L5 | Credits checkout | Child window over blurred scrim |
| L6 | Managed Build | "Could not create build" |

## M. Tools
| # | Screen | States to design |
|---|---|---|
| M1 | Performance Tests (`PerformanceTestView.vue`) | 1 Select instance · 2 Choose workflow (example or JSON drop; loading, offline, importing, model download, low disk, error) · 3 Warm-up / measured runs · Running / Stopping · results chart, Fastest / Avg / Median / Slowest, system info, export · logs · "Choose an example workflow" modal |
| M2 | Benchmarks (`BenchmarksView.vue`) | Runs library: folder, search, filters, columns, sortable table, rename, delete · loading / error / empty / no match · Compare: baseline, Duration vs Speed views, export · delete / rename errors |
| M3 | "Connect an agent via MCP" (`McpSetupModal.vue`) | Opened from plug icon in ComfyUI sidebar (unseen dot) · video · "I have an agent" / "I need one" · copy commands · "Open terminal" |
| M4 | Terminal pop-out window | Interactive xterm |
| M5 | Logs pop-out window | Read-only, auto-scroll |
| M6 | ComfyUI terminal stopgap | "Terminal commands run in a protected Desktop window." + "Open Desktop Terminal" |

## N. Feedback and What's new
| # | Screen | States |
|---|---|---|
| N1 | Send Feedback (`FeedbackModal.vue`) | Typeform iframe · loading |
| N2 | What's new (`AnnouncementModal.vue`) | Bell unread dot · "Introducing Comfy API" video card, mute, CTA |

## O. Instance lifecycle
| # | Flow | Screens |
|---|---|---|
| O1 | Add Existing Instance (`TrackModal.vue`) | Location + Browse · Name · detected type ("Detecting…", none found) · version / repo / branch · venv picker · "Track Install" · "Cannot Track" |
| O2 | Update | Pill / menu / tab → "Update ComfyUI" → op overlay or progress takeover |
| O3 | Uninstall | "Uninstall" confirm → progress · tile pills: Delete Interrupted, Install Failed, Folder Not Found, Folder Access Denied |
| O4 | Export snapshot | Native save · "no snapshots yet" / "could not share" |
| O5 | Switch / return | "Switch instance?" · "Return to Dashboard?" · "An instance is already running" |

## P. Native OS
| # | Surface | Contents |
|---|---|---|
| P1 | App menu | macOS: About, Check for Updates…, Edit, Window · Win/Linux: View → Full Screen |
| P2 | "Quit Desktop" system modal | Lists open instances, running ops, active downloads |
| P3 | "Close Window" system modal | 4 message variants |
| P4 | Native message box | "Template models are still downloading" |
| P5 | File dialogs | Folder pickers, snapshot import / export, Save As |
