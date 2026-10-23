use std::collections::BTreeMap;
use std::env;
use std::fs::{self, OpenOptions};
use std::io::Write;
#[cfg(target_os = "linux")]
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sysinfo::{Components, Disks, Networks, Pid, ProcessRefreshKind, ProcessesToUpdate, Signal, System};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CoreUsageSnapshot {
    name: String,
    usage_percent: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PerformanceSnapshot {
    cpu_usage_percent: f32,
    cores: Vec<CoreUsageSnapshot>,
    memory_used_bytes: u64,
    memory_available_bytes: u64,
    memory_total_bytes: u64,
    swap_used_bytes: u64,
    swap_total_bytes: u64,
    disk_read_bytes_per_second: u64,
    disk_write_bytes_per_second: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TelemetrySnapshot {
    cpu_usage_percent: f32,
    memory_used_bytes: u64,
    memory_total_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BatterySnapshot {
    name: String,
    capacity_percent: Option<u8>,
    status: Option<String>,
    health_percent: Option<u8>,
    cycle_count: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UsbDeviceSnapshot {
    path: String,
    manufacturer: Option<String>,
    product: Option<String>,
    vendor_id: String,
    product_id: String,
    bus_number: Option<String>,
    device_number: Option<String>,
    speed: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemInfoSnapshot {
    operating_system: String,
    kernel_version: Option<String>,
    host_name: Option<String>,
    architecture: String,
    processor: Option<String>,
    logical_processors: usize,
    physical_cores: Option<usize>,
    memory_total_bytes: u64,
    uptime_seconds: u64,
    desktop_environment: Option<String>,
    session_type: Option<String>,
    batteries: Vec<BatterySnapshot>,
    usb_devices: Vec<UsbDeviceSnapshot>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsSnapshot {
    operating_system: String,
    kernel_version: Option<String>,
    architecture: String,
    processor: Option<String>,
    logical_processors: usize,
    physical_cores: Option<usize>,
    cpu_usage_percent: f32,
    memory_used_bytes: u64,
    memory_total_bytes: u64,
    uptime_seconds: u64,
    desktop_environment: Option<String>,
    session_type: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemLogEntry {
    timestamp_micros: u64,
    source: String,
    severity: String,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TemperatureSnapshot {
    label: String,
    temperature_celsius: f32,
    critical_celsius: Option<f32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GpuSnapshot {
    name: String,
    utilization_percent: f32,
    vram_used_bytes: u64,
    vram_total_bytes: u64,
    temperature_celsius: Option<f32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FanSnapshot {
    label: String,
    rpm: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HardwareExtraSnapshot {
    gpus: Vec<GpuSnapshot>,
    fans: Vec<FanSnapshot>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DriveSnapshot {
    name: String,
    mount_point: String,
    file_system: String,
    total_bytes: u64,
    available_bytes: u64,
    is_removable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DriveHealthSnapshot {
    path: String,
    model: String,
    smart_supported: Option<bool>,
    health_state: String,
    temperature_celsius: Option<f32>,
    power_on_hours: Option<u64>,
    bad_sectors: Option<u64>,
    attributes_failing: Option<u64>,
    smart_updated_unix_seconds: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceSnapshot {
    unit: String,
    description: String,
    scope: String,
    active_state: String,
    sub_state: String,
    startup_state: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceInventory {
    services: Vec<ServiceSnapshot>,
    warnings: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceActionPreview {
    relationship: String,
    related_units: Vec<String>,
    total_units: usize,
    truncated: bool,
    note: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupAppSnapshot {
    id: String,
    name: String,
    command: String,
    source: String,
    enabled: bool,
    is_system_entry: bool,
    has_user_override: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NetworkInterfaceSnapshot {
    name: String,
    mac_address: String,
    ip_addresses: Vec<String>,
    received_bytes: u64,
    transmitted_bytes: u64,
    is_loopback: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NetworkRouteSnapshot {
    default_gateway: Option<String>,
    default_interface: Option<String>,
    dns_servers: Vec<String>,
    gateway_error: Option<String>,
    dns_error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NetworkConnectionSnapshot {
    protocol: String,
    state: String,
    local_address: String,
    remote_address: String,
    process: String,
    pid: Option<u32>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PackageSnapshot {
    name: String,
    version: String,
    architecture: String,
    status: String,
    section: String,
    installed_size_bytes: Option<u64>,
    summary: String,
    automatic: bool,
    upgrade_version: Option<String>,
    source: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PackageInventory {
    backend: String,
    backend_detail: String,
    packages: Vec<PackageSnapshot>,
    warnings: Vec<String>,
    last_index_unix_seconds: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PartitionSnapshot {
    name: String,
    path: String,
    device_type: String,
    file_system: Option<String>,
    label: Option<String>,
    size_bytes: u64,
    mount_points: Vec<String>,
    is_removable: bool,
}

#[derive(Deserialize)]
struct LsblkOutput {
    blockdevices: Vec<LsblkDevice>,
}

#[derive(Deserialize)]
struct LsblkDevice {
    name: String,
    path: Option<String>,
    #[serde(rename = "type")]
    device_type: String,
    fstype: Option<String>,
    label: Option<String>,
    size: Option<u64>,
    mountpoints: Option<Vec<Option<String>>>,
    rm: Option<bool>,
    #[serde(default)]
    children: Vec<LsblkDevice>,
}

fn collect_partitions(devices: Vec<LsblkDevice>, output: &mut Vec<PartitionSnapshot>) {
    for device in devices {
        let mount_points = device
            .mountpoints
            .unwrap_or_default()
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        let include_device = device.device_type == "part"
            || (device.fstype.as_ref().is_some_and(|fs| !fs.is_empty())
                && device.device_type == "disk");

        if include_device {
            output.push(PartitionSnapshot {
                name: device.name,
                path: device.path.unwrap_or_default(),
                device_type: device.device_type,
                file_system: device.fstype,
                label: device.label,
                size_bytes: device.size.unwrap_or_default(),
                mount_points,
                is_removable: device.rm.unwrap_or(false),
            });
        }

        collect_partitions(device.children, output);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LargeFileSnapshot {
    path: String,
    size_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LargeFileScanResult {
    root: String,
    files: Vec<LargeFileSnapshot>,
    scanned_entries: usize,
    skipped_entries: usize,
    scan_limited: bool,
    results_limited: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheEntrySnapshot {
    name: String,
    size_bytes: u64,
    file_count: u64,
    clearable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheInventorySnapshot {
    entries: Vec<CacheEntrySnapshot>,
    total_bytes: u64,
    files_scanned: u64,
    skipped_entries: usize,
    scan_limited: bool,
    available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LogFileSnapshot {
    path: String,
    size_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LogInventorySnapshot {
    files: Vec<LogFileSnapshot>,
    log_bytes: u64,
    scanned_entries: usize,
    skipped_entries: usize,
    scan_limited: bool,
    log_directory_available: bool,
    log_error: Option<String>,
    journal_usage: Option<String>,
    journal_error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessSnapshot {
    pid: u32,
    name: String,
    start_time: u64,
    parent_pid: Option<u32>,
    status: String,
    run_time_seconds: u64,
    cpu_usage_percent: f32,
    memory_bytes: u64,
    disk_read_total_bytes: u64,
    disk_write_total_bytes: u64,
}

struct TelemetryState(Mutex<System>);

struct DiskActivityState {
    disks: Disks,
    last_sample: Instant,
}

struct DiskActivity(Mutex<DiskActivityState>);

#[tauri::command]
fn get_telemetry(
    state: tauri::State<'_, TelemetryState>,
) -> Result<TelemetrySnapshot, String> {
    let mut system = state
        .0
        .lock()
        .map_err(|_| "Telemetry state is unavailable".to_string())?;

    system.refresh_cpu_usage();
    system.refresh_memory();

    Ok(TelemetrySnapshot {
        cpu_usage_percent: system.global_cpu_usage(),
        memory_used_bytes: system.used_memory(),
        memory_total_bytes: system.total_memory(),
    })
}

#[tauri::command]
fn get_performance_snapshot(
    state: tauri::State<'_, TelemetryState>,
    disk_activity: tauri::State<'_, DiskActivity>,
) -> Result<PerformanceSnapshot, String> {
    let mut system = state
        .0
        .lock()
        .map_err(|_| "Performance information is unavailable".to_string())?;
    system.refresh_cpu_usage();
    system.refresh_memory();
    let cores = system
        .cpus()
        .iter()
        .enumerate()
        .map(|(index, cpu)| CoreUsageSnapshot {
            name: format!("CPU {}", index + 1),
            usage_percent: cpu.cpu_usage(),
        })
        .collect();

    let mut disk_state = disk_activity
        .0
        .lock()
        .map_err(|_| "Disk activity information is unavailable".to_string())?;
    disk_state.disks.refresh(false);
    let elapsed_seconds = disk_state.last_sample.elapsed().as_secs_f64().max(0.001);
    let mut read_bytes = 0u64;
    let mut written_bytes = 0u64;
    let mut seen_devices = std::collections::BTreeSet::new();
    for disk in disk_state.disks.list() {
        if seen_devices.insert(disk.name().to_os_string()) {
            let usage = disk.usage();
            read_bytes = read_bytes.saturating_add(usage.read_bytes);
            written_bytes = written_bytes.saturating_add(usage.written_bytes);
        }
    }
    disk_state.last_sample = Instant::now();

    Ok(PerformanceSnapshot {
        cpu_usage_percent: system.global_cpu_usage(),
        cores,
        memory_used_bytes: system.used_memory(),
        memory_available_bytes: system.available_memory(),
        memory_total_bytes: system.total_memory(),
        swap_used_bytes: system.used_swap(),
        swap_total_bytes: system.total_swap(),
        disk_read_bytes_per_second: (read_bytes as f64 / elapsed_seconds) as u64,
        disk_write_bytes_per_second: (written_bytes as f64 / elapsed_seconds) as u64,
    })
}

fn read_battery_status() -> Vec<BatterySnapshot> {
    let Ok(entries) = fs::read_dir("/sys/class/power_supply") else {
        return Vec::new();
    };

    entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let supply_type = fs::read_to_string(path.join("type")).ok()?;
            if supply_type.trim() != "Battery" {
                return None;
            }
            let capacity_percent = fs::read_to_string(path.join("capacity"))
                .ok()
                .and_then(|value| value.trim().parse::<u8>().ok())
                .filter(|value| *value <= 100);
            let status = fs::read_to_string(path.join("status"))
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
            let full_capacity = read_power_supply_value(&path, &["energy_full", "charge_full"]);
            let design_capacity = read_power_supply_value(&path, &["energy_full_design", "charge_full_design"]);
            let health_percent = full_capacity.zip(design_capacity).and_then(|(full, design)| {
                (design > 0).then(|| ((full as f64 / design as f64 * 100.0).round() as u64).min(150) as u8)
            });
            let cycle_count = fs::read_to_string(path.join("cycle_count"))
                .ok()
                .and_then(|value| value.trim().parse::<u32>().ok());
            Some(BatterySnapshot {
                name: entry.file_name().to_string_lossy().into_owned(),
                capacity_percent,
                status,
                health_percent,
                cycle_count,
            })
        })
        .collect()
}

fn read_power_supply_value(path: &Path, candidates: &[&str]) -> Option<u64> {
    candidates.iter().find_map(|name| {
        fs::read_to_string(path.join(name)).ok()?.trim().parse::<u64>().ok()
    })
}

fn read_usb_devices() -> Vec<UsbDeviceSnapshot> {
    let Ok(entries) = fs::read_dir("/sys/bus/usb/devices") else { return Vec::new() };
    let mut devices = entries.filter_map(Result::ok).filter_map(|entry| {
        let path = entry.path();
        let read = |name: &str| fs::read_to_string(path.join(name)).ok().map(|value| value.trim().to_string()).filter(|value| !value.is_empty());
        let vendor_id = read("idVendor")?;
        let product_id = read("idProduct")?;
        Some(UsbDeviceSnapshot {
            path: entry.file_name().to_string_lossy().into_owned(),
            manufacturer: read("manufacturer"),
            product: read("product"),
            vendor_id,
            product_id,
            bus_number: read("busnum"),
            device_number: read("devnum"),
            speed: read("speed"),
        })
    }).collect::<Vec<_>>();
    devices.sort_by(|a, b| a.path.cmp(&b.path));
    devices
}

#[tauri::command]
fn get_system_info(state: tauri::State<'_, TelemetryState>) -> Result<SystemInfoSnapshot, String> {
    let system = state
        .0
        .lock()
        .map_err(|_| "System information is unavailable".to_string())?;
    let processor = system
        .cpus()
        .first()
        .map(|cpu| cpu.brand().trim().to_string())
        .filter(|brand| !brand.is_empty());

    Ok(SystemInfoSnapshot {
        operating_system: System::long_os_version()
            .or_else(System::name)
            .unwrap_or_else(|| "Linux".to_string()),
        kernel_version: System::kernel_version(),
        host_name: System::host_name(),
        architecture: env::consts::ARCH.to_string(),
        processor,
        logical_processors: system.cpus().len(),
        physical_cores: System::physical_core_count(),
        memory_total_bytes: system.total_memory(),
        uptime_seconds: System::uptime(),
        desktop_environment: env::var("XDG_CURRENT_DESKTOP").ok().filter(|value| !value.is_empty()),
        session_type: env::var("XDG_SESSION_TYPE").ok().filter(|value| !value.is_empty()),
        batteries: read_battery_status(),
        usb_devices: read_usb_devices(),
    })
}

#[tauri::command]
fn get_diagnostics_snapshot(
    state: tauri::State<'_, TelemetryState>,
) -> Result<DiagnosticsSnapshot, String> {
    let mut system = state
        .0
        .lock()
        .map_err(|_| "Diagnostics information is unavailable".to_string())?;
    system.refresh_cpu_usage();
    system.refresh_memory();
    let processor = system
        .cpus()
        .first()
        .map(|cpu| cpu.brand().trim().to_string())
        .filter(|brand| !brand.is_empty());

    Ok(DiagnosticsSnapshot {
        operating_system: System::long_os_version()
            .or_else(System::name)
            .unwrap_or_else(|| "Linux".to_string()),
        kernel_version: System::kernel_version(),
        architecture: env::consts::ARCH.to_string(),
        processor,
        logical_processors: system.cpus().len(),
        physical_cores: System::physical_core_count(),
        cpu_usage_percent: system.global_cpu_usage(),
        memory_used_bytes: system.used_memory(),
        memory_total_bytes: system.total_memory(),
        uptime_seconds: System::uptime(),
        desktop_environment: env::var("XDG_CURRENT_DESKTOP").ok().filter(|value| !value.is_empty()),
        session_type: env::var("XDG_SESSION_TYPE").ok().filter(|value| !value.is_empty()),
    })
}

#[tauri::command]
fn save_text_file(path: String, contents: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if path.extension().and_then(|extension| extension.to_str()) != Some("txt") {
        return Err("Choose a .txt file".to_string());
    }
    fs::write(&path, contents).map_err(|error| format!("Could not save the text file: {error}"))
}

fn parse_desktop_entry(path: &Path, source: &str) -> Result<StartupAppSnapshot, String> {
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let mut in_desktop_entry = false;
    let mut name = None;
    let mut command = None;
    let mut hidden = false;
    let mut gnome_enabled = true;

    for line in contents.lines().map(str::trim) {
        if line.starts_with('[') && line.ends_with(']') {
            in_desktop_entry = line == "[Desktop Entry]";
            continue;
        }
        if !in_desktop_entry || line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(value) = line.strip_prefix("Name=") {
            name = Some(value.to_string());
        } else if let Some(value) = line.strip_prefix("Exec=") {
            command = Some(value.to_string());
        } else if let Some(value) = line.strip_prefix("Hidden=") {
            hidden = value.eq_ignore_ascii_case("true");
        } else if let Some(value) = line.strip_prefix("X-GNOME-Autostart-enabled=") {
            gnome_enabled = !value.eq_ignore_ascii_case("false");
        }
    }

    let id = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string();
    let fallback_name = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("Unnamed application")
        .to_string();

    Ok(StartupAppSnapshot {
        id,
        name: name.filter(|name| !name.is_empty()).unwrap_or(fallback_name),
        command: command.unwrap_or_default(),
        source: source.to_string(),
        enabled: !hidden && gnome_enabled,
        is_system_entry: source == "System",
        has_user_override: false,
    })
}

fn read_autostart_directory(
    directory: &Path,
    source: &str,
    entries: &mut BTreeMap<String, StartupAppSnapshot>,
    replace_existing: bool,
) -> Result<(), String> {
    if !directory.exists() {
        return Ok(());
    }
    let files = fs::read_dir(directory)
        .map_err(|error| format!("Could not read {}: {error}", directory.display()))?;
    for file in files {
        let file = file.map_err(|error| format!("Could not inspect {}: {error}", directory.display()))?;
        let path = file.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("desktop") {
            continue;
        }
        let entry = parse_desktop_entry(&path, source)?;
        if replace_existing || !entries.contains_key(&entry.id) {
            entries.insert(entry.id.clone(), entry);
        }
    }
    Ok(())
}

fn run_systemctl(user_scope: bool, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("systemctl");
    if user_scope {
        command.arg("--user");
    }
    let output = command
        .args(args)
        .output()
        .map_err(|error| format!("Could not start systemctl: {error}"))?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if error.is_empty() {
            format!("systemctl exited with status {}", output.status)
        } else {
            error
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn query_service_scope(user_scope: bool, scope: &str) -> Result<Vec<ServiceSnapshot>, String> {
    let active_units = run_systemctl(
        user_scope,
        &["list-units", "--type=service", "--all", "--no-legend", "--plain", "--no-pager"],
    )?;
    let unit_files = run_systemctl(
        user_scope,
        &["list-unit-files", "--type=service", "--no-legend", "--no-pager"],
    )?;
    let mut services = BTreeMap::<String, ServiceSnapshot>::new();
    let mut alias_units = Vec::new();

    for line in active_units.lines() {
        let fields = line.split_whitespace().collect::<Vec<_>>();
        if fields.len() < 4 {
            continue;
        }
        let unit = fields[0].to_string();
        let key = format!("{scope}:{unit}");
        services.insert(key, ServiceSnapshot {
            unit,
            description: fields[4..].join(" "),
            scope: scope.to_string(),
            active_state: fields[2].to_string(),
            sub_state: fields[3].to_string(),
            startup_state: "unknown".to_string(),
        });
    }

    for line in unit_files.lines() {
        let fields = line.split_whitespace().collect::<Vec<_>>();
        if fields.len() < 2 {
            continue;
        }
        let unit = fields[0].to_string();
        if fields[1] == "alias" {
            alias_units.push(unit.clone());
        }
        let key = format!("{scope}:{unit}");
        let service = services.entry(key).or_insert_with(|| ServiceSnapshot {
            unit: unit.clone(),
            description: unit.clone(),
            scope: scope.to_string(),
            active_state: "inactive".to_string(),
            sub_state: "dead".to_string(),
            startup_state: "unknown".to_string(),
        });
        service.startup_state = fields[1].to_string();
    }

    let query_aliases = alias_units
        .iter()
        .filter(|unit| !unit.contains("@."))
        .collect::<Vec<_>>();
    if !query_aliases.is_empty() {
        let mut command = Command::new("systemctl");
        if user_scope {
            command.arg("--user");
        }
        let alias_output = command
            .args(["show", "--property=Id", "--value"])
            .args(&query_aliases)
            .output();
        if let Ok(output) = alias_output {
            if output.status.success() {
                let targets = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .filter(|line| !line.trim().is_empty())
                    .map(|line| line.trim().to_string())
                    .collect::<Vec<_>>();
                for (alias, target) in query_aliases.iter().zip(targets) {
                    let alias_key = format!("{scope}:{alias}");
                    let target_key = format!("{scope}:{target}");
                    if let Some(target_state) = services.get(&target_key).map(|service| {
                        (service.active_state.clone(), service.sub_state.clone())
                    }) {
                        if let Some(alias_service) = services.get_mut(&alias_key) {
                            alias_service.description = format!("Alias for {target}");
                            alias_service.active_state = target_state.0;
                            alias_service.sub_state = target_state.1;
                        }
                    } else if let Some(alias_service) = services.get_mut(&alias_key) {
                        alias_service.description = "Alias target state unavailable".to_string();
                        alias_service.active_state = "unknown".to_string();
                        alias_service.sub_state.clear();
                    }
                }
            } else {
                for alias in &query_aliases {
                    if let Some(alias_service) = services.get_mut(&format!("{scope}:{alias}")) {
                        alias_service.description = "Alias target state unavailable".to_string();
                        alias_service.active_state = "unknown".to_string();
                        alias_service.sub_state.clear();
                    }
                }
            }
        }
    }

    for alias in alias_units.iter().filter(|unit| unit.contains("@.")) {
        if let Some(alias_service) = services.get_mut(&format!("{scope}:{alias}")) {
            alias_service.description = "Template alias; no instance selected".to_string();
            alias_service.active_state = "unknown".to_string();
            alias_service.sub_state.clear();
        }
    }

    Ok(services.into_values().collect())
}

#[tauri::command]
async fn set_service_state(scope: String, unit: String, action: String) -> Result<(), String> {
    if !unit.ends_with(".service")
        || unit.starts_with('-')
        || !unit.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"@._:-".contains(&byte))
    {
        return Err("Select a valid service from the current list".to_string());
    }
    if !matches!(action.as_str(), "start" | "stop" | "enable" | "disable") {
        return Err("This service action is not supported".to_string());
    }
    let user_scope = match scope.as_str() {
        "User" => true,
        "System" => false,
        _ => return Err("This service scope is not supported".to_string()),
    };
    if !query_service_scope(user_scope, &scope)?.iter().any(|service| service.unit == unit) {
        return Err("That service is no longer in the current service list".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let mut command = Command::new("systemctl");
        if user_scope {
            command.arg("--user");
        }
        let output = command
            .args([action.as_str(), unit.as_str()])
            .output()
            .map_err(|error| format!("Could not start the {scope} service manager: {error}"))?;
        if output.status.success() {
            Ok(())
        } else {
            let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Err(if message.is_empty() {
                format!("The {scope} service manager could not {action} {unit}. Administrator authorization may be required.")
            } else {
                message
            })
        }
    })
    .await
    .map_err(|error| format!("The service operation could not finish: {error}"))?
}

#[tauri::command]
async fn get_service_action_preview(
    scope: String,
    unit: String,
    action: String,
) -> Result<ServiceActionPreview, String> {
    if !unit.ends_with(".service")
        || unit.starts_with('-')
        || !unit.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"@._:-".contains(&byte))
    {
        return Err("Select a valid service from the current list".to_string());
    }
    if !matches!(action.as_str(), "start" | "stop" | "enable" | "disable") {
        return Err("This service action is not supported".to_string());
    }
    let user_scope = match scope.as_str() {
        "User" => true,
        "System" => false,
        _ => return Err("This service scope is not supported".to_string()),
    };

    tauri::async_runtime::spawn_blocking(move || {
        if !query_service_scope(user_scope, &scope)?.iter().any(|service| service.unit == unit) {
            return Err("That service is no longer in the current service list".to_string());
        }

        let relationship = match action.as_str() {
            "start" => "Dependencies that may be started",
            "stop" => "Declared reverse dependencies",
            "enable" | "disable" => "Units linked to this service at startup",
            _ => unreachable!(),
        };

        let output = if action == "enable" || action == "disable" {
            let mut command = Command::new("systemctl");
            if user_scope {
                command.arg("--user");
            }
            command
                .args(["show", "--property=WantedBy,RequiredBy", "--no-pager", unit.as_str()])
                .output()
        } else {
            let mut command = Command::new("systemctl");
            if user_scope {
                command.arg("--user");
            }
            command
                .arg("list-dependencies")
                .args(["--all", "--plain", "--no-pager", "--full"]);
            if action == "stop" {
                command.arg("--reverse");
            }
            command.arg(unit.as_str()).output()
        }
        .map_err(|error| format!("Could not inspect service relationships: {error}"))?;

        if !output.status.success() {
            let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if message.is_empty() {
                format!("The service manager could not inspect relationships for {unit}")
            } else {
                message
            });
        }

        let mut related_units = Vec::new();
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let candidates = if action == "enable" || action == "disable" {
                line.split_once('=').map(|(_, value)| value).unwrap_or("").split_whitespace().map(str::to_string).collect::<Vec<_>>()
            } else {
                let entry = line.trim().trim_start_matches('●').trim();
                entry.split_whitespace().next().map(str::to_string).into_iter().collect()
            };
            for candidate in candidates {
                if candidate != unit
                    && candidate.contains('.')
                    && candidate.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"@._:-".contains(&byte))
                    && !related_units.contains(&candidate)
                {
                    related_units.push(candidate);
                }
            }
        }

        let total_units = related_units.len();
        let limit = 16;
        related_units.truncate(limit);
        Ok(ServiceActionPreview {
            relationship: relationship.to_string(),
            related_units,
            total_units,
            truncated: total_units > limit,
            note: "These are declared relationships reported by systemd. The exact jobs and their outcomes can vary with current unit state, conditions, conflicts, and authorization.".to_string(),
        })
    })
    .await
    .map_err(|error| format!("The service preview could not finish: {error}"))?
}

#[tauri::command]
fn get_services() -> Result<ServiceInventory, String> {
    let (system, user) = std::thread::scope(|scope| {
        let system = scope.spawn(|| query_service_scope(false, "System"));
        let user = scope.spawn(|| query_service_scope(true, "User"));
        (system.join(), user.join())
    });
    let system = system.map_err(|_| "System service query failed unexpectedly".to_string())?;
    let user = user.map_err(|_| "User service query failed unexpectedly".to_string())?;
    let mut warnings = Vec::new();
    let mut services = Vec::new();
    let mut available_scopes = 0;

    match system {
        Ok(mut entries) => {
            available_scopes += 1;
            services.append(&mut entries);
        }
        Err(error) => warnings.push(format!("System services unavailable: {error}")),
    }
    match user {
        Ok(mut entries) => {
            available_scopes += 1;
            services.append(&mut entries);
        }
        Err(error) => warnings.push(format!("User services unavailable: {error}")),
    }

    if available_scopes == 0 {
        return Err(warnings.join(" "));
    }
    services.sort_by(|a, b| a.scope.cmp(&b.scope).then_with(|| a.unit.cmp(&b.unit)));
    Ok(ServiceInventory { services, warnings })
}

fn user_config_directory() -> Option<PathBuf> {
    env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
}

fn system_config_directories() -> Vec<PathBuf> {
    let mut directories = env::var_os("XDG_CONFIG_DIRS")
        .map(|paths| env::split_paths(&paths).collect::<Vec<_>>())
        .unwrap_or_else(|| vec![PathBuf::from("/etc/xdg")]);
    directories.reverse();
    directories
}

fn update_desktop_entry(contents: &str, enabled: bool) -> Result<String, String> {
    let mut lines = Vec::new();
    let mut in_desktop_entry = false;
    let mut found_desktop_entry = false;
    let mut has_hidden = false;
    let mut has_gnome_enabled = false;

    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            if in_desktop_entry {
                if !has_hidden {
                    lines.push(format!("Hidden={}", if enabled { "false" } else { "true" }));
                }
                if !has_gnome_enabled {
                    lines.push(format!("X-GNOME-Autostart-enabled={}", if enabled { "true" } else { "false" }));
                }
            }
            in_desktop_entry = trimmed == "[Desktop Entry]";
            found_desktop_entry |= in_desktop_entry;
            lines.push(line.to_string());
            continue;
        }

        if in_desktop_entry {
            if trimmed.starts_with("Hidden=") {
                lines.push(format!("Hidden={}", if enabled { "false" } else { "true" }));
                has_hidden = true;
                continue;
            }
            if trimmed.starts_with("X-GNOME-Autostart-enabled=") {
                lines.push(format!("X-GNOME-Autostart-enabled={}", if enabled { "true" } else { "false" }));
                has_gnome_enabled = true;
                continue;
            }
        }
        lines.push(line.to_string());
    }

    if in_desktop_entry {
        if !has_hidden {
            lines.push(format!("Hidden={}", if enabled { "false" } else { "true" }));
        }
        if !has_gnome_enabled {
            lines.push(format!("X-GNOME-Autostart-enabled={}", if enabled { "true" } else { "false" }));
        }
    }
    if !found_desktop_entry {
        return Err("The startup file has no [Desktop Entry] section.".to_string());
    }

    let mut updated = lines.join("\n");
    if contents.ends_with('\n') {
        updated.push('\n');
    }
    Ok(updated)
}

fn set_system_startup_override(
    id: &str,
    enabled: bool,
    expected_enabled: bool,
) -> Result<StartupAppSnapshot, String> {
    let system_path = system_config_directories()
        .into_iter()
        .map(|directory| directory.join("autostart").join(id))
        .filter(|path| path.is_file())
        .last()
        .ok_or_else(|| "The system startup entry no longer exists. Refresh and try again.".to_string())?;
    let base = parse_desktop_entry(&system_path, "System")?;
    let directory = user_config_directory()
        .ok_or_else(|| "Your user configuration directory is unavailable.".to_string())?
        .join("autostart");
    let path = directory.join(id);
    let current_enabled = if path.is_file() {
        parse_desktop_entry(&path, "User")?.enabled
    } else {
        base.enabled
    };
    if current_enabled != expected_enabled {
        return Err("This startup entry changed since the list was loaded. Refresh and try again.".to_string());
    }
    if base.command.trim().is_empty() {
        return Err("This entry has no launch command, so Argus cannot safely change it.".to_string());
    }

    let source_path = if path.is_file() && !parse_desktop_entry(&path, "User")?.command.trim().is_empty() {
        path.clone()
    } else {
        system_path
    };
    let contents = fs::read_to_string(&source_path)
        .map_err(|error| format!("Could not read {}: {error}", source_path.display()))?;
    let updated_contents = update_desktop_entry(&contents, enabled)?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create your startup override directory: {error}"))?;
    let temporary_path = directory.join(format!(".{id}.argus-{}.tmp", std::process::id()));

    let write_result = (|| -> Result<(), String> {
        let mut temporary_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
            .map_err(|error| format!("Could not create a temporary startup override: {error}"))?;
        temporary_file
            .write_all(updated_contents.as_bytes())
            .map_err(|error| format!("Could not write the startup override: {error}"))?;
        temporary_file
            .sync_all()
            .map_err(|error| format!("Could not save the startup override: {error}"))?;
        drop(temporary_file);
        fs::rename(&temporary_path, &path)
            .map_err(|error| format!("Could not apply the startup override: {error}"))?;
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    write_result?;
    let mut updated = parse_desktop_entry(&path, "User")?;
    updated.source = "System".to_string();
    updated.is_system_entry = true;
    updated.has_user_override = true;
    Ok(updated)
}

#[tauri::command]
fn set_startup_enabled(
    id: String,
    enabled: bool,
    expected_enabled: bool,
    is_system_entry: bool,
) -> Result<StartupAppSnapshot, String> {
    let file_name = Path::new(&id).file_name().and_then(|name| name.to_str());
    if file_name != Some(id.as_str()) || Path::new(&id).extension().and_then(|ext| ext.to_str()) != Some("desktop") {
        return Err("Invalid startup entry identifier.".to_string());
    }

    let listed = get_startup_apps()?.into_iter().find(|entry| entry.id == id)
        .ok_or_else(|| "That startup entry is no longer available. Refresh and try again.".to_string())?;
    if listed.is_system_entry != is_system_entry {
        return Err("The startup entry source changed. Refresh and try again.".to_string());
    }
    if listed.enabled != expected_enabled {
        return Err("This startup entry changed since the list was loaded. Refresh and try again.".to_string());
    }
    if is_system_entry {
        return set_system_startup_override(&id, enabled, expected_enabled);
    }

    let directory = user_config_directory()
        .ok_or_else(|| "Your user configuration directory is unavailable.".to_string())?
        .join("autostart");
    let path = directory.join(&id);
    let current = parse_desktop_entry(&path, "User")?;
    if current.enabled != expected_enabled {
        return Err("This startup entry changed since the list was loaded. Refresh and try again.".to_string());
    }
    if current.enabled == enabled {
        return Ok(current);
    }
    if current.command.trim().is_empty() {
        return Err("This entry has no launch command, so Argus cannot safely change it.".to_string());
    }

    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let updated_contents = update_desktop_entry(&contents, enabled)?;
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
    let temporary_path = directory.join(format!(".{id}.argus-{}.tmp", std::process::id()));

    let write_result = (|| -> Result<(), String> {
        let mut temporary_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
            .map_err(|error| format!("Could not create a temporary startup file: {error}"))?;
        temporary_file
            .write_all(updated_contents.as_bytes())
            .map_err(|error| format!("Could not write the startup change: {error}"))?;
        temporary_file
            .sync_all()
            .map_err(|error| format!("Could not save the startup change: {error}"))?;
        drop(temporary_file);
        fs::set_permissions(&temporary_path, metadata.permissions())
            .map_err(|error| format!("Could not preserve startup file permissions: {error}"))?;
        fs::rename(&temporary_path, &path)
            .map_err(|error| format!("Could not apply the startup change: {error}"))?;
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    write_result?;
    parse_desktop_entry(&path, "User")
}

#[tauri::command]
fn get_startup_apps() -> Result<Vec<StartupAppSnapshot>, String> {
    let mut system_entries = BTreeMap::new();
    for directory in system_config_directories() {
        read_autostart_directory(
            &directory.join("autostart"),
            "System",
            &mut system_entries,
            true,
        )?;
    }

    let mut user_entries = BTreeMap::new();
    let mut applications = system_entries.clone();
    if let Some(user_config) = user_config_directory() {
        read_autostart_directory(
            &user_config.join("autostart"),
            "User",
            &mut user_entries,
            true,
        )?;
    }

    for (id, user_entry) in user_entries {
        if let Some(system_entry) = applications.get_mut(&id) {
            system_entry.enabled = user_entry.enabled;
            system_entry.has_user_override = true;
            if !user_entry.command.trim().is_empty() {
                system_entry.command = user_entry.command;
            }
        } else {
            applications.insert(id, user_entry);
        }
    }

    let mut applications = applications.into_values().collect::<Vec<_>>();
    applications.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(applications)
}

#[tauri::command]
fn get_network_interfaces() -> Vec<NetworkInterfaceSnapshot> {
    let networks = Networks::new_with_refreshed_list();
    let mut interfaces = networks
        .list()
        .iter()
        .map(|(name, network)| {
            let mac_address = network.mac_address().to_string();
            NetworkInterfaceSnapshot {
                name: name.clone(),
                mac_address: if mac_address == "00:00:00:00:00:00" {
                    String::new()
                } else {
                    mac_address
                },
                ip_addresses: network.ip_networks().iter().map(ToString::to_string).collect(),
                received_bytes: network.total_received(),
                transmitted_bytes: network.total_transmitted(),
                is_loopback: name == "lo",
            }
        })
        .collect::<Vec<_>>();
    interfaces.sort_by(|a, b| a.name.cmp(&b.name));
    interfaces
}

#[tauri::command]
fn get_network_route_info() -> NetworkRouteSnapshot {
    let mut default_gateway = None;
    let mut default_interface = None;
    let mut gateway_error = None;
    for family in ["-4", "-6"] {
        match Command::new("ip").args(["-json", family, "route", "show", "default"]).output() {
            Ok(output) if output.status.success() => {
                if let Ok(routes) = serde_json::from_slice::<serde_json::Value>(&output.stdout) {
                    if let Some(route) = routes.as_array().and_then(|routes| routes.first()) {
                        default_gateway = route.get("gateway").and_then(serde_json::Value::as_str).map(str::to_string);
                        default_interface = route.get("dev").and_then(serde_json::Value::as_str).map(str::to_string);
                        if default_gateway.is_some() || default_interface.is_some() { break; }
                    }
                }
            }
            Ok(output) => {
                if gateway_error.is_none() {
                    gateway_error = Some(String::from_utf8_lossy(&output.stderr).trim().to_string());
                }
            }
            Err(error) => gateway_error = Some(format!("Could not run ip: {error}")),
        }
    }
    let (dns_servers, dns_error) = match fs::read_to_string("/etc/resolv.conf") {
        Ok(contents) => {
            let servers = contents.lines().filter_map(|line| {
                let mut fields = line.split_whitespace();
                (fields.next() == Some("nameserver")).then(|| fields.next().map(str::to_string)).flatten()
            }).collect();
            (servers, None)
        }
        Err(error) => (Vec::new(), Some(format!("Could not read resolver configuration: {error}"))),
    };
    NetworkRouteSnapshot { default_gateway, default_interface, dns_servers, gateway_error, dns_error }
}

#[tauri::command]
fn get_network_connections() -> Result<Vec<NetworkConnectionSnapshot>, String> {
    let output = Command::new("ss")
        .args(["-tulpnH"])
        .output()
        .map_err(|e| format!("Could not run ss: {}", e))?;

    if !output.status.success() {
        return Err("Failed to query network connections".to_string());
    }

    let mut connections = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 6 {
            let protocol = parts[0].to_string();
            let state = parts[1].to_string();
            let local_address = parts[4].to_string();
            let remote_address = parts[5].to_string();
            
            let mut process = "Unknown".to_string();
            let mut pid = None;
            if parts.len() > 6 {
                let proc_str = parts[6..].join(" ");
                if let Some(start) = proc_str.find("users:((") {
                    if let Some(end) = proc_str[start..].find("))") {
                        let user_info = &proc_str[start + 8..start + end];
                        let info_parts: Vec<&str> = user_info.split(',').collect();
                        if let Some(name_part) = info_parts.get(0) {
                            process = name_part.trim_matches('"').to_string();
                        }
                        if info_parts.len() > 1 {
                            if let Some(pid_part) = info_parts[1].split('=').nth(1) {
                                pid = pid_part.parse().ok();
                            }
                        }
                    }
                }
            }
            connections.push(NetworkConnectionSnapshot {
                protocol,
                state,
                local_address,
                remote_address,
                process,
                pid,
            });
        }
    }
    Ok(connections)
}

#[tauri::command]
fn get_hardware_extra() -> HardwareExtraSnapshot {
    let mut gpus = Vec::new();
    let mut fans = Vec::new();

    // 1. Check Nvidia
    if let Ok(output) = Command::new("nvidia-smi")
        .args(["--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits"])
        .output()
    {
        if output.status.success() {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                let parts: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
                if parts.len() >= 5 {
                    gpus.push(GpuSnapshot {
                        name: parts[0].to_string(),
                        utilization_percent: parts[1].parse().unwrap_or(0.0),
                        vram_used_bytes: parts[2].parse::<u64>().unwrap_or(0) * 1024 * 1024,
                        vram_total_bytes: parts[3].parse::<u64>().unwrap_or(0) * 1024 * 1024,
                        temperature_celsius: parts[4].parse().ok(),
                    });
                }
            }
        }
    }

    // 2. Check AMD/Intel sysfs
    if gpus.is_empty() {
        if let Ok(entries) = fs::read_dir("/sys/class/drm") {
            for entry in entries.filter_map(Result::ok) {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("card") && !name.contains("-") {
                    let device_path = entry.path().join("device");
                    if device_path.exists() {
                        let read_val = |file: &str| fs::read_to_string(device_path.join(file)).ok().and_then(|s| s.trim().parse::<u64>().ok());
                        
                        let util = read_val("gpu_busy_percent").unwrap_or(0) as f32;
                        let vram_used = read_val("mem_info_vram_used").unwrap_or(0);
                        let vram_total = read_val("mem_info_vram_total").unwrap_or(0);
                        
                        let mut temp = None;
                        if let Ok(hwmon_entries) = fs::read_dir(device_path.join("hwmon")) {
                            for hwmon in hwmon_entries.filter_map(Result::ok) {
                                if let Ok(t_str) = fs::read_to_string(hwmon.path().join("temp1_input")) {
                                    if let Ok(t) = t_str.trim().parse::<f32>() {
                                        temp = Some(t / 1000.0);
                                        break;
                                    }
                                }
                            }
                        }

                        gpus.push(GpuSnapshot {
                            name: format!("GPU ({})", name),
                            utilization_percent: util,
                            vram_used_bytes: vram_used,
                            vram_total_bytes: vram_total,
                            temperature_celsius: temp,
                        });
                    }
                }
            }
        }
    }

    // 3. Check Fans via hwmon
    if let Ok(entries) = fs::read_dir("/sys/class/hwmon") {
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            let hw_name = fs::read_to_string(path.join("name")).ok().unwrap_or_else(|| "hwmon".to_string());
            let hw_name = hw_name.trim();
            
            if hw_name == "thinkpad" || hw_name == "nct6775" || hw_name == "it87" || hw_name == "asus" || hw_name.contains("fan") || hw_name.contains("apple") {
                for i in 1..=5 {
                    let input_path = path.join(format!("fan{}_input", i));
                    if let Ok(rpm_str) = fs::read_to_string(&input_path) {
                        if let Ok(rpm) = rpm_str.trim().parse::<u32>() {
                            let label_path = path.join(format!("fan{}_label", i));
                            let label = fs::read_to_string(&label_path)
                                .map(|l| l.trim().to_string())
                                .unwrap_or_else(|_| format!("{} Fan {}", hw_name, i));
                            
                            fans.push(FanSnapshot { label, rpm });
                        }
                    }
                }
            }
        }
    }

    HardwareExtraSnapshot { gpus, fans }
}

#[tauri::command]
fn get_temperatures() -> Vec<TemperatureSnapshot> {
    let components = Components::new_with_refreshed_list();

    components
        .list()
        .iter()
        .filter_map(|component| {
            let temperature_celsius = component.temperature()?;
            if !temperature_celsius.is_finite() {
                return None;
            }
            Some(TemperatureSnapshot {
                label: component.label().to_string(),
                temperature_celsius,
                critical_celsius: component.critical().filter(|value| value.is_finite() && *value > 0.0),
            })
        })
        .collect()
}

fn cache_root_is_safe_to_clear(root: &Path) -> bool {
    let Some(home) = env::var_os("HOME").map(PathBuf::from) else { return false };
    let (Ok(home), Ok(root)) = (home.canonicalize(), root.canonicalize()) else { return false };
    root != home && root.starts_with(&home) && root.file_name().is_some_and(|name| name == ".cache")
}

fn user_cache_root() -> Result<PathBuf, String> {
    env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".cache")))
        .ok_or_else(|| "Could not find this account's cache folder".to_string())
}

#[tauri::command]
fn clear_cache_entry(directory_name: String) -> Result<(), String> {
    let relative_path = Path::new(&directory_name);
    let mut components = relative_path.components();
    let is_one_directory_name = matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none();
    if !is_one_directory_name || directory_name == "Other files" {
        return Err("Choose one top-level cache directory".to_string());
    }

    let configured_root = user_cache_root()?;
    if !cache_root_is_safe_to_clear(&configured_root) {
        return Err("Cleanup is available only for a .cache directory inside your home folder".to_string());
    }
    let root = configured_root
        .canonicalize()
        .map_err(|error| format!("Could not access this account's cache folder: {error}"))?;
    let target = root.join(&directory_name);
    let metadata = fs::symlink_metadata(&target)
        .map_err(|error| format!("Could not inspect the selected cache directory: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("The selected cache entry is not a regular directory".to_string());
    }
    let canonical_target = target
        .canonicalize()
        .map_err(|error| format!("Could not verify the selected cache directory: {error}"))?;
    if canonical_target.parent() != Some(root.as_path()) {
        return Err("The selected directory is outside this account's cache folder".to_string());
    }

    fs::remove_dir_all(&canonical_target)
        .map_err(|error| format!("Could not clear the selected cache directory: {error}"))
}

#[tauri::command]
async fn get_cache_inventory() -> Result<CacheInventorySnapshot, String> {
    tauri::async_runtime::spawn_blocking(scan_cache_directory)
        .await
        .map_err(|error| format!("The cache scan could not finish: {error}"))?
}

fn scan_cache_directory() -> Result<CacheInventorySnapshot, String> {
    const MAX_SCANNED_ENTRIES: usize = 100_000;
    const MAX_DURATION: Duration = Duration::from_secs(20);

    let root = user_cache_root()?;

    if !root.is_dir() {
        return Ok(CacheInventorySnapshot {
            entries: Vec::new(),
            total_bytes: 0,
            files_scanned: 0,
            skipped_entries: 0,
            scan_limited: false,
            available: false,
        });
    }

    let started = Instant::now();
    let mut pending = Vec::<(PathBuf, String)>::new();
    let mut sizes = BTreeMap::<String, (u64, u64)>::new();
    let mut cache_directories = std::collections::BTreeSet::<String>::new();
    let cache_root_clearable = cache_root_is_safe_to_clear(&root);
    let mut scanned_entries = 0usize;
    let mut skipped_entries = 0usize;
    let mut files_scanned = 0u64;
    let mut total_bytes = 0u64;
    let mut scan_limited = false;

    let top_level = fs::read_dir(&root)
        .map_err(|error| format!("Could not read the cache folder: {error}"))?;
    for entry in top_level {
        if scanned_entries >= MAX_SCANNED_ENTRIES || started.elapsed() >= MAX_DURATION {
            scan_limited = true;
            break;
        }
        scanned_entries += 1;
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                skipped_entries += 1;
                continue;
            }
        };
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => {
                skipped_entries += 1;
                continue;
            }
        };
        if file_type.is_symlink() {
            continue;
        }
        let name = if file_type.is_dir() {
            let name = entry.file_name().to_string_lossy().into_owned();
            cache_directories.insert(name.clone());
            pending.push((entry.path(), name.clone()));
            name
        } else if file_type.is_file() {
            "Other files".to_string()
        } else {
            continue;
        };

        if file_type.is_file() {
            match entry.metadata() {
                Ok(metadata) => {
                    let item = sizes.entry(name).or_default();
                    item.0 = item.0.saturating_add(metadata.len());
                    item.1 = item.1.saturating_add(1);
                    total_bytes = total_bytes.saturating_add(metadata.len());
                    files_scanned += 1;
                }
                Err(_) => skipped_entries += 1,
            }
        }
    }

    while !scan_limited {
        let Some((directory, category)) = pending.pop() else {
            break;
        };
        let entries = match fs::read_dir(directory) {
            Ok(entries) => entries,
            Err(_) => {
                skipped_entries += 1;
                continue;
            }
        };
        for entry in entries {
            if scanned_entries >= MAX_SCANNED_ENTRIES || started.elapsed() >= MAX_DURATION {
                scan_limited = true;
                break;
            }
            scanned_entries += 1;
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    skipped_entries += 1;
                    continue;
                }
            };
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => {
                    skipped_entries += 1;
                    continue;
                }
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                pending.push((entry.path(), category.clone()));
            } else if file_type.is_file() {
                match entry.metadata() {
                    Ok(metadata) => {
                        let item = sizes.entry(category.clone()).or_default();
                        item.0 = item.0.saturating_add(metadata.len());
                        item.1 = item.1.saturating_add(1);
                        total_bytes = total_bytes.saturating_add(metadata.len());
                        files_scanned += 1;
                    }
                    Err(_) => skipped_entries += 1,
                }
            }
        }
        if scan_limited {
            break;
        }
    }

    let mut entries = sizes
        .into_iter()
        .map(|(name, (size_bytes, file_count))| {
            let clearable = cache_root_clearable && cache_directories.contains(&name) && name != "Other files";
            CacheEntrySnapshot {
                name,
                size_bytes,
                file_count,
                clearable,
            }
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| right.size_bytes.cmp(&left.size_bytes));

    Ok(CacheInventorySnapshot {
        entries,
        total_bytes,
        files_scanned,
        skipped_entries,
        scan_limited,
        available: true,
    })
}

#[tauri::command]
async fn get_log_inventory() -> Result<LogInventorySnapshot, String> {
    tauri::async_runtime::spawn_blocking(scan_log_directory)
        .await
        .map_err(|error| format!("The log inspection could not finish: {error}"))?
}

fn scan_log_directory() -> Result<LogInventorySnapshot, String> {
    use std::cmp::Reverse;
    use std::collections::BinaryHeap;

    const MAX_SCANNED_ENTRIES: usize = 50_000;
    const MAX_RESULTS: usize = 100;
    const MAX_DURATION: Duration = Duration::from_secs(10);

    let root = PathBuf::from("/var/log");
    let log_directory_available = root.is_dir();
    let mut scanned_entries = 0usize;
    let mut skipped_entries = 0usize;
    let mut scan_limited = false;
    let mut log_bytes = 0u64;
    let mut largest = BinaryHeap::<Reverse<(u64, String)>>::new();
    let mut log_error = None;

    if log_directory_available {
        let started = Instant::now();
        let mut pending = vec![root];
        while let Some(directory) = pending.pop() {
            let entries = match fs::read_dir(&directory) {
                Ok(entries) => entries,
                Err(_) => {
                    skipped_entries += 1;
                    continue;
                }
            };
            for entry in entries {
                if scanned_entries >= MAX_SCANNED_ENTRIES || started.elapsed() >= MAX_DURATION {
                    scan_limited = true;
                    break;
                }
                scanned_entries += 1;
                let entry = match entry {
                    Ok(entry) => entry,
                    Err(_) => {
                        skipped_entries += 1;
                        continue;
                    }
                };
                let file_type = match entry.file_type() {
                    Ok(file_type) => file_type,
                    Err(_) => {
                        skipped_entries += 1;
                        continue;
                    }
                };
                if file_type.is_symlink() {
                    continue;
                }
                if file_type.is_dir() {
                    pending.push(entry.path());
                    continue;
                }
                if !file_type.is_file() {
                    continue;
                }
                match entry.metadata() {
                    Ok(metadata) => {
                        let size = metadata.len();
                        log_bytes = log_bytes.saturating_add(size);
                        largest.push(Reverse((size, entry.path().to_string_lossy().into_owned())));
                        if largest.len() > MAX_RESULTS {
                            largest.pop();
                        }
                    }
                    Err(_) => skipped_entries += 1,
                }
            }
            if scan_limited {
                break;
            }
        }
    } else {
        log_error = Some("/var/log is not available on this system".to_string());
    }

    let journal = Command::new("journalctl")
        .args(["--disk-usage", "--no-pager"])
        .output();
    let (journal_usage, journal_error) = match journal {
        Ok(output) if output.status.success() => {
            let summary = String::from_utf8_lossy(&output.stdout).trim().to_string();
            (if summary.is_empty() { None } else { Some(summary) }, None)
        }
        Ok(output) => {
            let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
            (None, Some(if error.is_empty() {
                format!("journalctl exited with status {}", output.status)
            } else {
                error
            }))
        }
        Err(error) => (None, Some(format!("Could not run journalctl: {error}"))),
    };

    if !log_directory_available && journal_usage.is_none() {
        log_error = log_error.or(Some("System log information is unavailable".to_string()));
    }

    let mut files = largest
        .into_iter()
        .map(|Reverse((size_bytes, path))| LogFileSnapshot { path, size_bytes })
        .collect::<Vec<_>>();
    files.sort_by(|left, right| right.size_bytes.cmp(&left.size_bytes));

    Ok(LogInventorySnapshot {
        files,
        log_bytes,
        scanned_entries,
        skipped_entries,
        scan_limited,
        log_directory_available,
        log_error,
        journal_usage,
        journal_error,
    })
}

#[tauri::command]
async fn scan_large_files(root: String, minimum_size_bytes: u64) -> Result<LargeFileScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || scan_large_files_inner(root, minimum_size_bytes))
        .await
        .map_err(|error| format!("The folder scan could not finish: {error}"))?
}

fn scan_large_files_inner(root: String, minimum_size_bytes: u64) -> Result<LargeFileScanResult, String> {
    use std::cmp::Reverse;
    use std::collections::BinaryHeap;

    const MAX_SCANNED_ENTRIES: usize = 100_000;
    const MAX_RESULTS: usize = 250;
    const MAX_DURATION: Duration = Duration::from_secs(20);

    let root = PathBuf::from(root)
        .canonicalize()
        .map_err(|error| format!("Could not open the selected folder: {error}"))?;
    if !root.is_dir() {
        return Err("Choose a folder to scan".to_string());
    }

    let started = Instant::now();
    let mut pending = vec![root.clone()];
    let mut largest = BinaryHeap::<Reverse<(u64, String)>>::new();
    let mut scanned_entries = 0usize;
    let mut skipped_entries = 0usize;
    let mut scan_limited = false;
    let mut results_limited = false;

    while let Some(directory) = pending.pop() {
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => {
                skipped_entries += 1;
                continue;
            }
        };

        for entry in entries {
            if scanned_entries >= MAX_SCANNED_ENTRIES || started.elapsed() >= MAX_DURATION {
                scan_limited = true;
                break;
            }
            scanned_entries += 1;

            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    skipped_entries += 1;
                    continue;
                }
            };
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => {
                    skipped_entries += 1;
                    continue;
                }
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                pending.push(entry.path());
                continue;
            }
            if !file_type.is_file() {
                continue;
            }

            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(_) => {
                    skipped_entries += 1;
                    continue;
                }
            };
            let size = metadata.len();
            if size < minimum_size_bytes {
                continue;
            }
            let path = entry.path().to_string_lossy().into_owned();
            largest.push(Reverse((size, path)));
            if largest.len() > MAX_RESULTS {
                largest.pop();
                results_limited = true;
            }
        }

        if scan_limited {
            break;
        }
    }

    let mut files = largest
        .into_iter()
        .map(|Reverse((size_bytes, path))| LargeFileSnapshot { path, size_bytes })
        .collect::<Vec<_>>();
    files.sort_by(|left, right| right.size_bytes.cmp(&left.size_bytes));

    Ok(LargeFileScanResult {
        root: root.to_string_lossy().into_owned(),
        files,
        scanned_entries,
        skipped_entries,
        scan_limited,
        results_limited,
    })
}

#[cfg(target_os = "linux")]
fn process_identity(pid: u32) -> Option<(u64, String)> {
    let stat = fs::read(format!("/proc/{pid}/stat")).ok()?;
    let command_start = stat.iter().position(|byte| *byte == b'(')?;
    let command_end = stat.iter().rposition(|byte| *byte == b')')?;
    if command_end <= command_start {
        return None;
    }
    let name = String::from_utf8_lossy(&stat[command_start + 1..command_end]).into_owned();
    let fields = std::str::from_utf8(&stat[command_end + 1..]).ok()?;
    let start_ticks = fields.split_whitespace().nth(19)?.parse().ok()?;
    Some((start_ticks, name))
}

#[tauri::command]
fn get_processes(
    state: tauri::State<'_, TelemetryState>,
) -> Result<Vec<ProcessSnapshot>, String> {
    let mut system = state
        .0
        .lock()
        .map_err(|_| "Process information is unavailable".to_string())?;

    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_cpu()
            .with_memory()
            .with_disk_usage()
            .without_tasks(),
    );

    Ok(system
        .processes()
        .iter()
        .filter_map(|(pid, process)| {
            #[cfg(target_os = "linux")]
            let start_time = process_identity(pid.as_u32())?.0;
            #[cfg(not(target_os = "linux"))]
            let start_time = process.start_time();
            Some(ProcessSnapshot {
                pid: pid.as_u32(),
                name: process.name().to_string_lossy().into_owned(),
                start_time,
                parent_pid: process.parent().map(|parent| parent.as_u32()),
                status: format!("{:?}", process.status()),
                run_time_seconds: process.run_time(),
                cpu_usage_percent: process.cpu_usage(),
                memory_bytes: process.memory(),
                disk_read_total_bytes: process.disk_usage().total_read_bytes,
                disk_write_total_bytes: process.disk_usage().total_written_bytes,
            })
        })
        .collect())
}

#[cfg(target_os = "linux")]
fn send_process_signal_with_pidfd(
    pid: u32,
    expected_name: &str,
    expected_start_time: u64,
    signal: Signal,
) -> Result<(), String> {
    let pidfd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid as libc::pid_t, 0) } as i32;
    if pidfd < 0 {
        let error = std::io::Error::last_os_error();
        return if error.kind() == std::io::ErrorKind::PermissionDenied {
            Err("Linux did not allow Argus to signal this process. It may require higher privileges.".to_string())
        } else {
            Err(format!("Linux could not open a stable handle to this process: {error}"))
        };
    }
    let pidfd = unsafe { OwnedFd::from_raw_fd(pidfd) };
    if process_identity(pid).is_none_or(|(start_time, name)| start_time != expected_start_time || name != expected_name) {
        return Err("The process changed since the list was refreshed. Review the updated list and try again.".to_string());
    }
    let signal_number = match signal {
        Signal::Term => libc::SIGTERM,
        Signal::Kill => libc::SIGKILL,
        _ => return Err("Argus only allows normal termination or force stop through this control.".to_string()),
    };
    let result = unsafe {
        libc::syscall(
            libc::SYS_pidfd_send_signal,
            pidfd.as_raw_fd(),
            signal_number,
            std::ptr::null::<libc::siginfo_t>(),
            0,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::PermissionDenied {
            Err("Linux did not allow Argus to signal this process. It may require higher privileges.".to_string())
        } else {
            Err(format!("Linux could not signal the selected process: {error}"))
        }
    }
}

fn send_process_signal(
    state: tauri::State<'_, TelemetryState>,
    pid: u32,
    expected_name: String,
    expected_start_time: u64,
    signal: Signal,
) -> Result<(), String> {
    if pid == 1 {
        return Err("Argus will not signal the system's init process.".to_string());
    }

    let target_pid = Pid::from_u32(pid);
    if sysinfo::get_current_pid().is_ok_and(|current_pid| current_pid == target_pid) {
        return Err("Argus will not signal itself.".to_string());
    }

    let mut system = state
        .0
        .lock()
        .map_err(|_| "Process information is unavailable".to_string())?;
    let target_pids = [target_pid];
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&target_pids),
        true,
        ProcessRefreshKind::nothing().without_tasks(),
    );

    let process = system
        .process(target_pid)
        .ok_or_else(|| "That process has already exited.".to_string())?;
    if process.name().to_string_lossy() != expected_name {
        return Err("The process changed since the list was refreshed. Review the updated list and try again.".to_string());
    }
    #[cfg(target_os = "linux")]
    {
        return send_process_signal_with_pidfd(pid, &expected_name, expected_start_time, signal);
    }
    #[cfg(not(target_os = "linux"))]
    match process.kill_with(signal) {
        Some(true) => Ok(()),
        Some(false) => Err("Linux did not allow Argus to signal this process. It may require higher privileges.".to_string()),
        None => Err("Process signaling is not supported on this system.".to_string()),
    }
}

#[tauri::command]
fn terminate_process(
    state: tauri::State<'_, TelemetryState>,
    pid: u32,
    expected_name: String,
    expected_start_time: u64,
) -> Result<(), String> {
    send_process_signal(state, pid, expected_name, expected_start_time, Signal::Term)
}

#[tauri::command]
fn force_stop_process(
    state: tauri::State<'_, TelemetryState>,
    pid: u32,
    expected_name: String,
    expected_start_time: u64,
) -> Result<(), String> {
    send_process_signal(state, pid, expected_name, expected_start_time, Signal::Kill)
}

#[cfg(target_os = "linux")]
fn signal_process_as_authorized_user(
    pid: u32,
    expected_name: &str,
    expected_start_time: u64,
    caller_pid: u32,
    signal: Signal,
) -> Result<(), String> {
    if pid == 1 {
        return Err("Argus will not signal the system's init process.".to_string());
    }
    if pid == caller_pid {
        return Err("Argus will not signal its own desktop process.".to_string());
    }
    let status = fs::read_to_string("/proc/self/status")
        .map_err(|error| format!("Could not verify administrator authorization: {error}"))?;
    let effective_uid = status.lines()
        .find_map(|line| line.strip_prefix("Uid:").and_then(|value| value.split_whitespace().nth(1)))
        .and_then(|value| value.parse::<u32>().ok());
    if effective_uid != Some(0) {
        return Err("The helper did not receive administrator privileges.".to_string());
    }

    send_process_signal_with_pidfd(pid, expected_name, expected_start_time, signal)
}

#[cfg(target_os = "linux")]
pub fn handle_privileged_helper_args() -> Option<i32> {
    let mut args = env::args().skip(1);
    if args.next().as_deref() != Some("--argus-admin-signal") {
        return None;
    }
    let result = (|| -> Result<(), String> {
        let signal = match args.next().as_deref() {
            Some("term") => Signal::Term,
            Some("kill") => Signal::Kill,
            _ => return Err("The privileged helper received an unsupported signal.".to_string()),
        };
        let pid = args.next().and_then(|value| value.parse::<u32>().ok())
            .ok_or_else(|| "The privileged helper received an invalid process ID.".to_string())?;
        let expected_name = args.next().ok_or_else(|| "The process name was not provided.".to_string())?;
        let expected_start_time = args.next().and_then(|value| value.parse::<u64>().ok())
            .ok_or_else(|| "The process start time was invalid.".to_string())?;
        let caller_pid = args.next().and_then(|value| value.parse::<u32>().ok())
            .ok_or_else(|| "The requesting application process ID was invalid.".to_string())?;
        if args.next().is_some() {
            return Err("The privileged helper received unexpected arguments.".to_string());
        }
        signal_process_as_authorized_user(pid, &expected_name, expected_start_time, caller_pid, signal)
    })();
    match result {
        Ok(()) => Some(0),
        Err(error) => {
            eprintln!("Argus authorization helper: {error}");
            Some(1)
        }
    }
}

#[tauri::command]
async fn signal_process_with_authorization(
    pid: u32,
    expected_name: String,
    expected_start_time: u64,
    signal: String,
) -> Result<(), String> {
    let signal = match signal.as_str() {
        "term" | "kill" => signal,
        _ => return Err("Argus requested an unsupported process signal.".to_string()),
    };
    if pid == 1 || pid == std::process::id() {
        return Err("Argus will not signal PID 1 or itself.".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            use std::os::unix::fs::MetadataExt;
            let executable = env::current_exe()
                .map_err(|error| format!("Could not locate Argus for authorization: {error}"))?;
            let trusted_installation = executable.ancestors().all(|path| {
                fs::metadata(path).is_ok_and(|metadata| metadata.uid() == 0 && metadata.mode() & 0o022 == 0)
            });
            if !trusted_installation {
                return Err("Administrator retry requires Argus to be installed in a root-owned, non-user-writable path. It is unavailable from a development build.".to_string());
            }
            let output = Command::new("pkexec")
                .arg(executable)
                .args([
                    "--argus-admin-signal",
                    signal.as_str(),
                    &pid.to_string(),
                    expected_name.as_str(),
                    &expected_start_time.to_string(),
                    &std::process::id().to_string(),
                ])
                .output()
                .map_err(|error| format!("Could not start the Linux authorization dialog: {error}"))?;
            if output.status.success() {
                return Ok(());
            }
            let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if output.status.code() == Some(126) {
                return Err("Administrator authorization was cancelled or denied.".to_string());
            }
            Err(if message.is_empty() {
                format!("The authorized process signal failed (pkexec status {}).", output.status)
            } else {
                message
            })
        })
        .await
        .map_err(|error| format!("The authorization request could not finish: {error}"))?
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (pid, expected_name, expected_start_time, signal);
        Err("Administrator process authorization is available on Linux only.".to_string())
    }
}

#[tauri::command]
fn get_recent_logs() -> Result<Vec<SystemLogEntry>, String> {
    let output = Command::new("journalctl")
        .args(["--boot", "--lines=300", "--no-pager", "--output=json"])
        .output()
        .map_err(|error| format!("Could not start journalctl: {error}"))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() { "Could not read the system journal".to_string() } else { message });
    }

    Ok(parse_journal_entries(&output.stdout))
}

#[tauri::command]
fn get_service_logs(scope: String, unit: String) -> Result<Vec<SystemLogEntry>, String> {
    if !["System", "User"].contains(&scope.as_str())
        || !unit.ends_with(".service")
        || unit.starts_with('-')
        || !unit.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"@._:-".contains(&byte))
    {
        return Err("Invalid service log request".to_string());
    }
    let unit_arg = format!("--unit={unit}");
    let mut command = Command::new("journalctl");
    if scope == "User" {
        command.arg("--user");
    }
    let output = command
        .args([unit_arg.as_str(), "--lines=100", "--no-pager", "--output=json"])
        .output()
        .map_err(|error| format!("Could not start journalctl: {error}"))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() { "Could not read this service’s journal entries".to_string() } else { message });
    }
    Ok(parse_journal_entries(&output.stdout))
}

fn parse_journal_entries(output: &[u8]) -> Vec<SystemLogEntry> {
    let mut entries = Vec::new();
    for line in String::from_utf8_lossy(output).lines() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        let message = value.get("MESSAGE").and_then(serde_json::Value::as_str).unwrap_or("");
        if message.is_empty() { continue; }
        let priority = value.get("PRIORITY")
            .and_then(serde_json::Value::as_str)
            .and_then(|value| value.parse::<u8>().ok())
            .unwrap_or(6);
        let severity = match priority {
            0 => "Emergency", 1 => "Alert", 2 => "Critical", 3 => "Error",
            4 => "Warning", 5 => "Notice", 6 => "Info", _ => "Debug",
        };
        let source = value.get("SYSLOG_IDENTIFIER")
            .or_else(|| value.get("_COMM"))
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.is_empty())
            .unwrap_or("System")
            .to_string();
        let timestamp_micros = value.get("__REALTIME_TIMESTAMP")
            .and_then(serde_json::Value::as_str)
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0);
        entries.push(SystemLogEntry {
            timestamp_micros,
            source,
            severity: severity.to_string(),
            message: message.chars().take(4000).collect(),
        });
    }
    entries.reverse();
    entries
}

