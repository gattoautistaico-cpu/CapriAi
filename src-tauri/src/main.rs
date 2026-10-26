// Niente console su Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    cyber_ai_lib::run()
}
