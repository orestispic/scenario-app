mod session_vault;
use serde::{Deserialize, Serialize};
use std::{
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

const MAX_SCENARIO_SIZE: u64 = 32 * 1024 * 1024;
const MAX_PDF_SIZE: u64 = 64 * 1024 * 1024;
const MAX_BACKUP_FILES: usize = 30;

#[derive(Default)]
struct ClosePermission(Mutex<bool>);

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentScenario {
    path: String,
    title: String,
    opened_at: u128,
}

#[tauri::command]
fn launched_scenario_path() -> Option<String> {
    env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .find(|path| {
            path.is_file()
                && path
                    .extension()
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("scenario"))
        })
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn close_after_confirmation(
    app: AppHandle,
    close_permission: State<ClosePermission>,
) -> Result<(), String> {
    *close_permission
        .0
        .lock()
        .map_err(|error| error.to_string())? = true;
    app.get_webview_window("main")
        .ok_or_else(|| "Fenêtre principale introuvable.".to_string())?
        .close()
        .map_err(|error| error.to_string())
}

#[derive(Clone, Deserialize, Serialize)]
struct AiPrompt {
    id: String,
    name: String,
    instruction: String,
    #[serde(default, rename = "responseOnly")]
    response_only: bool,
}

const AI_CONFIG_VERSION: u32 = 1;

#[derive(Clone, Deserialize, Serialize)]
struct StoredAiConfig {
    #[serde(default)]
    version: u32,
    prompts: Vec<AiPrompt>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiConfigDraft {
    prompts: Vec<AiPrompt>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiConfigView {
    prompts: Vec<AiPrompt>,
}

#[tauri::command]
fn read_scenario(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Impossible d’ouvrir le scénario : {error}"))?;
    if metadata.len() > MAX_SCENARIO_SIZE {
        return Err(
            "Ce fichier .scenario est trop volumineux pour être ouvert en sécurité.".to_string(),
        );
    }
    fs::read_to_string(path).map_err(|error| format!("Impossible d’ouvrir le scénario : {error}"))
}

#[tauri::command]
fn read_pdf(path: String) -> Result<Vec<u8>, String> {
    let path = PathBuf::from(path);
    if !path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
    {
        return Err("Le fichier sélectionné n’est pas un PDF.".to_string());
    }
    let metadata =
        fs::metadata(&path).map_err(|error| format!("Impossible d’ouvrir le PDF : {error}"))?;
    if metadata.len() > MAX_PDF_SIZE {
        return Err("Ce PDF est trop volumineux pour être importé en sécurité.".to_string());
    }
    fs::read(path).map_err(|error| format!("Impossible de lire le PDF : {error}"))
}

#[tauri::command]
fn write_scenario(path: String, contents: String) -> Result<(), String> {
    ensure_scenario_size(contents.len(), "enregistré")?;
    write_scenario_safely(PathBuf::from(path), contents)
}

#[tauri::command]
fn read_recent_scenarios(app: AppHandle) -> Result<Vec<RecentScenario>, String> {
    let path = app_storage_path(&app, "recent-scenarios.json")?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Impossible de lire les projets récents : {error}"))?;
    serde_json::from_str(&contents)
        .map_err(|error| format!("Liste des projets récents invalide : {error}"))
}

#[tauri::command]
fn record_recent_scenario(app: AppHandle, path: String) -> Result<Vec<RecentScenario>, String> {
    let storage_path = app_storage_path(&app, "recent-scenarios.json")?;
    let mut recent = if storage_path.exists() {
        let contents = fs::read_to_string(&storage_path)
            .map_err(|error| format!("Impossible de lire les projets récents : {error}"))?;
        serde_json::from_str::<Vec<RecentScenario>>(&contents).unwrap_or_default()
    } else {
        Vec::new()
    };

    recent.retain(|entry| !entry.path.eq_ignore_ascii_case(&path));
    recent.insert(
        0,
        RecentScenario {
            title: scenario_title_from_path(&path),
            path,
            opened_at: unix_millis()?,
        },
    );
    recent.truncate(8);
    write_internal_file(
        storage_path,
        serde_json::to_string_pretty(&recent).map_err(|error| error.to_string())?,
        "les projets récents",
    )?;
    Ok(recent)
}

#[tauri::command]
fn write_pdf(path: String, contents: Vec<u8>) -> Result<(), String> {
    write_bytes_atomically(PathBuf::from(path), &contents, "le PDF")
}

#[tauri::command]
fn write_autosave(app: AppHandle, contents: String) -> Result<(), String> {
    ensure_scenario_size(contents.len(), "sauvegardé automatiquement")?;
    let path = app_storage_path(&app, "autosave/recovery.scenario")?;
    write_internal_file(path, contents, "la sauvegarde automatique")
}

#[tauri::command]
fn write_backup(app: AppHandle, contents: String) -> Result<(), String> {
    ensure_scenario_size(contents.len(), "copié dans les sauvegardes de secours")?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let path = app_storage_path(&app, &format!("backups/backup-{timestamp}.scenario"))?;
    write_internal_file(path, contents, "la sauvegarde de secours")?;
    if let Ok(directory) = app_storage_path(&app, "backups") {
        prune_old_backups(&directory, MAX_BACKUP_FILES);
    }
    Ok(())
}

#[tauri::command]
fn read_recovery(app: AppHandle) -> Result<Option<String>, String> {
    let path = app_storage_path(&app, "autosave/recovery.scenario")?;
    if !path.exists() {
        return Ok(None);
    }

    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Impossible de lire la sauvegarde automatique : {error}"))?;
    if metadata.len() > MAX_SCENARIO_SIZE {
        return Err(
            "La sauvegarde automatique est trop volumineuse pour être ouverte en sécurité."
                .to_string(),
        );
    }

    fs::read_to_string(path)
        .map(Some)
        .map_err(|error| format!("Impossible de lire la sauvegarde automatique : {error}"))
}

#[tauri::command]
fn clear_recovery(app: AppHandle) -> Result<(), String> {
    let path = app_storage_path(&app, "autosave/recovery.scenario")?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| {
            format!("Impossible d’effacer la récupération abandonnée : {error}")
        })?;
    }
    Ok(())
}

#[tauri::command]
fn read_ai_config(app: AppHandle) -> Result<AiConfigView, String> {
    stored_ai_config(&app).map(|config| AiConfigView {
        prompts: config.prompts,
    })
}

#[tauri::command]
fn write_ai_config(app: AppHandle, config: AiConfigDraft) -> Result<AiConfigView, String> {
    let stored_config = StoredAiConfig {
        version: AI_CONFIG_VERSION,
        prompts: normalize_prompts(config.prompts),
    };
    let path = app_storage_path(&app, "ai/config.json")?;
    write_internal_file(
        path,
        serde_json::to_string_pretty(&stored_config).map_err(|error| error.to_string())?,
        "la configuration IA",
    )?;

    Ok(AiConfigView {
        prompts: stored_config.prompts,
    })
}

fn app_storage_path(app: &AppHandle, relative_path: &str) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(relative_path))
        .map_err(|error| error.to_string())
}

