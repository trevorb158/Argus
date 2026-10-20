use std::collections::BTreeMap;
use std::env;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sysinfo::{Components, Disks, Networks, Pid, ProcessRefreshKind, ProcessesToUpdate, Signal, System};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TelemetrySnapshot {
    cpu_usage_percent: f32,
    memory_used_bytes: u64,
    memory_total_bytes: u64,
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
struct TemperatureSnapshot {
    label: String,
    temperature_celsius: f32,
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
struct StartupAppSnapshot {
    id: String,
    name: String,
    command: String,
    source: String,
    enabled: bool,
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
}

struct TelemetryState(Mutex<System>);

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
fn save_diagnostics_report(path: String, report: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if path.extension().and_then(|extension| extension.to_str()) != Some("txt") {
        return Err("Choose a .txt file for the diagnostics report".to_string());
    }
    fs::write(&path, report).map_err(|error| format!("Could not save diagnostics report: {error}"))
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

    Ok(services.into_values().collect())
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

#[tauri::command]
fn set_startup_enabled(
    id: String,
    enabled: bool,
    expected_enabled: bool,
) -> Result<StartupAppSnapshot, String> {
    let file_name = Path::new(&id).file_name().and_then(|name| name.to_str());
    if file_name != Some(id.as_str()) || Path::new(&id).extension().and_then(|ext| ext.to_str()) != Some("desktop") {
        return Err("Invalid startup entry identifier.".to_string());
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
        return Err("This entry has no launch command, so Kestrel cannot safely change it.".to_string());
    }

    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let updated_contents = update_desktop_entry(&contents, enabled)?;
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
    let temporary_path = directory.join(format!(".{id}.kestrel-{}.tmp", std::process::id()));

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
    let mut directories = env::var_os("XDG_CONFIG_DIRS")
        .map(|paths| env::split_paths(&paths).collect::<Vec<_>>())
        .unwrap_or_else(|| vec![PathBuf::from("/etc/xdg")]);
    directories.reverse();

    let mut entries = BTreeMap::new();
    for directory in directories {
        read_autostart_directory(
            &directory.join("autostart"),
            "System",
            &mut entries,
            true,
        )?;
    }

    let user_config = env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")));
    if let Some(user_config) = user_config {
        read_autostart_directory(
            &user_config.join("autostart"),
            "User",
            &mut entries,
            true,
        )?;
    }

    let mut applications = entries.into_values().collect::<Vec<_>>();
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
            })
        })
        .collect()
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

    let root = env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".cache")))
        .ok_or_else(|| "Could not find this account's cache folder".to_string())?;

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
        .map(|(name, (size_bytes, file_count))| CacheEntrySnapshot {
            name,
            size_bytes,
            file_count,
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
            .without_tasks(),
    );

    Ok(system
        .processes()
        .iter()
        .map(|(pid, process)| ProcessSnapshot {
            pid: pid.as_u32(),
            name: process.name().to_string_lossy().into_owned(),
            start_time: process.start_time(),
            parent_pid: process.parent().map(|parent| parent.as_u32()),
            status: format!("{:?}", process.status()),
            run_time_seconds: process.run_time(),
            cpu_usage_percent: process.cpu_usage(),
            memory_bytes: process.memory(),
        })
        .collect())
}

#[tauri::command]
fn terminate_process(
    state: tauri::State<'_, TelemetryState>,
    pid: u32,
    expected_name: String,
    expected_start_time: u64,
) -> Result<(), String> {
    if pid == 1 {
        return Err("Kestrel will not terminate the system's init process.".to_string());
    }

    let target_pid = Pid::from_u32(pid);
    if sysinfo::get_current_pid().is_ok_and(|current_pid| current_pid == target_pid) {
        return Err("Kestrel will not terminate itself.".to_string());
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
    if process.start_time() != expected_start_time
        || process.name().to_string_lossy() != expected_name
    {
        return Err("The process changed since the list was refreshed. Review the updated list and try again.".to_string());
    }

    match process.kill_with(Signal::Term) {
        Some(true) => Ok(()),
        Some(false) => Err("Linux did not allow Kestrel to send the termination request. The process may require higher privileges.".to_string()),
        None => Err("Normal termination is not supported on this system.".to_string()),
    }
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut system = System::new();
    system.refresh_cpu_usage();
    system.refresh_memory();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(TelemetryState(Mutex::new(system)))
        .invoke_handler(tauri::generate_handler![
            get_telemetry,
            get_system_info,
            get_diagnostics_snapshot,
            save_diagnostics_report,
            get_temperatures,
            get_network_interfaces,
            get_startup_apps,
            get_services,
            set_startup_enabled,
            get_storage,
            get_partitions,
            get_processes,
            scan_large_files,
            get_cache_inventory,
            get_log_inventory,
            terminate_process
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}