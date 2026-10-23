# Argus

Argus is a local-first Linux workstation utility built with Tauri 2, React, TypeScript, and Rust. It brings system monitoring, process management, storage, hardware information, maintenance, and diagnostics into one clear desktop app. Argus is intentionally AI-free.

## Features

### Overview

- Live CPU and memory readings
- Highest available hardware temperature, or a clear indication when sensors are unavailable
- Storage summary panel

### Performance

- Per-logical-processor load
- Swap usage
- Bounded in-memory performance chart with 5, 15, and 30 minute views

### Processes

- Live CPU, memory, and per-process disk I/O rates
- Search, sorting, and process state/parent/runtime details
- Separately confirmed normal End and Force stop actions
- When Linux denies a signal, Argus can request administrator authorization after another confirmation and rechecks the exact process identity (requires a root-owned installed binary; unavailable in development builds)
- Process data refreshes only while the page is open

### Storage

- Mounted-volume capacity
- Physical-drive health reported by UDisks
- Partition discovery with user-confirmed UDisks mount and unmount controls
- Refreshes every five seconds

### Network

- Live interface rates and local addresses
- Configured default route and DNS resolver settings

### Startup

- Lists local login applications
- Enables or disables user entries directly, or overrides system defaults for the current account
- Shared system files remain unchanged

### Services

- System and user systemd status
- Read-only recent journal view for each service
- Eligible services can be started, stopped, enabled, or disabled after confirmation; system-wide actions may require administrator authorization
- Explains known risks and previews systemd-reported related units before actions; systemd decides whether each action can run

### System Information

- Local operating system, kernel, processor, memory, device architecture, desktop session, and uptime
- Battery charge, estimated full-capacity health, and charge cycles
- Read-only USB device inventory when Linux exposes it (excludes serial numbers and does not inspect device contents)

### Activity

- Local history of process, service, startup, storage mount, and cache cleanup actions, with timestamps and outcomes

### Diagnostics

- Builds a local support summary
- Previews contents and saves only after the user chooses a location

### Maintenance

- Scans a chosen folder for large files
- Reports application cache sizes
- Supports explicit per-folder cleanup within the current account's cache directory
- Summarizes local log and journal disk usage without reading log contents

### Settings

- Local display preferences for temperature units and the default performance-chart time range

See [the capability audit and roadmap](docs/CAPABILITY_AUDIT_AND_ROADMAP.md) for verified feature status, remaining restrictions, and next steps. The [Argus Project Blueprint](Kestrel_Project_Blueprint.docx) (originally recorded as the Kestrel Project Blueprint) preserves the original project foundation and historical feature-status tables.

## Run on Linux

Install the Tauri Linux prerequisites for your distribution, then from this folder run:

```bash
npm install
npm run tauri dev
```
