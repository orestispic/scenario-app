fn main() {
    tauri_build::build();
    // Tauri embeds this dependency in the application binary, but Cargo's lib
    // test executable otherwise loads Common Controls v5 (no TaskDialogIndirect).
    // Only the opt-in native updater harness constructs a real Tauri runtime.
    if std::env::var_os("CARGO_FEATURE_NATIVE_VALIDATION").is_some()
        && std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
    {
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }
}
