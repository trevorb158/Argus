use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

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
        .manage(TelemetryState(Mutex::new(system)))
        .invoke_handler(tauri::generate_handler![
            get_telemetry,
            get_temperatures,
            get_network_interfaces,
            get_startup_apps,
            get_storage,
            get_partitions,
            get_processes,
            terminate_process
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}