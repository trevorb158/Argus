# Kestrel Capability Audit and Roadmap

**Purpose:** record what Kestrel can do today, identify capability gaps and app-imposed restrictions, and guide the next stages toward a broad local workstation utility.

**Status date:** 20 October 2026  
**Audited revision:** `fd7fb2c` (`Document full local management principles`)  
**Primary target:** Pop!_OS 24.04 LTS, with Linux as the product platform  
**Current app identity:** Kestrel, `com.trevor.kestrel`

## Decision and product direction

Kestrel is intended to become a capable local control center for the user's computer. The product should expose the full practical range of monitoring, configuration, maintenance, and management that Linux and the device support. A capability should not be omitted solely because it changes system state, needs administrator rights, or carries risk.

Sensitive actions must tell the user what will change, which device, service, account, file, or connection is affected, what could go wrong, and whether the change can be reversed. Kestrel must ask for clear confirmation and use Linux's normal authorization mechanisms when required. Higher impact actions need stronger preflight and confirmation. Where Linux or hardware makes an operation impossible or unavailable, Kestrel should explain that specific reason rather than presenting an unexplained disabled control.

Monitoring and management are local by default. Kestrel must not upload telemetry, usage history, device identifiers, logs, or diagnostics. Features that inherently contact an outside service, such as downloading software or package metadata, must make the connection explicit, show its purpose, and run only when the user starts that operation. The product remains AI-free unless the owner changes that decision.

This audit is the current source of truth for feature status and product direction. The original [Kestrel Project Blueprint](../Kestrel_Project_Blueprint.docx) remains useful for its initial architecture and background, but its early feature tables, non-goals, current-prototype section, and recommended next feature are historical and must not be used as the current implementation status.

## What is in Kestrel today

The following capabilities are present in the code at the audited revision. A listed feature is not a claim of complete hardware or distribution coverage; behavior still depends on Linux, desktop services, permissions, and the device.

| Area | Current behavior |
|---|---|
| Overview | Shows current CPU and memory use, a bounded activity history, the highest available temperature, and storage summaries. |
| Performance | Shows total and per-logical-processor CPU activity, memory and swap use, disk read/write rates, and selectable 5, 15, and 30 minute history. History is in memory. |
| Processes | Lists processes with CPU, memory, parent, state, runtime, and disk I/O details; supports searching, sorting, state filters, a process tree, normal End, and confirmed Force stop. A process must still match its listed PID, name, and start time before Kestrel signals it. Linux permissions can prevent signaling another account's or a system process. |
| Storage | Shows mounted-volume usage; discovers partitions and mount points; uses UDisks for user-confirmed mount and unmount; reads cached SMART health via UDisks when available. SMART self-tests, filesystem repair, formatting, partition creation, and partition deletion are not implemented. |
| Network | Shows local interface addresses and traffic rates, the configured default route, and resolver addresses. It is an observer today: it does not connect/disconnect Wi-Fi, change IP/DNS/routes, or manage firewall rules. |
| Startup | Lists local XDG user autostart entries and can enable or disable eligible user-owned entries after confirmation. System-wide startup entries are not editable through Kestrel. |
| Services | Lists system and user systemd services, filters service states, refreshes status, shows recent service logs, and offers start, stop, enable, or disable for listed services after a consequence-specific confirmation. The former application-level service denylist has been removed; systemd and Linux authorization decide whether a requested action can run. |
| System information | Shows OS/kernel, processor, memory, architecture, host/session information, uptime, battery charge, battery health estimate and cycle count when exported by Linux, and USB device metadata. USB serial numbers and device contents are not read. |
| Sensors | Shows temperature sensors and critical limits when the kernel exposes them. It does not control fan curves, GPU power, or other firmware controls. |
| Recent Logs | Reads recent journal entries from the current boot, supports time/severity/search filtering, can export the filtered view to a user-selected local file, and can show recent logs for a selected service. Logs are not edited or deleted. |
| Maintenance | Scans a user-selected folder for large files and reports cache sizes. It can clear an eligible top-level folder inside the current user's `~/.cache`. It reports `/var/log` and journal disk usage but does not clean them. |
| Diagnostics | Collects a local support summary, previews it, and saves it only after the user selects a location. |
| Settings | Stores local display preferences, including temperature unit and chart range. |

