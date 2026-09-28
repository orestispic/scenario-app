// Compiled only into the Rust test binary; never exposed as an app command.
use tauri_plugin_updater::UpdaterExt;

#[test]
#[ignore = "Real installer execution, exclusively on an ephemeral GitHub Windows runner"]
fn native_updater_probe() {
    assert_eq!(std::env::var("GITHUB_ACTIONS").as_deref(), Ok("true"));
    assert_eq!(std::env::var("RUNNER_ENVIRONMENT").as_deref(), Ok("github-hosted"));
    let endpoint = std::env::var("SENARIO_UPDATER_TEST_ENDPOINT").unwrap();
    let url: reqwest::Url = endpoint.parse().unwrap();
    assert_eq!(url.scheme(), "http"); assert_eq!(url.host_str(), Some("127.0.0.1"));
    let pubkey = std::env::var("SENARIO_UPDATER_TEST_PUBKEY").unwrap();
    let mode = std::env::var("SENARIO_UPDATER_TEST_MODE").unwrap();
    assert!(matches!(mode.as_str(), "tampered" | "install"));
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().plugins.0.insert("updater".into(), serde_json::json!({
        "pubkey": pubkey, "endpoints": [endpoint], "dangerousInsecureTransportProtocol": true,
        "windows": { "installMode": "quiet" }
    }));
    // The harness reads this version from the installed baseline executable.
    context.package_info_mut().version = std::env::var("SENARIO_UPDATER_TEST_INSTALLED_VERSION").unwrap().parse().unwrap();
    let app = tauri::Builder::default().any_thread().plugin(tauri_plugin_updater::Builder::new().build()).build(context).unwrap();
    tauri::async_runtime::block_on(async {
        let updater = app.handle().updater().unwrap();
        let update = updater.check().await.unwrap().expect("A newer test candidate must be offered");
        let result = update.download(|_, _| {}, || {}).await;
        if mode == "tampered" {
            let error = result.expect_err("A corrupted package must never be installed").to_string();
            assert!(error.to_lowercase().contains("signature"), "Unexpected failure: {error}");
            println!("PASS: real Tauri download rejected a corrupted installer signature.");
        } else {
            let bytes = result.unwrap();
            let evidence = std::path::PathBuf::from(std::env::var("RUNNER_TEMP").unwrap()).join("senario-phase14/updater-download-verified.json");
            std::fs::write(evidence, serde_json::to_vec_pretty(&serde_json::json!({
                "version": update.version, "bytes": bytes.len(), "signature": "verified-by-tauri", "key": "ephemeral-fixture-only"
            })).unwrap()).unwrap();
            update.restart_after_install(false).install(bytes).unwrap();
            panic!("Windows updater installation must exit the probe process");
        }
    });
}
