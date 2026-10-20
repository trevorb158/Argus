# Kestrel

Kestrel is a local-first Linux workstation utility built with Tauri 2, React, TypeScript, and Rust. The goal is to bring system monitoring, process management, storage, hardware information, maintenance, and diagnostics into one clear desktop app. Kestrel is intentionally AI-free.

## Current prototype

The current prototype provides live CPU and memory readings, a Performance page with per-logical-processor load and swap usage, a bounded in-memory performance chart with 5, 15, and 30 minute views, an Overview storage panel, a Storage page with mounted-volume capacity details plus read-only partition and mount-state discovery, and a Processes page with live CPU/memory and per-process disk I/O rates, search, sorting, process state/parent/runtime details, and confirmation before requesting normal process termination. Storage data refreshes every five seconds; process data refreshes only while its page is open. The Overview reports the highest available hardware temperature or clearly indicates when sensors are unavailable. The Network page shows live interface rates and local addresses. Startup lists local login applications and lets the user enable or disable user-owned entries with a confirmation; system-managed entries remain read-only. Services shows system and user systemd status and startup mode in a read-only view. System Information shows the local operating system, kernel, processor, memory, device architecture, desktop session, uptime, and battery charge where Linux exposes it. Diagnostics builds a local support summary, previews its contents, and saves only after the user chooses a location. Maintenance scans a chosen folder for large files, reports application cache sizes, supports explicit per-folder cleanup within the current account’s cache directory, and summarizes local log and journal disk usage without reading log contents. Settings stores local display preferences for temperature units and the default performance-chart time range. See [Kestrel Project Blueprint](Kestrel_Project_Blueprint.docx) for product direction, architecture, safety principles, current limitations, and roadmap.

## Run on Linux

Install the Tauri Linux prerequisites for your distribution, then from this folder run:

```bash
npm install
npm run tauri dev
```

The development app has been confirmed on Pop!_OS 24.04 LTS. Other Linux distributions may need different system packages.

## Build

```bash
npm run build
npm run tauri build
```

## Project structure

- `src/` contains the React and TypeScript interface.
- `src-tauri/src/` contains Rust commands and local system access.
- `src-tauri/` contains Tauri configuration and packaging assets.

## Product principles

- Keep system readings local to the device.
- Clearly distinguish implemented features from planned ones.
- Make state-changing actions explicit and explain their scope.
- Keep background work proportional to the active view.
- Prefer Linux-native interfaces and report unavailable readings honestly.