## Earlier assumptions and how they changed

The original blueprint described the project at its first prototype stage. Its assumptions should be read as a record of that stage, not as permanent product limits.

| Earlier assumption or limit | Current interpretation |
|---|---|
| Kestrel would not replace package managers, system settings, or specialist repair tools. | Superseded as a product boundary. Kestrel should become a unified front end for the useful local capabilities those tools provide. It should call native services and tools rather than reimplementing package, disk, or network engines without need. |
| No silent process termination, automatic file deletion, or unattended system changes. | Still valid as a consent rule, not a capability ban. Kestrel can end processes and should gain file and system cleanup actions when the user selects targets and confirms the consequences. Background automatic changes remain off unless separately configured by the user. |
| Processes, network, startup, services, sensors, maintenance, and diagnostics were planned or placeholders. | Much of that scope now exists: live processes and force stop, network observation, user startup control, user and system service control, sensor readings, cache clearing, log viewing/export, diagnostics export, and more. The remaining write controls are itemized below. |
| Storage initially showed mounted volumes only. | Superseded by partition discovery, UDisks mount/unmount, and cached SMART status. Partition creation, formatting, checking/repair, encryption, and active SMART tests remain gaps. |
| System/user services would start with status and carefully scoped controls. | Expanded to confirmed controls in both scopes. A later hard-coded system-service deny list still blocks some units and now conflicts with the full-control direction. |
| The first release would target Pop!_OS and make no promise of identical behavior on every distribution. | Still valid as a delivery sequence. Pop!_OS remains the first verification target, but feature detection and additional Linux distributions are part of the longer-term plan, not a permanent non-goal. |
| Only the current temperature, CPU, and memory snapshot mattered; persistent history and broader maintenance could wait. | The app now includes bounded in-memory performance history, per-core/disk metrics, more sensors, logs, and maintenance. Keep local storage bounded and user-controlled; add persistence only with clear retention and deletion controls. |

## Capability restrictions and missing controls

Some boundaries below are deliberate safety checks. Others are temporary implementation limits or features not yet built. The distinction matters: safeguards should make an action informed, not arbitrarily remove it.

### App-imposed blocks to review and expand

1. **Service impact visibility remains incomplete.** The former hard-coded denylist (including systemd, Polkit, UDisks, NetworkManager, Wi-Fi, display managers, SSH, firewall, storage, and login services) has been removed. Each service action now requires confirmation and the dialog calls out known effects for common critical service groups; system-wide actions use normal Linux authorization. These warnings are practical guidance, not a complete dependency analysis. A later improvement should inspect reverse dependencies and explain the exact units systemd will also affect before confirmation.

2. **System-wide startup entries are read-only.** The toggle command only edits a user-owned `.desktop` entry under the current account's autostart folder. Add system-wide entry inspection and editing via a narrow privileged operation with a before/after preview, backup, confirmation, authorization, and rollback.

3. **Process signaling has no authorization retry.** Normal End and Force stop use the current process credentials. If Linux denies a signal, Kestrel reports that elevated rights may be needed but cannot request them itself. Add a permission-aware route for an explicitly selected process and show that force stop prevents the app from saving data. Preserve the PID/name/start-time revalidation. Never allow Kestrel to signal itself or PID 1; these are functional invariants, not ordinary user-target controls.

4. **Storage excludes important operations.** The backend refuses to unmount active swap and system-critical mounts and has no partition create/delete, filesystem format, repair/check, encryption, or SMART self-test controls. It should support the operations Linux and UDisks permit, with a clear target-device identity, data-loss consequences, dependency checks, authorization, and a strong confirmation (for example, re-entering the device or volume label before formatting). A root filesystem that is actively in use cannot be safely unmounted from the running system; explain the OS constraint and offer a recovery/live-system path instead of pretending a force option can make it safe.

5. **Cache cleanup is bound to one narrow location.** It can clear only one eligible top-level directory inside the current account's `~/.cache`; it does not allow selecting arbitrary cache folders or system-wide cache cleanup. Keep the path and symlink checks, but broaden the user-selected scope deliberately, preview exactly what will be removed, and use Trash/recovery where possible. System-wide cleanup must use authorization and identify the affected accounts and apps.

