// no console window behind the app in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    pixel_to_3d_lib::run()
}