#[tauri::command]
fn get_partitions() -> Result<Vec<PartitionSnapshot>, String> {
    let output = Command::new("lsblk")
        .args(["--json", "--bytes", "--output", "NAME,PATH,TYPE,FSTYPE,LABEL,SIZE,MOUNTPOINTS,RM"])
        .output()
        .map_err(|error| format!("Could not start lsblk: {error}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let inventory: LsblkOutput = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Could not read Linux block-device information: {error}"))?;
    let mut partitions = Vec::new();
    collect_partitions(inventory.blockdevices, &mut partitions);
    partitions.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(partitions)
}

fn is_system_critical_mount(path: &str) -> bool {
    ["/", "/boot", "/home", "/usr", "/var", "/etc", "/bin", "/sbin", "/lib", "/lib64", "/opt", "/run"]
        .iter()
        .any(|root| path == *root || (*root != "/" && path.starts_with(&format!("{root}/"))))
        || path == "/"
}

fn change_partition_mount(path: String, mount: bool) -> Result<String, String> {
    let partitions = get_partitions()?;
    let partition = partitions
        .into_iter()
        .find(|partition| partition.path == path && partition.device_type == "part")
        .ok_or_else(|| "Select a valid partition from the current storage list".to_string())?;
    let mounted_paths = partition.mount_points.iter().filter(|point| point.as_str() != "[SWAP]").collect::<Vec<_>>();

    if mount && !mounted_paths.is_empty() {
        return Err("This partition is already mounted".to_string());
    }
    if !mount {
        if mounted_paths.is_empty() {
            return Err("This partition is not mounted".to_string());
        }
        if partition.mount_points.iter().any(|point| point == "[SWAP]") {
            return Err("Active swap cannot be unmounted from this page".to_string());
        }
        if mounted_paths.iter().any(|point| is_system_critical_mount(point)) {
            return Err("Argus will not unmount a system-critical volume".to_string());
        }
    }

    let action = if mount { "mount" } else { "unmount" };
    let output = Command::new("udisksctl")
        .args([action, "--block-device", path.as_str()])
        .output()
        .map_err(|error| format!("Could not start udisksctl: {error}"))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() { format!("Linux could not {action} this partition") } else { message });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
