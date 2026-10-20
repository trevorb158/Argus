# Kestrel

Kestrel is a local-first Linux workstation utility built with Tauri 2, React, TypeScript, and Rust. The goal is to bring system monitoring, process management, storage, hardware information, maintenance, and diagnostics into one clear desktop app. Kestrel is intentionally AI-free.

## Current prototype

The current working prototype provides live CPU and memory readings, a bounded in-memory CPU and memory history chart with 5, 15, and 30 minute views, and mounted-volume usage. Storage refreshes less often than CPU and memory telemetry. Temperature is still a placeholder, and the Storage, Processes, and Settings navigation entries are not yet full pages. See [Kestrel Project Blueprint](Kestrel_Project_Blueprint.docx) for product direction, architecture, safety principles, current limitations, and roadmap.

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
