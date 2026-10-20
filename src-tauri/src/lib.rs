use std::sync::Mutex;

use serde::Serialize;
use sysinfo::{Disks, ProcessRefreshKind, ProcessesToUpdate, System};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TelemetrySnapshot {
    cpu_usage_percent: f32,
    memory_used_bytes: u64,
    memory_total_bytes: u64,
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
struct ProcessSnapshot {
    pid: u32,
    name: String,
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
            cpu_usage_percent: process.cpu_usage(),
            memory_bytes: process.memory(),
        })
        .collect())
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
        .invoke_handler(tauri::generate_handler![get_telemetry, get_storage, get_processes])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}