async fn set_partition_mounted(path: String, mount: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || change_partition_mount(path, mount))
        .await
        .map_err(|error| format!("The partition operation could not finish: {error}"))?
}

#[tauri::command]
fn get_drive_health() -> Result<Vec<DriveHealthSnapshot>, String> {
    let output = Command::new("udisksctl")
        .arg("dump")
        .output()
        .map_err(|error| format!("Could not query UDisks drive health: {error}"))?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if error.is_empty() { "UDisks could not read drive health information".to_string() } else { error });
    }

    let dump = String::from_utf8_lossy(&output.stdout);
    let mut current_object = String::new();
    let mut current_interface = String::new();
    let mut drive_properties = BTreeMap::<String, BTreeMap<String, String>>::new();
    let mut block_links = BTreeMap::<String, (String, String, bool)>::new();

    for line in dump.lines() {
        if !line.starts_with(' ') && line.starts_with("/org/freedesktop/UDisks2/") && line.ends_with(':') {
            current_object = line.trim_end_matches(':').to_string();
            current_interface.clear();
            continue;
        }
        if line.starts_with("  org.freedesktop.UDisks2.") && line.trim_end().ends_with(':') {
            current_interface = line.trim().trim_end_matches(':').to_string();
            continue;
        }
        let Some((key, raw_value)) = line.trim_start().split_once(':') else { continue };
        let value = raw_value.trim().trim_matches('\'').to_string();
        if current_interface == "org.freedesktop.UDisks2.Block" {
            let link = block_links.entry(current_object.clone()).or_insert_with(|| (String::new(), String::new(), false));
            match key.trim() {
                "Device" => link.0 = value,
                "Drive" => link.1 = value,
                _ => {}
            }
        } else if current_interface == "org.freedesktop.UDisks2.Partition" {
            block_links.entry(current_object.clone()).or_insert_with(|| (String::new(), String::new(), false)).2 = true;
        } else if current_interface == "org.freedesktop.UDisks2.Drive"
            || current_interface == "org.freedesktop.UDisks2.Drive.Ata"
            || current_interface == "org.freedesktop.UDisks2.NVMe.Controller"
        {
            drive_properties
                .entry(current_object.clone())
                .or_default()
                .insert(format!("{current_interface}.{}", key.trim()), value);
        }
    }

    let mut drives = Vec::new();
    for (_block_object, (device, drive_object, is_partition)) in block_links {
        if is_partition || !device.starts_with("/dev/") || drive_object.is_empty() || drive_object == "/" {
            continue;
        }
        let Some(properties) = drive_properties.get(&drive_object) else { continue };
        let property = |interface: &str, name: &str| properties.get(&format!("org.freedesktop.UDisks2.{interface}.{name}"));
        let model = property("Drive", "Model").cloned().filter(|value| !value.is_empty()).unwrap_or_else(|| "Unknown drive".to_string());
        let sata_supported = property("Drive.Ata", "SmartSupported").and_then(|value| value.parse::<bool>().ok());
        let nvme_supported = property("NVMe.Controller", "SmartUpdated").is_some();
        let smart_supported = sata_supported.or_else(|| nvme_supported.then_some(true));
        let updated = property("Drive.Ata", "SmartUpdated")
            .or_else(|| property("NVMe.Controller", "SmartUpdated"))
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value > 0);
        let sata_failing = property("Drive.Ata", "SmartFailing").and_then(|value| value.parse::<bool>().ok());
        let nvme_warning = property("NVMe.Controller", "SmartCriticalWarning").map(|value| value.trim().is_empty() || value == "[]");
        let health_state = if smart_supported == Some(false) {
            "unsupported"
        } else if smart_supported.is_none() || updated.is_none() {
            "unknown"
        } else if sata_failing == Some(true) || nvme_warning == Some(false) {
            "warning"
        } else if sata_failing == Some(false) || nvme_warning == Some(true) {
            "healthy"
        } else {
            "unknown"
        }.to_string();
        let temperature_kelvin = property("Drive.Ata", "SmartTemperature")
            .or_else(|| property("NVMe.Controller", "SmartTemperature"))
            .and_then(|value| value.parse::<f32>().ok());
        let temperature_celsius = temperature_kelvin
            .filter(|value| value.is_finite() && *value > 0.0)
            .map(|value| value - 273.15);
        let power_on_hours = property("Drive.Ata", "SmartPowerOnSeconds")
            .and_then(|value| value.parse::<u64>().ok())
            .map(|seconds| seconds / 3600)
            .or_else(|| property("NVMe.Controller", "SmartPowerOnHours").and_then(|value| value.parse::<u64>().ok()));
        let bad_sectors = property("Drive.Ata", "SmartNumBadSectors").and_then(|value| value.parse::<i64>().ok()).filter(|value| *value >= 0).map(|value| value as u64);
        let attributes_failing = property("Drive.Ata", "SmartNumAttributesFailing").and_then(|value| value.parse::<i64>().ok()).filter(|value| *value >= 0).map(|value| value as u64);

        drives.push(DriveHealthSnapshot {
            path: device,
            model,
            smart_supported,
            health_state,
            temperature_celsius,
            power_on_hours,
            bad_sectors,
            attributes_failing,
            smart_updated_unix_seconds: updated,
        });
    }
    drives.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(drives)
}

