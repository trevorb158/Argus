# Kestrel

Kestrel is a local-first Linux workstation utility built with Tauri 2, React, TypeScript, and Rust. The goal is to bring system monitoring, process management, storage, hardware information, maintenance, and diagnostics into one clear desktop app. Kestrel is intentionally AI-free.

## Current prototype

The current prototype provides live CPU and memory readings, a Performance page with per-logical-processor load and swap usage, a bounded in-memory performance chart with 5, 15, and 30 minute views, an Overview storage panel, a Storage page with mounted-volume capacity, physical-drive health reported by UDisks, and partition discovery with user-confirmed UDisks mount and unmount controls, and a Processes page with live CPU/memory and per-process disk I/O rates, search, sorting, process state/parent/runtime details, and separately confirmed normal End and Force stop actions. Storage data refreshes every five seconds; process data refreshes only while its page is open. The Overview reports the highest available hardware temperature or clearly indicates when sensors are unavailable. The Network page shows live interface rates and local addresses, plus the configured default route and DNS resolver settings. Startup lists local login applications and lets the user enable or disable user-owned entries with a confirmation; system-managed entries remain read-only. Services shows system and user systemd status, with a read-only recent journal view for each service. Eligible services can be started, stopped, enabled, or disabled after confirmation; system-wide actions may require administrator authorization. Kestrel explains known risks and previews systemd-reported related units before service actions; systemd decides whether each action can run. System Information shows the local operating system, kernel, processor, memory, device architecture, desktop session, uptime, battery charge, estimated full-capacity health and charge cycles, and a read-only USB device inventory when Linux exposes them. The USB inventory excludes serial numbers and does not inspect device contents. Diagnostics builds a local support summary, previews its contents, and saves only after the user chooses a location. Maintenance scans a chosen folder for large files, reports application cache sizes, supports explicit per-folder cleanup within the current account’s cache directory, and summarizes local log and journal disk usage without reading log contents. Settings stores local display preferences for temperature units and the default performance-chart time range. See [the current capability audit and roadmap](docs/CAPABILITY_AUDIT_AND_ROADMAP.md) for verified feature status, remaining restrictions, and next steps. The [Kestrel Project Blueprint](Kestrel_Project_Blueprint.docx) records the original project foundation and has historical feature-status tables.

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

- Keep Kestrel’s monitoring and management work on the local device unless the user explicitly chooses an external connection or export.
- Aim to expose the full practical range of local computer management through supported Linux interfaces; do not impose blanket restrictions on capable features.
- Clearly distinguish implemented features from planned ones.
- Before sensitive changes, explain what will change, which users or devices are affected, and the likely consequences; ask for confirmation and use normal operating-system authorization where required.
- Match safeguards to the impact of an action, and support recovery or reversal where the system allows it.
- Keep background work proportional to the active view.
- Prefer Linux-native interfaces and report unavailable readings honestly.