6. **Large-file search cannot act on its results.** It reads metadata in a chosen folder and returns up to 250 results. It stops after 100,000 entries or 20 seconds. It cannot move, trash, or delete results. Add selection and actions with full-path/size preview, default to recoverable Trash when supported, and let users choose a workload limit or continue a bounded scan. Keep a cancel/progress path for long scans.

7. **Logs are view/export only.** The general view requests 300 entries from the current boot; each service view requests 100. Kestrel cannot select a time interval at the source, browse older boots, journalctl across accounts, vacuum/rotate journal data, or clear log files. Keep display filters, make source query/paging user-controlled, and add privileged log maintenance only with an explicit retention preview and confirmation.

8. **Hardware inventory omits sensitive or unsupported details.** USB serial numbers are intentionally omitted, and GPU/fan/firmware controls are not implemented. Provide an explicit local-only opt-in for serial identifiers where hardware exposes them. Add hardware controls only through reliable, device-supported interfaces, with a visible warning that firmware-level changes can affect cooling, stability, battery life, or warranty.

### Capabilities not implemented yet

These are product gaps, not statements that Kestrel should never provide them:

- **Software and packages:** list installed applications/packages; search available repositories; install, update, downgrade, and remove packages; manage Flatpak/Snap if present; show transaction plans, dependencies, download sources, progress, cancellation, and rollback where supported.
- **Network configuration:** connect/disconnect Wi-Fi and VPN profiles; inspect saved connections; configure IP, DNS, routes, proxy, and hotspot settings; manage firewall rules. Warn before changing a live route or disconnecting the connection used to reach the device.
- **Storage administration:** create/delete partitions, format and label filesystems, check/repair filesystems, manage encryption and swap, eject removable devices, run supported SMART self-tests, and safely handle mounted/open volumes.
- **System and session controls:** reboot, shut down, suspend, hibernate, lock/sign out, change power profile, and schedule a maintenance restart, all through the system session manager and with explicit user intent.
- **Accounts and permissions:** inspect/manage local users, groups, memberships, login sessions, file ownership and permissions, and credential/key stores. Clearly show inheritance and recursive scope before changing permissions.
- **Startup and jobs:** system-wide startup applications, scheduled jobs/timers, login/session services, and dependencies that explain why a service starts or what depends on it.
- **Hardware and peripherals:** Bluetooth pairing/connection, printers/scanners, audio devices, display configuration, GPU inventory and utilization, firmware/driver updates where available, fan controls where supported, and richer battery/power details.
- **Maintenance and recovery:** selected temporary-file cleanup, package cache and old-kernel management, log retention/rotation, backup/restore, recovery snapshots, and an action history with undo guidance.
- **Platform breadth:** supported distributions and desktop environments beyond the primary Pop!_OS workstation; feature detection and clear fallbacks rather than assumptions that every Linux host uses the same package manager or service manager.

## Safeguard policy

Kestrel should not treat “system-wide,” “requires administrator permission,” or “potentially disruptive” as automatic reasons to remove a control. Use an escalating action flow:

| Action level | Examples | Kestrel behavior |
|---|---|---|
| Read-only | Inspect processes, temperatures, package inventory, SMART status | Show immediately; label data source, scope, and missing readings. |
| Reversible local change | Change a user preference, enable a user startup entry | Explain what changes; confirm where the change could surprise the user; show success/failure and reversal. |
| Privileged or disruptive change | Stop a system service, change DNS, modify system startup, signal another user's process | State exact target, scope, dependencies and consequence; require explicit confirmation; request normal Linux authorization; show result. |
| Destructive or hard to reverse | Format a filesystem, delete a partition, recursively change ownership, purge logs | Provide a preflight and exact target summary; recommend backup when relevant; require a second deliberate confirmation; show an operation record and recovery guidance. |

Use a small privileged helper or well-defined OS APIs for administrative work. Do not run the whole desktop application as root. Never construct shell command strings from user input; validate structured arguments and pass arguments directly to child processes or use a native API. Let Polkit or the relevant desktop/system service request authentication. If authorization is denied, explain it and allow the user to retry; do not silently fall back to a weaker action.

Keep technical and race-condition safeguards: validate the exact target again just before acting, reject malformed identifiers, avoid following unsafe symlinks, show canonical paths, and report OS/hardware limitations. Keep the process self/PID 1 guards. For disk/partition operations, verify identity and mount dependencies immediately before changes. Record successful local state-changing operations in an on-device history without logging secrets.