#[tauri::command]
fn get_storage() -> Vec<DriveSnapshot> {
    let disks = Disks::new_with_refreshed_list();

    disks
        .list()
        .iter()
        .map(|disk| DriveSnapshot {
            name: disk.name().to_string_lossy().into_owned(),
            mount_point: disk.mount_point().to_string_lossy().into_owned(),
            file_system: disk.file_system().to_string_lossy().into_owned(),
            total_bytes: disk.total_space(),
            available_bytes: disk.available_space(),
            is_removable: disk.is_removable(),
        })
        .collect()
}

fn file_unix_seconds(path: &str) -> Option<u64> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs())
}

fn package_key(name: &str, architecture: &str) -> String {
    if architecture.is_empty() {
        name.to_string()
    } else {
        format!("{name}:{architecture}")
    }
}

fn parse_dpkg_query_line(line: &str) -> Option<PackageSnapshot> {
    let mut fields = line.splitn(7, '\t');
    let status = fields.next()?.trim();
    if status.is_empty() || status == "not-installed" {
        return None;
    }
    let name = fields.next()?.trim();
    let version = fields.next()?.trim();
    let architecture = fields.next()?.trim();
    let installed_size = fields.next()?.trim();
    let section = fields.next()?.trim();
    let summary = fields.next().unwrap_or("").trim();
    if name.is_empty() {
        return None;
    }
    let installed_size_bytes = installed_size.parse::<u64>().ok().map(|kib| kib.saturating_mul(1024));
    Some(PackageSnapshot {
        name: name.to_string(),
        version: version.to_string(),
        architecture: architecture.to_string(),
        status: status.to_string(),
        section: section.to_string(),
        installed_size_bytes,
        summary: summary.to_string(),
        automatic: false,
        upgrade_version: None,
        source: "APT".to_string(),
    })
}

