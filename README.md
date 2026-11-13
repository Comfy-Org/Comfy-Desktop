<div align="center">

<img src="assets/Comfy_Logo_x512.png" alt="Comfy Desktop" width="128" />

# Comfy Desktop

**Install, run, and manage [ComfyUI](https://github.com/Comfy-Org/ComfyUI) from one app — no dependency hell.**

[![Release](https://img.shields.io/github/v/release/Comfy-Org/Comfy-Desktop?display_name=tag&style=flat&label=release&color=4f46e5)](https://github.com/Comfy-Org/Comfy-Desktop/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/Comfy-Org/Comfy-Desktop/ci.yml?event=merge_group&style=flat&label=CI)](https://github.com/Comfy-Org/Comfy-Desktop/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/Comfy-Org/Comfy-Desktop?style=flat&color=blue)](LICENSE)
[![Stars](https://img.shields.io/github/stars/Comfy-Org/Comfy-Desktop?style=flat&logo=github&color=f5c518)](https://github.com/Comfy-Org/Comfy-Desktop/stargazers)
[![Discord](https://img.shields.io/badge/Discord-comfy.org-5865F2?style=flat&logo=discord&logoColor=white)](https://www.comfy.org/discord)
![Platforms](https://img.shields.io/badge/platforms-Windows%20·%20macOS-555?style=flat)

[**Download**](#download) · [**Getting Started**](#getting-started) · [**Discord**](https://www.comfy.org/discord)

</div>

---

Comfy Desktop is the official desktop application for **ComfyUI**, the node-based engine for generative AI. It installs ComfyUI into a self-contained, GPU-ready environment, lets you run **multiple independent setups side by side**, and keeps them updated — so you spend your time building workflows instead of fighting Python, CUDA, and pip.

<div align="center">
  <img src="assets/hero.png" alt="Comfy Desktop — run multiple ComfyUI installs side by side from one app" width="820" />
</div>

## Features

- 🧩 **Multiple installs, side by side** — run as many independent ComfyUI setups as you like, each with its own version, models, and custom nodes. Switch between them without conflicts.
- 📦 **Isolated, GPU-ready environments** — each install ships a relocatable Python with PyTorch and GPU wheels prebuilt. No pip/uv failures, no CUDA roulette at install time.
- 🔄 **One-click updates** — update ComfyUI (and custom nodes) to the latest version in place. No terminal, no git, no re-downloading the multi-gigabyte environment.
- 📸 **Snapshots & rollback** — back up an install and restore it if an update or a custom node breaks something.
- 📥 **Bring your existing setup** — adopt and migrate existing ComfyUI installations (portable, git, or a previous desktop install) in place.
- 🖥️ **Cross-platform** — Windows, macOS, and Linux.
- ⬆️ **Built-in auto-updates** — the app keeps itself current.
- 🛠️ **Works without system Git** — bundles a tiny Python + `pygit2` bootstrap so clones work on a clean machine.

## Download

<div align="center">

[![Download Comfy Desktop](https://img.shields.io/badge/⬇%20Download%20Comfy%20Desktop-Windows%20·%20macOS-4f46e5?style=for-the-badge)](https://dl.todesktop.com/241130tqe9q3y)

**[dl.todesktop.com/241130tqe9q3y](https://dl.todesktop.com/241130tqe9q3y)** — one link, auto-detects your platform.

</div>

> **New to ComfyUI?** Just download, install, and open the app — it walks you through creating your first setup. No terminal required.

**Requirements:** Windows, macOS (Apple Silicon), or Linux. A dedicated GPU (NVIDIA / AMD) or Apple Silicon is recommended for good performance, but not required.

<details>
<summary><b>Install instructions per platform</b></summary>

**Windows** — run the NSIS installer (`.exe`) and launch from the Start Menu or desktop shortcut.

**macOS** — open the `.dmg`, drag **Comfy Desktop** to Applications, and launch from there.

**Linux** — `.deb` (Debian/Ubuntu), from the directory you downloaded it to:

```bash
sudo apt install ./*.deb
```

AppImage:

```bash
chmod +x ./*.AppImage
./*.AppImage --no-sandbox
```

Then launch from your application menu.

</details>

## Getting Started

1. **Download and install** Comfy Desktop for your OS (above).
2. **Launch the app.**
3. **Create a new install** — pick a standalone, GPU-ready environment and Comfy Desktop downloads and provisions it for you. (Already have a ComfyUI install? Import it instead.)
4. **Hit launch** — the app starts ComfyUI and opens it, ready to build.

From there you can add more installs, take snapshots before risky changes, and update ComfyUI or its custom nodes per install.
