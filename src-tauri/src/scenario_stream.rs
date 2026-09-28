//! Portable JSON on disk, bounded metadata across IPC, images read on demand.
use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};
use std::{fs, io::{BufReader, Read, Write}, path::{Path, PathBuf}, sync::Mutex};
use tauri::{AppHandle, Manager, State};

const CORE_LIMIT: usize = 32 * 1024 * 1024;
const FILE_LIMIT: u64 = 512 * 1024 * 1024;
const IMAGE_LIMIT: usize = 300 * 1024;
const CACHE_LIMIT: u64 = 2 * 1024 * 1024 * 1024;
const PREFIX: &str = "http://senario-image.localhost/";
#[derive(Default)]
pub struct ImageStore(pub Mutex<()>);

fn cache(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("scenario-images-v1");
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}
fn image_bytes(value: &str) -> Result<(&str, Vec<u8>), String> {
    let (header, encoded) = value.split_once(',').ok_or("Image invalide.")?;
    let mime = header.strip_prefix("data:").and_then(|v| v.strip_suffix(";base64")).ok_or("Image invalide.")?;
    if !matches!(mime, "image/png" | "image/jpeg" | "image/webp") || encoded.len() > IMAGE_LIMIT.div_ceil(3) * 4 {
        return Err("Image invalide ou supérieure à 300 Kio.".into());
    }
    let bytes = STANDARD.decode(encoded).map_err(|_| "Encodage d’image invalide.")?;
    if bytes.is_empty() || bytes.len() > IMAGE_LIMIT { return Err("Taille d’image invalide.".into()); }
    Ok((mime, bytes))
}
fn token(value: &str) -> Result<&str, String> {
    let key = value.strip_prefix(PREFIX).ok_or("Référence locale invalide.")?;
    if key.len() != 64 || !key.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) { return Err("Référence locale invalide.".into()); }
    Ok(key)
}
fn store(root: &Path, value: &str) -> Result<String, String> {
    image_bytes(value)?;
    // A persistent random salt prevents an imported document from guessing URLs
    // of other private images. It also permits stable deduplication after restart.
    let salt_path = root.join("salt");
    let salt = if salt_path.exists() { fs::read(&salt_path).map_err(|e| e.to_string())? } else {
        let salt = uuid::Uuid::new_v4().as_bytes().to_vec();
        fs::write(&salt_path, &salt).map_err(|e| e.to_string())?; salt
    };
    if salt.len() != 16 { return Err("Cache d’images invalide.".into()); }
    let mut digest = Sha256::new(); digest.update(salt); digest.update(value.as_bytes());
    let key = format!("{:x}", digest.finalize());
    let path = root.join(format!("{key}.json"));
    if !path.exists() {
        let occupied: u64 = fs::read_dir(root).map_err(|e| e.to_string())?.filter_map(Result::ok)
            .filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum();
        if occupied + value.len() as u64 + 2 > CACHE_LIMIT { return Err("Le cache local d’images a atteint 2 Gio. Aucune donnée n’a été effacée.".into()); }
        let quoted = serde_json::to_string(value).map_err(|e| e.to_string())?;
        super::write_bytes_atomically(path, quoted.as_bytes(), "l’image locale")?;
    }
    Ok(format!("{PREFIX}{key}"))
}
fn image_json(root: &Path, url: &str) -> Result<Vec<u8>, String> {
    let path = root.join(format!("{}.json", token(url)?));
    let bytes = super::read_bounded_file(&path, (IMAGE_LIMIT * 4 / 3 + 128) as u64)?;
    let value: String = serde_json::from_slice(&bytes).map_err(|_| "Image locale corrompue.")?;
    image_bytes(&value)?;
    // Verify that the persistent cache still contains the bytes named by its URL.
    let salt = fs::read(root.join("salt")).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new(); hash.update(salt); hash.update(value.as_bytes());
    if format!("{:x}", hash.finalize()) != token(url)? { return Err("Intégrité de l’image locale invalide.".into()); }
    Ok(bytes)
}