fn parse_apt_simulation(output: &str) -> BTreeMap<String, String> {
    let mut upgrades = BTreeMap::new();
    for line in output.lines() {
        let Some(rest) = line.strip_prefix("Inst ") else {
            continue;
        };
        let Some(name_end) = rest.find(' ') else {
            continue;
        };
        let raw_name = &rest[..name_end];
        let remainder = &rest[name_end + 1..];
        if !remainder.starts_with('[') {
            continue;
        }
        let Some(current_end) = remainder.find(']') else {
            continue;
        };
        let Some(open_paren) = remainder[current_end + 1..].find('(') else {
            continue;
        };
        let inside = remainder[current_end + 1 + open_paren + 1..]
            .split_once(')')
            .map(|(inside, _)| inside)
            .unwrap_or(&remainder[current_end + 1 + open_paren + 1..]);
        let Some(new_version) = inside.split_whitespace().next() else {
            continue;
        };
        let architecture = inside
            .rsplit_once('[')
            .and_then(|(_, tail)| tail.strip_suffix(']'))
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let (name, name_arch) = raw_name
            .split_once(':')
            .map(|(name, arch)| (name, Some(arch)))
            .unwrap_or((raw_name, None));
        let architecture = name_arch.or(architecture).unwrap_or("");
        upgrades.insert(package_key(name, architecture), new_version.to_string());
        if !architecture.is_empty() {
            upgrades.entry(name.to_string()).or_insert_with(|| new_version.to_string());
        }
    }
    upgrades
}