## Prioritized delivery roadmap

Deliver one tested vertical slice and one Git commit at a time. Update this document whenever a capability, permission model, or priority changes. This is a rolling roadmap; later phases can be reordered as we learn more from the target workstation.

### 1. Replace hard-coded privilege blocks with an informed action system

- [x] Remove the app-level protected system-service deny list and offer the available systemd actions with confirmation.
- [x] Add tailored consequence notices for common network, graphical-session, remote-access, firewall, storage, and core services.
- [ ] Add exact dependency and cascading-action previews from systemd before service changes.
- Add per-action scope/risk descriptions, confirmation, Polkit authorization, progress, cancellation where supported, and actionable errors.
- Add system-wide startup controls and an elevated process-signal retry.
- Add an operation history with timestamp, action, target, result, and recovery guidance; omit sensitive command arguments and secrets.
- Keep OS impossibilities and Kestrel self-protection as explicit invariants.

### 2. Complete software management

- Start with installed software inventory and update availability.
- Implement one native backend first for the primary Pop!_OS/Ubuntu package system; detect other package managers rather than assuming them.
- Add explicit install/remove/update transactions with dependency and download preview, progress, cancel support, and clear local/network boundaries.
- Add Flatpak/Snap only after the first package path is reliable.

### 3. Complete storage management

- Add per-device operation plans and a clear whole-disk/partition tree.
- Add create/delete/format/label/check/repair and encryption workflows through UDisks or the appropriate native tools.
- Add SMART self-tests and show test progress/results.
- Protect currently mounted/in-use targets through dependency checks, not a generic “protected” label; explain when an operation must run from recovery media.

### 4. Add network and security controls

- Manage NetworkManager connections and Wi-Fi through its local API, with before/after route details.
- Add VPN, DNS, static IP, route, proxy, hotspot, and firewall controls.
- Warn if a change can drop the current session or expose/restrict network access; offer an automatic rollback timer for risky remote network changes.

### 5. Expand maintenance and recovery

- Add user-selected cleanup targets, Trash/recovery, temporary files, logs, package caches, and old kernels with previews.
- Add backup creation/verification and restore flows before broader destructive operations.
- Replace fixed scan/log caps with visible settings, pagination, progress, and cancellation while retaining a safe workload default.

### 6. Add system, account, power, and peripheral management

- Implement power/session controls and profiles through systemd-logind or the desktop power service.
- Add local user/group and file-permission management with recursive scope preview.
- Add Bluetooth, printer, audio, display, and supported firmware/device controls as individually tested modules.

### 7. Make Kestrel dependable across Linux desktops

- Refactor the prototype's large `src/App.tsx` and `src-tauri/src/lib.rs` into page/features and backend capability modules before the codebase becomes harder to maintain.
- Keep hardware and distribution differences behind detected adapters; report unsupported features cleanly.
- Add automated Rust, frontend, command-contract, and operation-flow checks. Continue manual verification on Pop!_OS for Polkit, UDisks, systemd, and desktop integration.
- Verify packaging, install/upgrade/uninstall, settings backup, and recovery on a clean user account before release.

## Per-feature completion standard

Every addition should record its purpose, local data source, capability gained, privilege requirements, risks, and any new limit. Implement the backend action and frontend affordance together. Include loading, unavailable, denied, cancelled, success, and failure outcomes. For changes, provide a preview and the right confirmation level. Keep capability checks close to the action, revalidate targets, and add undo or recovery steps where feasible. Check the frontend build and Rust compile, run relevant automated checks as they are added, launch on the target system for user verification, then record the result in this roadmap and make a focused commit.

## Project history at a glance

The work so far has grown Kestrel from a Tauri telemetry prototype into pages for performance, process management, storage, networking, startup, services, system information, sensors, diagnostics, recent logs, and maintenance. Git commits added process hierarchy and controls, disk activity, partition mount controls, cache cleanup, log viewing/export/filtering, system and user service control, SMART health, service-specific logs, network route/IP/DNS details, battery health, USB inventory, and the full-local-control product principle. The commit history is the detailed implementation record; this section summarizes feature direction rather than replacing it.