fn ensure_scenario_size(size: usize, action: &str) -> Result<(), String> {
    if size as u64 > MAX_SCENARIO_SIZE {
        Err(format!(
            "Ce scénario est trop volumineux pour être {action} en sécurité."
        ))
    } else {
        Ok(())
    }
}

fn write_internal_file(path: PathBuf, contents: String, label: &str) -> Result<(), String> {
    write_bytes_atomically(path, contents.as_bytes(), label)
}

fn write_bytes_atomically(path: PathBuf, contents: &[u8], label: &str) -> Result<(), String> {
    let directory = path
        .parent()
        .ok_or_else(|| format!("Dossier invalide pour {label}."))?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("Impossible de créer le dossier de {label} : {error}"))?;
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Nom de fichier invalide pour {label}."))?;
    let nonce = format!("{}-{}", std::process::id(), unix_millis()?);
    let temporary = directory.join(format!(".{filename}.{nonce}.tmp"));
    let previous = directory.join(format!(".{filename}.{nonce}.previous"));

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| format!("Impossible de préparer {label} : {error}"))?;
    if let Err(error) = file.write_all(contents).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Impossible d’écrire {label} : {error}"));
    }
    drop(file);

    if !path.exists() {
        return match fs::rename(&temporary, &path) {
            Ok(()) => Ok(()),
            Err(error) => {
                let _ = fs::remove_file(&temporary);
                Err(format!("Impossible de finaliser {label} : {error}"))
            }
        };
    }

    if let Err(error) = fs::rename(&path, &previous) {
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "Impossible de préparer le remplacement de {label} : {error}"
        ));
    }

    if let Err(error) = fs::rename(&temporary, &path) {
        let restoration = fs::rename(&previous, &path);
        let _ = fs::remove_file(&temporary);
        return match restoration {
            Ok(()) => Err(format!("Impossible de finaliser {label} ; l’ancienne version a été restaurée : {error}")),
            Err(restore_error) => Err(format!(
                "Impossible de finaliser {label} ({error}) ni de restaurer automatiquement l’ancienne version ({restore_error}). Copie récupérable : {}",
                previous.display()
            )),
        };
    }

    let _ = fs::remove_file(previous);
    Ok(())
}