fn parse_extended_states(contents: &str) -> BTreeMap<String, bool> {
    let mut automatic = BTreeMap::new();
    let mut name = None;
    let mut architecture = String::new();
    let mut auto_installed = false;
    let mut flush = |name: &mut Option<String>, architecture: &mut String, auto_installed: &mut bool| {
        if let Some(package) = name.take() {
            if *auto_installed {
                automatic.insert(package_key(&package, architecture), true);
                automatic.entry(package).or_insert(true);
            }
        }
        architecture.clear();
        *auto_installed = false;
    };
    for line in contents.lines() {
        if line.trim().is_empty() {
            flush(&mut name, &mut architecture, &mut auto_installed);
            continue;
        }
        if let Some(value) = line.strip_prefix("Package: ") {
            flush(&mut name, &mut architecture, &mut auto_installed);
            name = Some(value.trim().to_string());
        } else if let Some(value) = line.strip_prefix("Architecture: ") {
            architecture = value.trim().to_string();
        } else if let Some(value) = line.strip_prefix("Auto-Installed: ") {
            auto_installed = value.trim() == "1";
        }
    }
    flush(&mut name, &mut architecture, &mut auto_installed);
    automatic
}

fn last_package_index_unix_seconds() -> Option<u64> {
    [
        "/var/lib/apt/periodic/update-success-stamp",
        "/var/cache/apt/pkgcache.bin",
        "/var/lib/apt/lists",
    ]
    .into_iter()
    .filter_map(file_unix_seconds)
    .max()
}

