// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    if let Some(exit_code) = kestrel_lib::handle_privileged_helper_args() {
        std::process::exit(exit_code);
    }
    kestrel_lib::run()
}
