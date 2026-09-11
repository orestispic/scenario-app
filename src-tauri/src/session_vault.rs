use std::sync::Mutex;

static VAULT_LOCK: Mutex<()> = Mutex::new(());

fn entry(scope: &str) -> Result<keyring::Entry, String> {
    scoped_entry("com.scenario.commercial.session.v1", scope)
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

#[cfg(test)]
mod tests {
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