// Tokenize JSON incrementally; only a single string and the compact metadata
// are retained. serde_json validates the complete compact document afterwards.
fn compact(reader: impl Read, root: &Path) -> Result<String, String> {
    let mut source = BufReader::new(reader.take(FILE_LIMIT + 1)).bytes();
    let mut output = Vec::new(); let mut count = 0u64;
    let mut last_string = String::new(); let mut image_value = false;
    while let Some(byte) = source.next() {
        let byte = byte.map_err(|e| e.to_string())?; count += 1;
        if count > FILE_LIMIT { return Err("Le projet dépasse 512 Mio.".into()); }
        if byte == b'"' {
            let mut quoted = vec![byte]; let mut escaped = false; let mut closed = false;
            for item in source.by_ref() {
                let b = item.map_err(|e| e.to_string())?; count += 1; quoted.push(b);
                if count > FILE_LIMIT || quoted.len() > CORE_LIMIT { return Err("Texte trop volumineux (limite 32 Mio hors images).".into()); }
                if b == b'"' && !escaped { closed = true; break; }
                escaped = b == b'\\' && !escaped;
            }
            if !closed { return Err("Projet tronqué ; fichier inchangé.".into()); }
            let value: String = serde_json::from_slice(&quoted).map_err(|_| "Texte JSON ou UTF-8 invalide.")?;
            if value.starts_with(PREFIX) { return Err("Une référence privée ne peut pas être importée depuis un fichier.".into()); }
            if image_value && value.starts_with("data:image/") {
                output.extend_from_slice(serde_json::to_string(&store(root, &value)?).unwrap().as_bytes());
            } else { output.extend_from_slice(&quoted); }
            last_string = value; image_value = false;
        } else {
            output.push(byte);
            if !byte.is_ascii_whitespace() { image_value = byte == b':' && last_string == "dataUrl"; }
        }
        if output.len() > CORE_LIMIT { return Err("Le texte du projet dépasse 32 Mio hors images.".into()); }
    }
    let output = String::from_utf8(output).map_err(|_| "Texte UTF-8 invalide.")?;
    let mut parser = serde_json::Deserializer::from_str(output.trim_start_matches('\u{feff}'));
    serde::de::IgnoredAny::deserialize(&mut parser).map_err(|_| "Projet JSON corrompu ou trop imbriqué.")?;
    parser.end().map_err(|_| "Contenu supplémentaire après le projet.")?;
    Ok(output.trim_start_matches('\u{feff}').to_owned())
}
use serde::Deserialize;

