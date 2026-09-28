//! Local-only Kokoro. eSpeak runs as a separate, unmodified GPL executable.
//! No text is sent over the network; the only HTTP requests download pinned assets.
use ort::{
    session::{RunOptions, Session},
    value::Tensor,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State};

const REV: &str = "1939ad2a8e416c0acfeecc08a694d14ef25f2231";
const MODEL_HASH: &str = "fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478";
const VOICE_HASH: &str = "a35f5675ad08948e326ae75fd0ea16ba5d0042e4f76b5f3d1df77d0a48c54861";
const TOTAL: u64 = 92_361_116 + 522_240;

#[derive(Default)]
pub struct AudioState {
    generation: AtomicU64,
    installing: AtomicBool,
    cancel_install: AtomicBool,
    engine: Mutex<Option<Session>>,
    active_run: Mutex<Option<Arc<RunOptions>>>,
}
impl AudioState {
    fn cancel(&self) -> u64 {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        if let Ok(run) = self.active_run.lock() {
            if let Some(run) = run.as_ref() {
                let _ = run.terminate();
            }
        }
        generation
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    installed: bool,
    bytes: u64,
    download_bytes: u64,
    supported: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    received: u64,
    total: u64,
    phase: &'static str,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechRequest {
    text: String,
    settings_key: String,
    generation: u64,
}
fn err(e: impl std::fmt::Display) -> String {
    format!("Lecture audio : {e}")
}
fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(err)?
        .join("audio/kokoro-v1"))
}
fn runtime(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("audio-runtime"));
    }
    Ok(app
        .path()
        .resource_dir()
        .map_err(err)?
        .join("audio-runtime"))
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn valid_file(path: &Path, expected: &str) -> bool {
    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };
    let mut digest = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        match file.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => digest.update(&buf[..n]),
            Err(_) => return false,
        }
    }
    format!("{:x}", digest.finalize()) == expected
}
fn installed(dir: &Path) -> bool {
    valid_file(&dir.join("model.onnx"), MODEL_HASH)
        && valid_file(&dir.join("ff_siwis.bin"), VOICE_HASH)
}
fn bytes(dir: &Path) -> u64 {
    ["model.onnx", "ff_siwis.bin"]
        .iter()
        .map(|f| fs::metadata(dir.join(f)).map(|m| m.len()).unwrap_or(0))
        .sum()
}
#[tauri::command]
pub async fn audio_status(app: AppHandle) -> Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = root(&app)?;
        Ok(Status {
            installed: installed(&dir),
            bytes: bytes(&dir),
            download_bytes: TOTAL,
            supported: cfg!(all(target_os = "windows", target_arch = "x86_64")),
        })
    })
    .await
    .map_err(err)?
}
struct Installing(Arc<AudioState>);
impl Drop for Installing {
    fn drop(&mut self) {
        self.0.installing.store(false, Ordering::SeqCst);
    }
}
async fn cancellable_download<T>(
    state: &AudioState,
    work: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    tokio::select! {
        biased;
        _=async {while !state.cancel_install.load(Ordering::SeqCst){tokio::time::sleep(Duration::from_millis(50)).await;}}=>Err("Téléchargement annulé.".into()),
        result=work=>result,
    }
}
#[tauri::command]
pub async fn audio_install(
    app: AppHandle,
    state: State<'_, Arc<AudioState>>,
) -> Result<(), String> {
    if state.installing.swap(true, Ordering::SeqCst) {
        return Err("Un téléchargement est déjà en cours.".into());
    }
    state.cancel_install.store(false, Ordering::SeqCst);
    let state = state.inner().clone();
    let _guard = Installing(state.clone());
    let dir = root(&app)?;
    fs::create_dir_all(&dir).map_err(err)?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(900))
        .build()
        .map_err(err)?;
    let mut received = 0;
    for (remote, local, expected, size) in [
        (
            "onnx/model_quantized.onnx",
            "model.onnx",
            MODEL_HASH,
            92_361_116u64,
        ),
        ("voices/ff_siwis.bin", "ff_siwis.bin", VOICE_HASH, 522_240),
    ] {
        let target = dir.join(local);
        let check_target = target.clone();
        if tauri::async_runtime::spawn_blocking(move || valid_file(&check_target, expected))
            .await
            .map_err(err)?
        {
            received += size;
            continue;
        }
        let partial = dir.join(format!("{local}.part"));
        let result: Result<(),String>=cancellable_download(&state,async {
                let mut response=client.get(format!("https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/{REV}/{remote}")).send().await.map_err(err)?.error_for_status().map_err(err)?;
                let mut file=fs::File::create(&partial).map_err(err)?; let mut digest=Sha256::new(); let mut count=0;
                let mut last=Instant::now()-Duration::from_secs(1);
                loop {
                    if state.cancel_install.load(Ordering::SeqCst) { return Err("Téléchargement annulé.".into()); }
                    let Some(buffer)=response.chunk().await.map_err(err)? else {break};
                    count+=buffer.len() as u64; if count>size {return Err("Taille du téléchargement incorrecte.".into())}
                    file.write_all(&buffer).map_err(|e|format!("Impossible d’enregistrer la voix. Vérifiez l’espace disque disponible. {e}"))?; digest.update(&buffer);
                    if last.elapsed()>Duration::from_millis(100) { let _=app.emit("audio-download",Progress{received:received+count,total:TOTAL,phase:"download"}); last=Instant::now(); }
                }
                let _=app.emit("audio-download",Progress{received:received+count,total:TOTAL,phase:"verify"});
                if count!=size || format!("{:x}",digest.finalize())!=expected {return Err("Le fichier reçu est endommagé. Relancez le téléchargement.".into())}
                file.sync_all().map_err(err)?; drop(file);
                if target.exists() {fs::remove_file(&target).map_err(err)?;}
                fs::rename(&partial,&target).map_err(err)?; Ok(())
            }).await;
        if result.is_err() {
            let _ = fs::remove_file(&partial);
        }
        result?;
        received += size;
    }
    let _ = app.emit(
        "audio-download",
        Progress {
            received: TOTAL,
            total: TOTAL,
            phase: "ready",
        },
    );
    Ok(())
}
#[tauri::command]
pub fn audio_cancel_install(state: State<'_, Arc<AudioState>>) {
    state.cancel_install.store(true, Ordering::SeqCst);
}
#[tauri::command]
pub fn audio_new_generation(state: State<'_, Arc<AudioState>>) -> u64 {
    state.cancel()
}
#[tauri::command]
pub async fn audio_remove(app: AppHandle, state: State<'_, Arc<AudioState>>) -> Result<(), String> {
    if state.installing.load(Ordering::SeqCst) {
        return Err("Annulez le téléchargement avant de supprimer la voix.".into());
    }
    state.cancel();
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut engine = state.engine.lock().map_err(err)?;
        *engine = None;
        let dir = root(&app)?;
        // Exact, app-owned subdirectory only. Project files are never touched.
        if dir.exists() {
            fs::remove_dir_all(dir).map_err(err)?;
        }
        Ok(())
    })
    .await
    .map_err(err)?
}
#[derive(Debug, PartialEq, Eq)]
enum PhonemeInput {
    Text(String),
    Punctuation(char),
}