fn write_scenario_safely(path: PathBuf, contents: String) -> Result<(), String> {
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Nom de scénario invalide.".to_string())?;

    if path.exists() {
        let backup = path.with_file_name(format!("{filename}.bak"));
        let previous_contents = fs::read(&path)
            .map_err(|error| format!("Impossible de lire la version à sauvegarder : {error}"))?;
        write_bytes_atomically(backup, &previous_contents, "la copie .bak")?;
    }

    write_bytes_atomically(path, contents.as_bytes(), "le scénario")
}

fn prune_old_backups(directory: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let mut backups: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("backup-") && name.ends_with(".scenario"))
        })
        .collect();
    backups.sort();
    let remove_count = backups.len().saturating_sub(keep);
    for path in backups.into_iter().take(remove_count) {
        let _ = fs::remove_file(path);
    }
}

fn unix_millis() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())
        .map(|duration| duration.as_millis())
}

fn scenario_title_from_path(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|name| name.to_str())
        .filter(|title| !title.is_empty())
        .unwrap_or("Sans titre")
        .to_string()
}

fn stored_ai_config(app: &AppHandle) -> Result<StoredAiConfig, String> {
    let path = app_storage_path(app, "ai/config.json")?;
    if !path.exists() {
        return Ok(default_ai_config());
    }

    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("Impossible de lire la configuration IA : {error}"))?;
    let mut config: StoredAiConfig = serde_json::from_str(&contents)
        .map_err(|error| format!("Configuration IA invalide : {error}"))?;
    migrate_ai_config(&mut config);
    config.prompts = normalize_prompts(config.prompts);
    // Phase 5 removes any legacy provider key/model from disk as soon as the
    // configuration is read. Only user-authored prompt presets remain local.
    let sanitized = serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;
    if sanitized.trim() != contents.trim() {
        write_internal_file(path, sanitized, "la configuration IA")?;
    }
    Ok(config)
}

fn migrate_ai_config(config: &mut StoredAiConfig) {
    if config.version < AI_CONFIG_VERSION {
        // Migre une seule fois les configurations créées avant que
        // « Réponse uniquement » soit activé par défaut. Les changements
        // explicites de l'utilisateur restent ensuite persistants.
        for prompt in &mut config.prompts {
            prompt.response_only = true;
        }
        config.version = AI_CONFIG_VERSION;
    }
}

fn default_ai_config() -> StoredAiConfig {
    StoredAiConfig {
        version: AI_CONFIG_VERSION,
        prompts: vec![
            AiPrompt {
                id: "correct".to_string(),
                name: "Corriger les fautes".to_string(),
                instruction: "Corrige les fautes de ce texte sans changer le style, le sens ni la mise en forme.".to_string(),
                response_only: true,
            },
            AiPrompt {
                id: "translate-en".to_string(),
                name: "Traduire en anglais".to_string(),
                instruction: "Traduis ce texte en anglais en gardant le ton, le sous-texte et l'intention.".to_string(),
                response_only: true,
            },
            AiPrompt {
                id: "shorten".to_string(),
                name: "Raccourcir".to_string(),
                instruction: "Raccourcis ce texte en gardant les informations importantes et le rythme de scénario.".to_string(),
                response_only: true,
            },
        ],
    }
}

