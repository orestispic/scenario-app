use std::sync::Mutex;

static VAULT_LOCK: Mutex<()> = Mutex::new(());

fn entry(scope: &str) -> Result<keyring::Entry, String> {
    scoped_entry("com.scenario.commercial.session.v1", scope)
}

fn device_entry(scope: &str) -> Result<keyring::Entry, String> {
    // Keep the historical service name stable across product renames and app
    // reinstalls: changing it would make an existing PC look like a new device.
    scoped_entry("com.scenario.commercial.device-identity.v1", scope)
}

fn scoped_entry(service: &str, scope: &str) -> Result<keyring::Entry, String> {
    if !cfg!(any(target_os = "windows", target_os = "macos")) {
        return Err("System vault unsupported on this platform".into());
    }
    if scope.is_empty() || scope.len() > 256 || scope.chars().any(char::is_control) {
        return Err("Invalid session scope".into());
    }
    keyring::Entry::new(service, scope).map_err(|_| "System vault unavailable".into())
}

#[tauri::command]
pub fn read_offline_trust(scope: String) -> Result<Option<String>, String> {
    let _guard = VAULT_LOCK.lock().map_err(|_| "System vault unavailable")?;
    match scoped_entry("com.scenario.commercial.offline-trust.v1", &scope)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("System vault unavailable".into()),
    }
}

#[tauri::command]
pub fn write_offline_trust(scope: String, value: String) -> Result<(), String> {
    let _guard = VAULT_LOCK.lock().map_err(|_| "System vault unavailable")?;
    if value.len() > 2048 {
        return Err("Offline trust metadata too large".into());
    }
    scoped_entry("com.scenario.commercial.offline-trust.v1", &scope)?
        .set_password(&value)
        .map_err(|_| "System vault unavailable".into())
}

#[tauri::command]
pub fn clear_offline_trust(scope: String) -> Result<(), String> {
    let _guard = VAULT_LOCK.lock().map_err(|_| "System vault unavailable")?;
    match scoped_entry("com.scenario.commercial.offline-trust.v1", &scope)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("System vault unavailable".into()),
    }
}

#[tauri::command]
pub fn read_refresh_token(scope: String) -> Result<Option<String>, String> {
    let _guard = VAULT_LOCK.lock().map_err(|_| "System vault unavailable")?;
    match entry(&scope)?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("System vault unavailable".into()),
    }
}

#[tauri::command]
pub fn write_refresh_token(scope: String, token: String) -> Result<(), String> {
    let _guard = VAULT_LOCK.lock().map_err(|_| "System vault unavailable")?;
    if token.is_empty() || token.len() > 2048 {
        return Err("Invalid refresh token".into());
    }
    entry(&scope)?
        .set_password(&token)
        .map_err(|_| "System vault unavailable".into())
}

#[tauri::command]
pub fn clear_refresh_token(scope: String) -> Result<(), String> {
    let _guard = VAULT_LOCK.lock().map_err(|_| "System vault unavailable")?;
    match entry(&scope)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("System vault unavailable".into()),
    }
}

#[tauri::command]
pub fn read_device_identity(scope: String) -> Result<Option<String>, String> {
    let _guard = VAULT_LOCK.lock().map_err(|_| "System vault unavailable")?;
    match device_entry(&scope)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("System vault unavailable".into()),
    }
}

#[tauri::command]
pub fn write_device_identity(scope: String, value: String) -> Result<(), String> {
    let _guard = VAULT_LOCK.lock().map_err(|_| "System vault unavailable")?;
    if value.len() < 32 || value.len() > 512 || value.chars().any(char::is_control) {
        return Err("Invalid device identity".into());
    }
    device_entry(&scope)?
        .set_password(&value)
        .map_err(|_| "System vault unavailable".into())
}

#[tauri::command]
pub fn get_or_create_device_identity(scope: String, candidate: String) -> Result<String, String> {
    let _guard = VAULT_LOCK.lock().map_err(|_| "System vault unavailable")?;
    let credential = device_entry(&scope)?;
    match credential.get_password() {
        Ok(value)
            if value.len() >= 32 && value.len() <= 512 && !value.chars().any(char::is_control) =>
        {
            Ok(value)
        }
        Ok(_) => Err("Invalid stored device identity".into()),
        Err(keyring::Error::NoEntry) => {
            if candidate.len() < 32
                || candidate.len() > 512
                || candidate.chars().any(char::is_control)
            {
                return Err("Invalid device identity".into());
            }
            credential
                .set_password(&candidate)
                .map_err(|_| "System vault unavailable")?;
            Ok(candidate)
        }
        Err(_) => Err("System vault unavailable".into()),
    }
}

#[cfg(test)]
mod tests {
    // Used only by the isolated Windows CI installer test. No production command
    // exposes the test scopes or permits clearing a durable device identity.
    #[test]
    #[ignore = "Explicit isolated Windows installer lifecycle test"]
    fn native_device_lifecycle() {
        let scope = std::env::var("SENARIO_TEST_VAULT_SCOPE").expect("isolated scope");
        assert!(scope.starts_with("phase14-test-"));
        let mode = std::env::var("SENARIO_TEST_VAULT_MODE").expect("mode");
        let identity = "phase14-synthetic-device-identity-000000000001";
        if mode == "cleanup" {
            let _ = super::device_entry(&scope).unwrap().delete_credential();
            super::clear_refresh_token(scope).unwrap();
        } else if mode == "seed" {
            assert_eq!(
                super::get_or_create_device_identity(scope.clone(), identity.into()).unwrap(),
                identity
            );
            super::write_refresh_token(
                scope,
                "phase14-synthetic-refresh-not-a-real-session".into(),
            )
            .unwrap();
        } else {
            assert_eq!(mode, "verify");
            // A new process with a different proposed identity must recover the old one.
            assert_eq!(
                super::get_or_create_device_identity(
                    scope.clone(),
                    "phase14-different-candidate-00000000000002".into()
                )
                .unwrap(),
                identity
            );
            assert_eq!(
                super::read_refresh_token(scope).unwrap().as_deref(),
                Some("phase14-synthetic-refresh-not-a-real-session")
            );
        }
    }

    #[test]
    #[ignore = "Explicit local OS vault smoke test; creates and removes one synthetic credential"]
    fn native_vault_roundtrip() {
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let scope = format!("phase4-smoke-{suffix}");
        let entry = super::entry(&scope).unwrap();
        entry.set_password("synthetic-not-a-session").unwrap();
        let result = entry.get_password();
        entry.delete_credential().unwrap();
        assert_eq!(result.unwrap(), "synthetic-not-a-session");
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
    }
}
