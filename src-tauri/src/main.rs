// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(exit_code) = argus_lib::handle_privileged_helper_args() {
        std::process::exit(exit_code);
    }
    argus_lib::run()
}