fn command_not_found(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::NotFound
}

fn collect_dpkg_packages() -> Result<Vec<PackageSnapshot>, String> {
    let output = Command::new("dpkg-query")
        .args([
            "-W",
            "-f",
            "${db:Status-Status}\t${Package}\t${Version}\t${Architecture}\t${Installed-Size}\t${Section}\t${binary:Summary}\\n",
        ])
        .output()
        .map_err(|error| {
            if command_not_found(&error) {
                "dpkg-query is not installed on this system.".to_string()
            } else {
                format!("Could not start dpkg-query: {error}")
            }
        })?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            "Could not read the local Debian package database.".to_string()
        } else {
            message
        });
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut packages = stdout.lines().filter_map(parse_dpkg_query_line).collect::<Vec<_>>();
    packages.sort_by(|left, right| left.name.cmp(&right.name).then(left.architecture.cmp(&right.architecture)));
    Ok(packages)
}

fn apply_package_annotations(packages: &mut [PackageSnapshot], warnings: &mut Vec<String>) {
    match fs::read_to_string("/var/lib/apt/extended_states") {
        Ok(contents) => {
            let automatic = parse_extended_states(&contents);
            for package in packages.iter_mut() {
                package.automatic = automatic
                    .get(&package_key(&package.name, &package.architecture))
                    .or_else(|| automatic.get(&package.name))
                    .copied()
                    .unwrap_or(false);
            }
        }
        Err(error) if command_not_found(&error) || error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => warnings.push(format!("Automatic-install marks could not be read: {error}")),
    }

    match Command::new("apt-get")
        .args(["-s", "-o", "Debug::NoLocking=true", "upgrade"])
        .output()
    {
        Ok(output) => {
            if output.status.success() {
                let upgrades = parse_apt_simulation(&String::from_utf8_lossy(&output.stdout));
                for package in packages.iter_mut() {
                    package.upgrade_version = upgrades
                        .get(&package_key(&package.name, &package.architecture))
                        .or_else(|| upgrades.get(&package.name))
                        .cloned();
                }
            } else {
                let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
                warnings.push(if message.is_empty() {
                    "Local apt cache could not be checked for available updates.".to_string()
                } else {
                    format!("Available updates could not be read from the local apt cache: {message}")
                });
            }
        }
        Err(error) if command_not_found(&error) => warnings.push(
            "apt-get is not available, so Argus cannot compare installed packages with the local update cache."
                .to_string(),
        ),
        Err(error) => warnings.push(format!("Could not start apt-get to check local updates: {error}")),
    }
}

fn parse_human_size(size: &str) -> Option<u64> {
    let size = size.trim();
    if size.is_empty() { return None; }
    let chars = size.chars();
    let mut num_str = String::new();
    let mut unit = String::new();
    for c in chars {
        if c.is_ascii_digit() || c == '.' {
            num_str.push(c);
        } else if c.is_alphabetic() {
            unit.push(c);
        }
    }
    let num: f64 = num_str.parse().ok()?;
    let multiplier = match unit.to_lowercase().as_str() {
        "b" => 1.0,
        "kb" => 1024.0,
        "mb" => 1024.0 * 1024.0,
        "gb" => 1024.0 * 1024.0 * 1024.0,
        _ => 1.0,
    };
    Some((num * multiplier) as u64)
}