/// eSpeak's command-line IPA mode drops punctuation. Kokoro was trained with
/// those tokens, so keep them outside G2P and put them back in the sequence.
/// This mirrors Misaki's `preserve_punctuation=True` contract without adding
/// Python or a local service to the desktop application.
fn phoneme_inputs(text: &str) -> Vec<PhonemeInput> {
    let mut inputs = Vec::new();
    let mut words = String::new();
    for character in text.chars().map(|c| match c {
        '«' => '“',
        '»' => '”',
        '\n' | '\r' | '\t' => ' ',
        other => other,
    }) {
        if ";:,.!?—…()“”".contains(character) {
            if !words.is_empty() {
                inputs.push(PhonemeInput::Text(std::mem::take(&mut words)));
            }
            inputs.push(PhonemeInput::Punctuation(character));
        } else {
            words.push(character);
        }
    }
    if !words.is_empty() {
        inputs.push(PhonemeInput::Text(words));
    }
    inputs
}

fn espeak_phonemes(runtime: &Path, text: &str) -> Result<String, String> {
    let mut command = Command::new(runtime.join("espeak/espeak-ng.exe"));
    command
        .arg(format!("--path={}", runtime.join("espeak").display()))
        .args(["-q", "--ipa", "-v", "fr-fr", "--stdin"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Moteur de prononciation introuvable. Réinstallez Senario. {e}"))?;
    let mut stdin = child.stdin.take().ok_or("Entrée audio indisponible")?;
    stdin.write_all(text.as_bytes()).map_err(err)?;
    // espeak-ng's --stdin mode only commits the final input token when the
    // line is terminated. Without this newline, "midi" is phonemized as
    // "mid" and "comptera" as "compter" whenever punctuation splitting puts
    // the word at the end of a chunk.
    stdin.write_all(b"\n").map_err(err)?;
    drop(stdin);
    let result = child.wait_with_output().map_err(err)?;
    if !result.status.success() {
        return Err("La prononciation du passage a échoué.".into());
    }
    Ok(String::from_utf8(result.stdout)
        .map_err(err)?
        .replace("(en)", "")
        .replace("(fr)", "")
        // Misaki applies the same normalisation to eSpeak's ligatures.
        .replace("a^ɪ", "I")
        .replace("a^ʊ", "W")
        .replace("d^z", "ʣ")
        .replace("d^ʒ", "ʤ")
        .replace("e^ɪ", "A")
        .replace("o^ʊ", "O")
        .replace("ə^ʊ", "Q")
        .replace("s^s", "S")
        .replace("t^s", "ʦ")
        .replace("t^ʃ", "ʧ")
        .replace("ɔ^ɪ", "Y")
        .replace('^', "")
        .replace('-', "")
        .replace(['\r', '\n'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" "))
}

/// Kokoro needs one token after a phrase-ending mark to complete the duration
/// of the last spoken phoneme. The trailing space is silent, while avoiding a
/// clipped final vowel or consonant. Neither it nor a synthesized period ever
/// changes the text shown in the screenplay.
fn finalize_phonemes(mut phonemes: String) -> String {
    let last_spoken = phonemes
        .chars()
        .rev()
        .find(|character| !character.is_whitespace() && !matches!(*character, '”' | ')'));

    if !phonemes.is_empty() && !matches!(last_spoken, Some('.' | '!' | '?' | '…')) {
        phonemes.push('.');
    }

    if !phonemes.is_empty() {
        phonemes.push(' ');
    }

    phonemes
}

fn phonemes(runtime: &Path, text: &str) -> Result<String, String> {
    let mut output = String::new();
    for input in phoneme_inputs(text) {
        match input {
            PhonemeInput::Punctuation(character) => output.push(character),
            PhonemeInput::Text(words) => {
                let begins_with_space = words.chars().next().is_some_and(char::is_whitespace);
                let converted = espeak_phonemes(runtime, &words)?;
                if converted.is_empty() {
                    continue;
                }
                if begins_with_space && !output.is_empty() && !output.ends_with(' ') {
                    output.push(' ');
                }
                output.push_str(&converted);
            }
        }
    }
    Ok(finalize_phonemes(output.trim().to_owned()))
}
// Canonical Kokoro v1.0 vocabulary, from hexgrad/Kokoro-82M/config.json.
fn vocabulary() -> std::collections::HashMap<char, i64> {
    let symbols = ";:,.!?";
    let mut map = std::collections::HashMap::new();
    for (i, c) in symbols.chars().enumerate() {
        map.insert(c, i as i64 + 1);
    }
    for (c, id) in [
        ('—', 9),
        ('…', 10),
        ('"', 11),
        ('(', 12),
        (')', 13),
        ('“', 14),
        ('”', 15),
        (' ', 16),
        ('\u{303}', 17),
        ('ʣ', 18),
        ('ʥ', 19),
        ('ʦ', 20),
        ('ʨ', 21),
        ('ᵝ', 22),
        ('\u{ab67}', 23),
        ('A', 24),
        ('I', 25),
        ('O', 31),
        ('Q', 33),
        ('S', 35),
        ('T', 36),
        ('W', 39),
        ('Y', 41),
        ('ᵊ', 42),
        ('a', 43),
        ('b', 44),
        ('c', 45),
        ('d', 46),
        ('e', 47),
        ('f', 48),
        ('h', 50),
        ('i', 51),
        ('j', 52),
        ('k', 53),
        ('l', 54),
        ('m', 55),
        ('n', 56),
        ('o', 57),
        ('p', 58),
        ('q', 59),
        ('r', 60),
        ('s', 61),
        ('t', 62),
        ('u', 63),
        ('v', 64),
        ('w', 65),
        ('x', 66),
        ('y', 67),
        ('z', 68),
        ('ɑ', 69),
        ('ɐ', 70),
        ('ɒ', 71),
        ('æ', 72),
        ('β', 75),
        ('ɔ', 76),
        ('ɕ', 77),
        ('ç', 78),
        ('ɖ', 80),
        ('ð', 81),
        ('ʤ', 82),
        ('ə', 83),
        ('ɚ', 85),
        ('ɛ', 86),
        ('ɜ', 87),
        ('ɟ', 90),
        ('ɡ', 92),
        ('ɥ', 99),
        ('ɨ', 101),
        ('ɪ', 102),
        ('ʝ', 103),
        ('ɯ', 110),
        ('ɰ', 111),
        ('ŋ', 112),
        ('ɳ', 113),
        ('ɲ', 114),
        ('ɴ', 115),
        ('ø', 116),
        ('ɸ', 118),
        ('θ', 119),
        ('œ', 120),
        ('ɹ', 123),
        ('ɾ', 125),
        ('ɻ', 126),
        ('ʁ', 128),
        ('ɽ', 129),
        ('ʂ', 130),
        ('ʃ', 131),
        ('ʈ', 132),
        ('ʧ', 133),
        ('ʊ', 135),
        ('ʋ', 136),
        ('ʌ', 138),
        ('ɣ', 139),
        ('ɤ', 140),
        ('χ', 142),
        ('ʎ', 143),
        ('ʒ', 147),
        ('ʔ', 148),
        ('ˈ', 156),
        ('ˌ', 157),
        ('ː', 158),
        ('ʰ', 162),
        ('ʲ', 164),
        ('↓', 169),
        ('→', 171),
        ('↗', 172),
        ('↘', 173),
        ('ᵻ', 177),
    ] {
        map.insert(c, id);
    }
    map
}
fn cache_key(r: &SpeechRequest) -> String {
    hash(
        format!(
            // v6 has one immutable voice and Kokoro's native speed. The cache
            // can therefore never be split by hidden client-side settings.
            "kokoro-v1-fr-6|{MODEL_HASH}|{}|{}",
            r.settings_key, r.text
        )
        .as_bytes(),
    )
}
fn cached(path: &Path) -> Option<Vec<u8>> {
    let data = fs::read(path).ok()?;
    if fs::read_to_string(path.with_extension("sha256")).ok()? != hash(&data) {
        return None;
    }
    let wav = hound::WavReader::new(Cursor::new(&data)).ok()?;
    if wav.duration() == 0 || wav.spec().sample_rate != 24000 {
        return None;
    }
    Some(data)
}

fn voice_style_offset(phoneme_count: usize) -> usize {
    // KPipeline uses `pack[len(phonemes) - 1]`; the voice pack has 510 rows.
    phoneme_count.saturating_sub(1) * 256 * 4
}
fn synthesize(
    dir: &Path,
    runtime: &Path,
    state: &AudioState,
    request: SpeechRequest,
) -> Result<Vec<u8>, String> {
    if request.text.len() > 16000
        || request.text.trim().is_empty()
        || request.settings_key.len() > 128
    {
        return Err("Passage ou réglages audio invalides.".into());
    }
    let check = || {
        if state.generation.load(Ordering::SeqCst) != request.generation {
            Err("Lecture annulée.".to_owned())
        } else {
            Ok(())
        }
    };
    let mut lock = state.engine.lock().map_err(err)?;
    check()?;
    let cache = dir.join("cache");
    fs::create_dir_all(&cache).map_err(err)?;
    let path = cache.join(format!("{}.wav", cache_key(&request)));
    if let Some(data) = cached(&path) {
        return Ok(data);
    }
    if lock.is_none() {
        if !installed(dir) {
            return Err("Téléchargez la voix française avant de lancer la lecture.".into());
        }
        if !runtime.join("onnxruntime.dll").is_file() {
            return Err("Moteur audio introuvable. Réinstallez Senario.".into());
        }
        ort::init_from(runtime.join("onnxruntime.dll").to_string_lossy())
            .commit()
            .map_err(err)?;
        *lock = Some(
            Session::builder()
                .map_err(err)?
                .with_intra_threads(2)
                .map_err(err)?
                .commit_from_file(dir.join("model.onnx"))
                .map_err(err)?,
        );
    }
    let ph = phonemes(runtime, &request.text)?;
    check()?;
    let vocab = vocabulary();
    let tokens: Vec<i64> = ph.chars().filter_map(|c| vocab.get(&c).copied()).collect();
    if tokens.is_empty() {
        return Err("Ce passage ne contient aucun texte prononçable.".into());
    }
    let voice = fs::read(dir.join("ff_siwis.bin")).map_err(err)?;
    if voice.len() != 522_240 || hash(&voice) != VOICE_HASH {
        return Err("La voix locale est endommagée. Téléchargez-la à nouveau.".into());
    }
    let mut samples = Vec::<f32>::new();
    let mut start = 0;
    while start < tokens.len() {
        check()?;
        let mut end = (start + 480).min(tokens.len());
        if end < tokens.len() {
            if let Some(boundary) = tokens[start..end]
                .iter()
                .rposition(|token| matches!(*token, 1..=6 | 9 | 10))
            {
                if boundary > 0 {
                    end = start + boundary + 1;
                }
            } else if let Some(boundary) = tokens[start..end].iter().rposition(|token| *token == 16)
            {
                if boundary > 0 {
                    end = start + boundary;
                }
            }
        }
        let chunk = &tokens[start..end];
        let style_offset = voice_style_offset(chunk.len());
        let style: Vec<f32> = voice[style_offset..style_offset + 1024]
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
            .collect();
        let mut input = vec![0i64];
        input.extend_from_slice(chunk);
        input.push(0);
        let run = Arc::new(RunOptions::new().map_err(err)?);
        *state.active_run.lock().map_err(err)? = Some(run.clone());
        check()?;
        let result = lock.as_mut().unwrap().run_with_options(
            ort::inputs![
                "input_ids"=>Tensor::from_array(([1,input.len()],input)).map_err(err)?,
                "style"=>Tensor::from_array(([1,256],style)).map_err(err)?,
                "speed"=>Tensor::from_array(([1],vec![1_f32])).map_err(err)?
            ],
            &run,
        );
        *state.active_run.lock().map_err(err)? = None;
        let output = result.map_err(err)?;
        let (_, audio) = output[0].try_extract_tensor::<f32>().map_err(err)?;
        samples.extend_from_slice(audio);
        start = end;
    }
    check()?;
    let mut output = Cursor::new(Vec::new());
    {
        let mut wav = hound::WavWriter::new(
            &mut output,
            hound::WavSpec {
                channels: 1,
                sample_rate: 24000,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            },
        )
        .map_err(err)?;
        for sample in samples {
            wav.write_sample((sample.clamp(-1., 1.) * i16::MAX as f32) as i16)
                .map_err(err)?;
        }
        wav.finalize().map_err(err)?;
    }
    let data = output.into_inner();
    let temp = path.with_extension("part");
    fs::write(&temp, &data).map_err(err)?;
    if path.exists() {
        fs::remove_file(&path).map_err(err)?;
    }
    fs::rename(temp, &path).map_err(err)?;
    fs::write(path.with_extension("sha256"), hash(&data)).map_err(err)?;
    Ok(data)
}
#[tauri::command]
pub async fn audio_synthesize(
    app: AppHandle,
    state: State<'_, Arc<AudioState>>,
    request: SpeechRequest,
) -> Result<tauri::ipc::Response, String> {
    let dir = root(&app)?;
    let runtime = runtime(&app)?;
    let state = state.inner().clone();
    let bytes =
        tauri::async_runtime::spawn_blocking(move || synthesize(&dir, &runtime, &state, request))
            .await
            .map_err(err)??;
    Ok(tauri::ipc::Response::new(bytes))
}
#[cfg(test)]
mod tests {
    use super::*;
    fn request(text: &str) -> SpeechRequest {
        SpeechRequest {
            text: text.into(),
            settings_key: "titles:true".into(),
            generation: 0,
        }
    }
    #[tokio::test]
    async fn cancellation_interrupts_stalled_download() {
        let state = AudioState::default();
        let cancel = async {
            tokio::time::sleep(Duration::from_millis(10)).await;
            state.cancel_install.store(true, Ordering::SeqCst);
        };
        let waiting = cancellable_download::<()>(&state, std::future::pending());
        let (result, ()) = tokio::join!(waiting, cancel);
        assert_eq!(result.unwrap_err(), "Téléchargement annulé.");
    }
    #[test]
    fn cache_is_content_addressed() {
        assert_eq!(
            cache_key(&request("Bonjour")),
            cache_key(&request("Bonjour"))
        );
        assert_ne!(
            cache_key(&request("Bonjour")),
            cache_key(&request("Bonsoir"))
        );
        let mut r = request("Bonjour");
        r.settings_key = "titles:false".into();
        assert_ne!(cache_key(&request("Bonjour")), cache_key(&r));
    }
    #[test]
    fn french_phonemes_are_supported() {
        for c in "bɔ̃ʒˈuʁ kamˈij œ̃ ɛ̃ ɲ ø ɥ".chars() {
            assert!(vocabulary().contains_key(&c), "{c}");
        }
    }
    #[cfg(windows)]
    #[test]
    fn keeps_spoken_final_vowels_before_french_punctuation() {
        let runtime = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("audio-runtime");
        let phrase = "Je vais finir ce scénario avant midi. Cette fois, chaque mot comptera.";
        let output = phonemes(&runtime, phrase).unwrap();

        // The visible text reaches the backend intact and eSpeak keeps each
        // pronounced final vowel immediately before its punctuation token.
        assert!(output.contains("senaʁjˈo"), "{output}");
        assert!(output.contains("midˈi."), "{output}");
        assert!(output.contains("fwˈa,"), "{output}");
        assert!(output.ends_with("kɔ̃tʁˈa. "), "{output}");

        let standalone = phonemes(&runtime, "scénario.").unwrap();
        assert_eq!(standalone, "senaʁjˈo. ");
        let standalone_tokens: Vec<i64> = standalone
            .chars()
            .filter_map(|character| vocabulary().get(&character).copied())
            .collect();
        assert!(standalone_tokens.windows(2).any(|window| window == [57, 4]));

        let vocab = vocabulary();
        let tokens: Vec<i64> = output
            .chars()
            .filter_map(|character| vocab.get(&character).copied())
            .collect();
        for expected in [[51, 4], [43, 3], [43, 4]] {
            assert!(
                tokens
                    .windows(expected.len())
                    .any(|window| window == expected),
                "missing token boundary {expected:?} in {tokens:?}"
            );
        }
    }
    #[test]
    fn preserves_french_punctuation_and_uses_the_correct_voice_row() {
        assert_eq!(
            phoneme_inputs("Bonjour, Camille ! « À demain… »"),
            vec![
                PhonemeInput::Text("Bonjour".into()),
                PhonemeInput::Punctuation(','),
                PhonemeInput::Text(" Camille ".into()),
                PhonemeInput::Punctuation('!'),
                PhonemeInput::Text(" ".into()),
                PhonemeInput::Punctuation('“'),
                PhonemeInput::Text(" À demain".into()),
                PhonemeInput::Punctuation('…'),
                PhonemeInput::Text(" ".into()),
                PhonemeInput::Punctuation('”'),
            ]
        );
        assert_eq!(voice_style_offset(1), 0);
        assert_eq!(voice_style_offset(510), 509 * 256 * 4);
    }
    #[test]
    fn gives_unpunctuated_blocks_a_synthesis_boundary() {
        // This helper is deliberately tested independently of the eSpeak
        // executable: it protects character names, scene headings and a
        // selection that ends exactly at its last visible letter.
        assert_eq!(finalize_phonemes("kamˈij".into()), "kamˈij. ");
        assert_eq!(finalize_phonemes("senaʁjˈo.".into()), "senaʁjˈo. ");
        assert_eq!(finalize_phonemes("bɔ̃ʒuʁ !”".into()), "bɔ̃ʒuʁ !” ");
        assert_eq!(finalize_phonemes(String::new()), "");
    }
    #[test]
    fn cancelled_request_does_not_generate() {
        let state = AudioState::default();
        state.generation.store(1, Ordering::SeqCst);
        assert_eq!(
            synthesize(
                Path::new("unused"),
                Path::new("unused"),
                &state,
                request("Bonjour")
            )
            .unwrap_err(),
            "Lecture annulée."
        );
    }
    #[test]
    #[ignore = "Requires opt-in model download and prepared Windows runtime"]
    fn real_french_synthesis_and_cache() {
        let dir = PathBuf::from(
            std::env::var("SENARIO_AUDIO_TEST_DIR").expect("explicit test model directory"),
        );
        let runtime = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("audio-runtime");
        let state = AudioState::default();
        let endings = synthesize(
            &dir,
            &runtime,
            &state,
            request("Je vais finir ce scénario avant midi. Cette fois, chaque mot comptera."),
        )
        .unwrap();
        assert!(endings.len() > 24000);
        let r = request("Bonjour Camille. Nous allons lire cette scène ensemble.");
        let key = cache_key(&r);
        let first = synthesize(&dir, &runtime, &state, r).unwrap();
        assert!(first.len() > 24000);
        let second = synthesize(
            &dir,
            Path::new("missing-runtime"),
            &AudioState::default(),
            request("Bonjour Camille. Nous allons lire cette scène ensemble."),
        )
        .unwrap();
        assert_eq!(first, second);
        assert!(cached(&dir.join(format!("cache/{key}.wav"))).is_some());
        fs::write(dir.join(format!("cache/{key}.wav")), b"corrupted").unwrap();
        assert!(cached(&dir.join(format!("cache/{key}.wav"))).is_none());
        let restored = synthesize(
            &dir,
            &runtime,
            &state,
            request("Bonjour Camille. Nous allons lire cette scène ensemble."),
        )
        .unwrap();
        assert_eq!(first, restored);
        let before = fs::metadata(dir.join(format!("cache/{key}.wav")))
            .unwrap()
            .modified()
            .unwrap();
        synthesize(
            &dir,
            &runtime,
            &state,
            request("Bonsoir Camille. La journée se termine."),
        )
        .unwrap();
        assert_eq!(
            before,
            fs::metadata(dir.join(format!("cache/{key}.wav")))
                .unwrap()
                .modified()
                .unwrap()
        );
        // Stop an actual ONNX run, not just a queued frontend promise.
        let shared = Arc::new(state);
        let worker_state = shared.clone();
        let worker_dir = dir.clone();
        let worker_runtime = runtime.clone();
        let worker = std::thread::spawn(move || {
            synthesize(
                &worker_dir,
                &worker_runtime,
                &worker_state,
                request(&format!(
                    "Test unique {}. {}",
                    std::process::id(),
                    "Camille traverse la pièce et ouvre la fenêtre. ".repeat(20)
                )),
            )
        });
        let deadline = Instant::now() + Duration::from_secs(15);
        while shared.active_run.lock().unwrap().is_none()
            && !worker.is_finished()
            && Instant::now() < deadline
        {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(
            shared.active_run.lock().unwrap().is_some(),
            "Expected an active native inference"
        );
        let stopped = Instant::now();
        shared.cancel();
        assert!(worker.join().unwrap().is_err());
        assert!(stopped.elapsed() < Duration::from_secs(3));
    }
}