fn expand(contents: &str, root: &Path, writer: &mut dyn Write) -> Result<(), String> {
    if contents.len() > CORE_LIMIT { return Err("Le texte du projet dépasse 32 Mio hors images.".into()); }
    // Parse only the bounded compact JSON, then serialize recursively to disk.
    let document: serde_json::Value = serde_json::from_str(contents).map_err(|_| "Projet JSON invalide.")?;
    fn emit(value: &serde_json::Value, root: &Path, out: &mut dyn Write, size: &mut u64) -> Result<(), String> {
        let mut write = |bytes: &[u8]| -> Result<(), String> {
            *size += bytes.len() as u64;
            if *size > FILE_LIMIT { return Err("Le projet dépasse 512 Mio.".into()); }
            out.write_all(bytes).map_err(|e| e.to_string())
        };
        match value {
            serde_json::Value::String(s) if s.starts_with(PREFIX) => write(&image_json(root, s)?),
            serde_json::Value::Array(values) => {
                write(b"[")?;
                for (i, item) in values.iter().enumerate() { if i > 0 { out.write_all(b",").map_err(|e| e.to_string())?; *size += 1; } emit(item, root, out, size)?; }
                out.write_all(b"]").map_err(|e| e.to_string())?; *size += 1; Ok(())
            }
            serde_json::Value::Object(values) => {
                write(b"{")?;
                for (i, (key, item)) in values.iter().enumerate() {
                    if i > 0 { out.write_all(b",").map_err(|e| e.to_string())?; *size += 1; }
                    let key = serde_json::to_vec(key).unwrap(); *size += key.len() as u64 + 1;
                    out.write_all(&key).and_then(|_| out.write_all(b":")).map_err(|e| e.to_string())?;
                    emit(item, root, out, size)?;
                }
                out.write_all(b"}").map_err(|e| e.to_string())?; *size += 1; Ok(())
            }
            _ => write(&serde_json::to_vec(value).map_err(|e| e.to_string())?),
        }
    }
    let mut size = 0; emit(&document, root, writer, &mut size)?;
    if size > FILE_LIMIT { return Err("Le projet dépasse 512 Mio.".into()); } Ok(())
}
fn read(path: &Path, root: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > FILE_LIMIT { return Err("Fichier invalide ou supérieur à 512 Mio.".into()); }
    compact(file, root)
}
#[tauri::command]
pub fn read_scenario_streamed(app: AppHandle, state: State<ImageStore>, path: String) -> Result<String, String> {
    let _lock = state.0.lock().map_err(|e| e.to_string())?;
    read(Path::new(&path), &cache(&app)?)
}
#[tauri::command]
pub fn read_recovery_streamed(app: AppHandle, state: State<ImageStore>) -> Result<Option<String>, String> {
    let path = super::app_storage_path(&app, "autosave/recovery.scenario")?;
    if !path.exists() { return Ok(None); }
    read_scenario_streamed(app, state, path.to_string_lossy().into_owned()).map(Some)
}
#[tauri::command]
pub fn cache_scenario_image(app: AppHandle, state: State<ImageStore>, data_url: String) -> Result<String, String> {
    let _lock = state.0.lock().map_err(|e| e.to_string())?;
    store(&cache(&app)?, &data_url)
}
#[tauri::command]
pub fn read_scenario_image(app: AppHandle, url: String) -> Result<String, String> {
    serde_json::from_slice(&image_json(&cache(&app)?, &url)?).map_err(|e| e.to_string())
}
pub fn serve(app: &AppHandle, url: &str) -> Result<(String, Vec<u8>), String> {
    let value: String = serde_json::from_slice(&image_json(&cache(app)?, url)?).map_err(|e| e.to_string())?;
    let (mime, bytes) = image_bytes(&value)?; Ok((mime.to_owned(), bytes))
}
#[tauri::command]
pub fn write_scenario_streamed(app: AppHandle, state: State<ImageStore>, path: Option<String>, kind: String, contents: String) -> Result<(), String> {
    let _lock = state.0.lock().map_err(|e| e.to_string())?;
    let root = cache(&app)?;
    let destination = match kind.as_str() {
        "write_scenario" => PathBuf::from(path.ok_or("Chemin manquant.")?),
        "write_autosave" => super::app_storage_path(&app, "autosave/recovery.scenario")?,
        "write_backup" => super::app_storage_path(&app, &format!("backups/backup-{}.scenario", super::unix_millis()?))?,
        _ => return Err("Opération de sauvegarde invalide.".into()),
    };
    // Complete expansion in a temporary file before touching the original or .bak.
    let parent = destination.parent().ok_or("Dossier invalide.")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let prepared = parent.join(format!(".senario-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut output = fs::OpenOptions::new().write(true).create_new(true).open(&prepared).map_err(|e| e.to_string())?;
        expand(&contents, &root, &mut output)?;
        output.sync_all().map_err(|e| e.to_string())?; drop(output);
        if kind == "write_scenario" && destination.exists() {
            let file = fs::File::open(&destination).map_err(|e| e.to_string())?;
            if file.metadata().map_err(|e| e.to_string())?.len() > FILE_LIMIT { return Err("L’ancienne version dépasse 512 Mio ; fichier inchangé.".into()); }
            let backup = destination.with_file_name(format!("{}.bak", destination.file_name().unwrap().to_string_lossy()));
            super::write_stream_atomically(backup, "la copie .bak", |out| {
                let copied = std::io::copy(&mut file.take(FILE_LIMIT + 1), out).map_err(|e| e.to_string())?;
                if copied > FILE_LIMIT { return Err("L’ancienne version a grandi ; fichier inchangé.".into()); } Ok(())
            })?;
        }
        super::write_stream_atomically(destination, "le scénario", |out| {
            std::io::copy(&mut fs::File::open(&prepared).map_err(|e| e.to_string())?, out).map_err(|e| e.to_string())?; Ok(())
        })?;
        if kind == "write_backup" { super::prune_old_backups(&super::app_storage_path(&app, "backups")?, super::MAX_BACKUP_FILES); }
        Ok(())
    })();
    let _ = fs::remove_file(prepared); result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf { let p = std::env::temp_dir().join(format!("senario-stream-test-{}", uuid::Uuid::new_v4())); fs::create_dir(&p).unwrap(); p }
    #[test]
    fn portable_roundtrip_rejects_forged_refs_missing_cache_and_corruption() {
        let root = root();
        let input = r#"{"technicalImageAssets":{"a":{"dataUrl":"data:image/png;base64,AQID"}},"title":"écriture"}"#;
        let compacted = compact(input.as_bytes(), &root).unwrap();
        assert!(compacted.contains(PREFIX)); assert!(!compacted.contains("AQID"));
        let mut output = Vec::new(); expand(&compacted, &root, &mut output).unwrap();
        assert_eq!(serde_json::from_slice::<serde_json::Value>(&output).unwrap(), serde_json::from_str::<serde_json::Value>(input).unwrap());
        assert!(compact(compacted.as_bytes(), &root).is_err());
        assert!(compact(&b"{\"title\":\"truncated"[..], &root).is_err());
        assert!(compact(&b"{}{}"[..], &root).is_err());
        assert!(compact(&b"{\"title\":\"\xff\"}"[..], &root).is_err());
        let url = store(&root, "data:image/png;base64,AQID").unwrap();
        fs::write(root.join(format!("{}.json", token(&url).unwrap())), b"\"data:image/png;base64,AQIE\"").unwrap();
        assert!(expand(&compacted, &root, &mut Vec::new()).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn large_portable_project_keeps_ipc_small_and_restores_every_image() {
        let root = root(); let source = root.join("large.scenario");
        let mut file = fs::File::create(&source).unwrap(); file.write_all(b"{\"technicalImageAssets\":{").unwrap();
        for i in 0..128u32 {
            let mut bytes = vec![0u8; IMAGE_LIMIT]; bytes[..4].copy_from_slice(&i.to_le_bytes());
            if i > 0 { file.write_all(b",").unwrap(); }
            write!(file, "\"{i}\":{{\"dataUrl\":\"data:image/png;base64,{}\"}}", STANDARD.encode(bytes)).unwrap();
        }
        file.write_all(b"}}").unwrap(); drop(file);
        assert!(fs::metadata(&source).unwrap().len() > 48 * 1024 * 1024);
        let small = read(&source, &root).unwrap(); assert!(small.len() < 20_000);
        let mut restored = fs::File::create(root.join("restored.scenario")).unwrap(); expand(&small, &root, &mut restored).unwrap(); drop(restored);
        let reloaded = read(&root.join("restored.scenario"), &root).unwrap();
        assert_eq!(serde_json::from_str::<serde_json::Value>(&small).unwrap(), serde_json::from_str::<serde_json::Value>(&reloaded).unwrap());
        fs::remove_dir_all(root).unwrap();
    }
}