fn normalize_prompts(prompts: Vec<AiPrompt>) -> Vec<AiPrompt> {
    let prompts: Vec<AiPrompt> = prompts
        .into_iter()
        .filter_map(|prompt| {
            // Retire les deux anciens prompts inclus par l'application, tout en
            // conservant les prompts ajoutés par l'utilisateur.
            if matches!(prompt.id.as_str(), "style" | "dialogue") {
                return None;
            }

            let name = prompt.name.trim();
            let instruction = prompt.instruction.trim();
            if name.is_empty() || instruction.is_empty() {
                return None;
            }

            Some(AiPrompt {
                id: if prompt.id.trim().is_empty() {
                    format!("prompt-{}", name.to_lowercase().replace(' ', "-"))
                } else {
                    prompt.id
                },
                name: name.to_string(),
                instruction: instruction.to_string(),
                response_only: prompt.response_only,
            })
        })
        .collect();

    if prompts.is_empty() {
        default_ai_config().prompts
    } else {
        prompts
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ClosePermission::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            session_vault::read_refresh_token,
            session_vault::write_refresh_token,
            session_vault::clear_refresh_token,
            session_vault::read_device_identity,
            session_vault::write_device_identity,
            session_vault::get_or_create_device_identity,
            session_vault::read_offline_trust,
            session_vault::write_offline_trust,
            session_vault::clear_offline_trust,
            launched_scenario_path,
            read_scenario,
            read_pdf,
            write_scenario,
            read_recent_scenarios,
            record_recent_scenario,
            write_pdf,
            write_autosave,
            write_backup,
            read_recovery,
            clear_recovery,
            read_ai_config,
            write_ai_config,
            close_after_confirmation
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let close_permission = window.state::<ClosePermission>();
                let mut permission = match close_permission.0.lock() {
                    Ok(permission) => permission,
                    Err(_) => {
                        api.prevent_close();
                        return;
                    }
                };

                if *permission {
                    *permission = false;
                } else {
                    api.prevent_close();
                    let _ = window.emit("scenario-close-requested", ());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replaces_a_scenario_and_preserves_the_previous_version() {
        let directory = std::env::temp_dir().join(format!(
            "scenario-app-save-test-{}-{}",
            std::process::id(),
            unix_millis().expect("clock")
        ));
        fs::create_dir_all(&directory).expect("test directory");
        let path = directory.join("film.scenario");

        write_scenario_safely(path.clone(), "première version".to_string()).expect("first save");
        write_scenario_safely(path.clone(), "deuxième version".to_string()).expect("second save");

        assert_eq!(
            fs::read_to_string(&path).expect("current"),
            "deuxième version"
        );
        assert_eq!(
            fs::read_to_string(directory.join("film.scenario.bak")).expect("backup"),
            "première version"
        );
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[test]
    fn removes_legacy_ai_prompts_and_keeps_the_three_supported_actions() {
        let prompts = normalize_prompts(vec![
            AiPrompt {
                id: "style".into(),
                name: "Ancien style".into(),
                instruction: "Ancien".into(),
                response_only: false,
            },
            AiPrompt {
                id: "correct".into(),
                name: "Corriger les fautes".into(),
                instruction: "Corrige".into(),
                response_only: false,
            },
        ]);
        assert_eq!(prompts.len(), 1);
        assert_eq!(prompts[0].id, "correct");
        assert_eq!(default_ai_config().prompts.len(), 3);
    }

    #[test]
    fn enables_response_only_once_for_legacy_ai_configs() {
        let mut config: StoredAiConfig = serde_json::from_str(
            r#"{"prompts":[{"id":"custom","name":"Test","instruction":"Réécris","responseOnly":false}]}"#,
        )
        .expect("legacy config");

        migrate_ai_config(&mut config);
        assert_eq!(config.version, AI_CONFIG_VERSION);
        assert!(config.prompts[0].response_only);

        config.prompts[0].response_only = false;
        migrate_ai_config(&mut config);
        assert!(!config.prompts[0].response_only);
    }

    #[test]
    fn enforces_the_same_size_limit_for_every_scenario_save() {
        assert!(ensure_scenario_size(MAX_SCENARIO_SIZE as usize, "testé").is_ok());
        assert!(ensure_scenario_size(MAX_SCENARIO_SIZE as usize + 1, "testé").is_err());
    }
}