fn collect_flatpak_packages() -> Vec<PackageSnapshot> {
    let mut packages = Vec::new();
    if let Ok(output) = Command::new("flatpak").args(["list", "--app", "--columns=name,application,version,size"]).output() {
        if output.status.success() {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                let parts: Vec<&str> = line.split('\t').collect();
                if parts.len() >= 3 {
                    let name = parts[0].trim().to_string();
                    let id = parts[1].trim().to_string();
                    let version = parts[2].trim().to_string();
                    let size_str = parts.get(3).map(|s| s.trim()).unwrap_or("");
                    let size_bytes = parse_human_size(size_str);

                    packages.push(PackageSnapshot {
                        name: format!("{} ({})", name, id),
                        version,
                        architecture: "flatpak".to_string(),
                        status: "installed".to_string(),
                        section: "Application".to_string(),
                        installed_size_bytes: size_bytes,
                        summary: "Flatpak application".to_string(),
                        automatic: false,
                        upgrade_version: None,
                        source: "Flatpak".to_string(),
                    });
                }
            }
        }
    }
    packages
}

fn collect_snap_packages() -> Vec<PackageSnapshot> {
    let mut packages = Vec::new();
    if let Ok(output) = Command::new("snap").arg("list").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for (i, line) in stdout.lines().enumerate() {
                if i == 0 { continue; }
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    let name = parts[0].to_string();
                    let version = parts[1].to_string();
                    packages.push(PackageSnapshot {
                        name,
                        version,
                        architecture: "snap".to_string(),
                        status: "installed".to_string(),
                        section: "Application".to_string(),
                        installed_size_bytes: None,
                        summary: "Snap application".to_string(),
                        automatic: false,
                        upgrade_version: None,
                        source: "Snap".to_string(),
                    });
                }
            }
        }
    }
    packages
}

fn collect_package_inventory() -> Result<PackageInventory, String> {
    let mut packages = Vec::new();
    let mut warnings = Vec::new();
    let mut backends = Vec::new();

    // APT
    if let Ok(mut apt_packages) = collect_dpkg_packages() {
        apply_package_annotations(&mut apt_packages, &mut warnings);
        packages.extend(apt_packages);
        backends.push("APT");
    }

    // Flatpak
    let flatpak_packages = collect_flatpak_packages();
    if !flatpak_packages.is_empty() {
        packages.extend(flatpak_packages);
        backends.push("Flatpak");
    }

    // Snap
    let snap_packages = collect_snap_packages();
    if !snap_packages.is_empty() {
        packages.extend(snap_packages);
        backends.push("Snap");
    }

    if backends.is_empty() {
        return Ok(PackageInventory {
            backend: "unavailable".to_string(),
            backend_detail: "No supported package managers (APT, Flatpak, Snap) were found.".to_string(),
            packages: Vec::new(),
            warnings,
            last_index_unix_seconds: None,
        });
    }

    packages.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(PackageInventory {
        backend: backends.join(", "),
        backend_detail: "Combined inventory from APT, Flatpak, and Snap.".to_string(),
        last_index_unix_seconds: last_package_index_unix_seconds(),
        packages,
        warnings,
    })
}

#[tauri::command]
async fn get_package_inventory() -> Result<PackageInventory, String> {
    tauri::async_runtime::spawn_blocking(collect_package_inventory)
        .await
        .map_err(|error| format!("The software inventory could not finish: {error}"))?
}

#[tauri::command]
async fn clean_package_cache() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut output_msg = Vec::new();

        let out_remove = Command::new("pkexec").args(["apt-get", "autoremove", "-y"]).output()
            .map_err(|e| format!("Failed to run autoremove: {}", e))?;
        if out_remove.status.success() {
            output_msg.push(String::from_utf8_lossy(&out_remove.stdout).trim().to_string());
        } else {
            let err = String::from_utf8_lossy(&out_remove.stderr).trim().to_string();
            return Err(if err.is_empty() { "Autoremove failed or was cancelled.".to_string() } else { err });
        }

        let out_clean = Command::new("pkexec").args(["apt-get", "autoclean", "-y"]).output()
            .map_err(|e| format!("Failed to run autoclean: {}", e))?;
        if out_clean.status.success() {
            output_msg.push(String::from_utf8_lossy(&out_clean.stdout).trim().to_string());
        } else {
            let err = String::from_utf8_lossy(&out_clean.stderr).trim().to_string();
            return Err(if err.is_empty() { "Autoclean failed or was cancelled.".to_string() } else { err });
        }

        Ok(output_msg.join("\n\n"))
    })
    .await
    .map_err(|e| format!("Clean task failed: {}", e))?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemHealthAlert {
    severity: String,
    title: String,
    message: String,
    action_page: Option<String>,
    action_label: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemHealthSnapshot {
    alerts: Vec<SystemHealthAlert>,
    healthy: bool,
}

#[tauri::command]
async fn get_system_health() -> Result<SystemHealthSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut alerts = Vec::new();

        let disks = Disks::new_with_refreshed_list();
        for disk in disks.list() {
            if disk.total_space() > 0 {
                let used_percent = (disk.total_space() - disk.available_space()) as f64 / disk.total_space() as f64 * 100.0;
                if used_percent > 90.0 {
                    alerts.push(SystemHealthAlert {
                        severity: "critical".to_string(),
                        title: "Disk space critically low".to_string(),
                        message: format!("The volume mounted at {} is {:.0}% full. You may experience issues saving files.", disk.mount_point().to_string_lossy(), used_percent),
                        action_page: Some("storage".to_string()),
                        action_label: Some("Review Storage".to_string()),
                    });
                } else if used_percent > 80.0 {
                    alerts.push(SystemHealthAlert {
                        severity: "warning".to_string(),
                        title: "Disk space running low".to_string(),
                        message: format!("The volume mounted at {} is {:.0}% full.", disk.mount_point().to_string_lossy(), used_percent),
                        action_page: Some("storage".to_string()),
                        action_label: Some("Review Storage".to_string()),
                    });
                }
            }
        }

        if let Ok(output) = Command::new("systemctl").args(["list-units", "--state=failed", "--no-legend", "--no-pager"]).output() {
            if output.status.success() {
                let failed_count = String::from_utf8_lossy(&output.stdout).lines().count();
                if failed_count > 0 {
                    alerts.push(SystemHealthAlert {
                        severity: "critical".to_string(),
                        title: "Failed System Services".to_string(),
                        message: format!("{} systemd service(s) have failed. This may impact your system's stability.", failed_count),
                        action_page: Some("services".to_string()),
                        action_label: Some("Review Services".to_string()),
                    });
                }
            }
        }

        if let Ok(output) = Command::new("apt-get").args(["-s", "-o", "Debug::NoLocking=true", "upgrade"]).output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let upgrade_count = stdout.lines().filter(|l| l.starts_with("Inst ")).count();
                if upgrade_count > 0 {
                    alerts.push(SystemHealthAlert {
                        severity: "info".to_string(),
                        title: "System Updates Available".to_string(),
                        message: format!("{} package update(s) are available from your repositories.", upgrade_count),
                        action_page: Some("software".to_string()),
                        action_label: Some("View Updates".to_string()),
                    });
                }
            }
        }

        let mut sys = System::new();
        sys.refresh_memory();
        if sys.total_memory() > 0 {
            let mem_percent = sys.used_memory() as f64 / sys.total_memory() as f64 * 100.0;
            if mem_percent > 90.0 {
                alerts.push(SystemHealthAlert {
                    severity: "warning".to_string(),
                    title: "High Memory Usage".to_string(),
                    message: format!("System memory is {:.0}% full. Consider closing unused applications.", mem_percent),
                    action_page: Some("processes".to_string()),
                    action_label: Some("View Processes".to_string()),
                });
            }
        }

        let healthy = alerts.is_empty();
        Ok(SystemHealthSnapshot { alerts, healthy })
    })
    .await
    .map_err(|e| format!("Health check failed: {e}"))?
}

#[tauri::command]
fn get_username() -> String {
    std::env::var("USER").unwrap_or_else(|_| "User".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut system = System::new();
    system.refresh_cpu_usage();
    system.refresh_memory();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(TelemetryState(Mutex::new(system)))
        .manage(DiskActivity(Mutex::new(DiskActivityState {
            disks: Disks::new_with_refreshed_list(),
            last_sample: Instant::now(),
        })))
        .invoke_handler(tauri::generate_handler![
            get_telemetry,
            get_system_info,
            get_performance_snapshot,
            get_diagnostics_snapshot,
            get_system_health,
            get_hardware_extra,
            get_network_connections,
            get_username,
            save_text_file,
            get_temperatures,
            get_network_interfaces,
            get_network_route_info,
            get_startup_apps,
            get_package_inventory,
            clean_package_cache,
            get_services,
            get_service_action_preview,
            set_service_state,
            set_startup_enabled,
            get_storage,
            get_drive_health,
            get_partitions,
            set_partition_mounted,
            get_processes,
            scan_large_files,
            get_cache_inventory,
            clear_cache_entry,
            get_log_inventory,
            get_recent_logs,
            get_service_logs,
            terminate_process,
            force_stop_process,
            signal_process_with_authorization
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_dpkg_query_line_reads_installed_package() {
        let package = parse_dpkg_query_line(
            "installed\t7zip\t23.01+dfsg-11\tamd64\t6158\tutils\t7-Zip file archiver with a high compression ratio",
        )
        .expect("installed package");
        assert_eq!(package.name, "7zip");
        assert_eq!(package.version, "23.01+dfsg-11");
        assert_eq!(package.architecture, "amd64");
        assert_eq!(package.status, "installed");
        assert_eq!(package.section, "utils");
        assert_eq!(package.installed_size_bytes, Some(6158 * 1024));
        assert_eq!(package.summary, "7-Zip file archiver with a high compression ratio");
        assert!(!package.automatic);
        assert_eq!(package.upgrade_version, None);
    }

    #[test]
    fn parse_dpkg_query_line_skips_not_installed() {
        assert_eq!(
            parse_dpkg_query_line("not-installed\tmissing\t\tamd64\t\t\t"),
            None
        );
    }

    #[test]
    fn parse_apt_simulation_reads_upgrade_and_architecture() {
        let output = "\
Inst ca-certificates [20260601~24.04.1] (20260816ubuntu0.24.04.1 Ubuntu:24.04/noble-security [all])
Inst gir1.2-glib-2.0-dev [2.80.0-6ubuntu3.9] (2.80.0-6ubuntu3.10 Ubuntu:24.04/noble-updates [amd64]) []
Remv obsolete [1.0]
";
        let upgrades = parse_apt_simulation(output);
        assert_eq!(
            upgrades.get("ca-certificates:all").map(String::as_str),
            Some("20260816ubuntu0.24.04.1")
        );
        assert_eq!(
            upgrades.get("gir1.2-glib-2.0-dev:amd64").map(String::as_str),
            Some("2.80.0-6ubuntu3.10")
        );
        assert!(!upgrades.contains_key("obsolete"));
    }

    #[test]
    fn parse_extended_states_marks_automatic_packages() {
        let contents = "\
Package: python3-blinker
Architecture: amd64
Auto-Installed: 1

Package: argus
Architecture: amd64
Auto-Installed: 0
";
        let automatic = parse_extended_states(contents);
        assert_eq!(automatic.get("python3-blinker:amd64"), Some(&true));
        assert_eq!(automatic.get("argus:amd64"), None);
    }
}