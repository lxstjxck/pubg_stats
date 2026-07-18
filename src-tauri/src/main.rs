use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
  collections::HashMap,
  fs,
  path::PathBuf,
  sync::{Arc, Mutex},
  thread,
  time::{Duration, Instant},
};
use tauri::Manager;
use tiny_http::{Header, Response, Server};
use url::Url;

const OVERLAY_HTML: &str = include_str!("../../public/overlay.html");
const OVERLAY_CSS: &str = include_str!("../../public/overlay.css");
const OVERLAY_JS: &str = include_str!("../../public/overlay.js");
const PUBG_BASE: &str = "https://api.pubg.com";
const ALLOWED_MODES: [&str; 4] = ["tpp-duo", "tpp-squad", "fpp-duo", "fpp-squad"];

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
  #[serde(default)]
  api_key: String,
  #[serde(default = "default_platform")]
  platform: String,
  #[serde(default)]
  player: String,
  #[serde(default = "default_mode")]
  mode: String,
  #[serde(default = "default_refresh")]
  refresh: u64,
  #[serde(default = "default_port")]
  port: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicSettings {
  has_api_key: bool,
  platform: String,
  player: String,
  mode: String,
  refresh: u64,
  port: u16,
  server_running: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsInput {
  api_key: Option<String>,
  platform: String,
  player: String,
  mode: String,
  refresh: u64,
  port: u16,
}

struct CacheEntry {
  expires_at: Instant,
  data: Value,
}

struct AppState {
  settings_path: PathBuf,
  settings: Mutex<Settings>,
  cache: Mutex<HashMap<String, CacheEntry>>,
  server_running: Mutex<bool>,
}

fn default_platform() -> String {
  "steam".to_string()
}

fn default_mode() -> String {
  "fpp-squad".to_string()
}

fn default_refresh() -> u64 {
  60_000
}

fn default_port() -> u16 {
  3000
}

impl Default for Settings {
  fn default() -> Self {
    Self {
      api_key: String::new(),
      platform: default_platform(),
      player: String::new(),
      mode: default_mode(),
      refresh: default_refresh(),
      port: default_port(),
    }
  }
}

fn to_public(settings: &Settings, server_running: bool) -> PublicSettings {
  PublicSettings {
    has_api_key: !settings.api_key.trim().is_empty(),
    platform: settings.platform.clone(),
    player: settings.player.clone(),
    mode: settings.mode.clone(),
    refresh: settings.refresh,
    port: settings.port,
    server_running,
  }
}

fn load_settings(path: &PathBuf) -> Settings {
  fs::read_to_string(path)
    .ok()
    .and_then(|text| serde_json::from_str::<Settings>(&text).ok())
    .unwrap_or_default()
}

fn save_settings_file(path: &PathBuf, settings: &Settings) -> Result<(), String> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }

  let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
  fs::write(path, text).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_settings(state: tauri::State<'_, Arc<AppState>>) -> Result<PublicSettings, String> {
  let settings = state.settings.lock().map_err(|e| e.to_string())?;
  let server_running = *state.server_running.lock().map_err(|e| e.to_string())?;
  Ok(to_public(&settings, server_running))
}

#[tauri::command]
fn save_settings(
  state: tauri::State<'_, Arc<AppState>>,
  settings: SettingsInput,
) -> Result<PublicSettings, String> {
  let mut current = state.settings.lock().map_err(|e| e.to_string())?;

  if let Some(api_key) = settings.api_key {
    let api_key = api_key.trim();
    if !api_key.is_empty() {
      current.api_key = api_key.to_string();
    }
  }

  current.platform = settings.platform;
  current.player = settings.player;
  current.mode = normalize_mode(&settings.mode).to_string();
  current.refresh = settings.refresh.max(15_000);
  current.port = settings.port;

  save_settings_file(&state.settings_path, &current)?;
  let server_running = *state.server_running.lock().map_err(|e| e.to_string())?;
  Ok(to_public(&current, server_running))
}

fn normalize_mode(mode: &str) -> &str {
  match mode {
    "duo" => "tpp-duo",
    "squad" => "tpp-squad",
    "duo-fpp" => "fpp-duo",
    "squad-fpp" => "fpp-squad",
    value if ALLOWED_MODES.contains(&value) => value,
    _ => "fpp-squad",
  }
}

fn to_pubg_mode(mode: &str) -> Option<&'static str> {
  match normalize_mode(mode) {
    "tpp-duo" => Some("duo"),
    "tpp-squad" => Some("squad"),
    "fpp-duo" => Some("duo-fpp"),
    "fpp-squad" => Some("squad-fpp"),
    _ => None,
  }
}

fn from_pubg_mode(mode: &str) -> String {
  normalize_mode(mode).to_string()
}

fn header(name: &str, value: &str) -> Header {
  Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("valid static header")
}

fn text_response(status: u16, content_type: &str, body: String) -> Response<std::io::Cursor<Vec<u8>>> {
  Response::from_string(body)
    .with_status_code(status)
    .with_header(header("Content-Type", content_type))
    .with_header(header("Access-Control-Allow-Origin", "*"))
}

fn json_error(status: u16, code: &str, message: &str, extra: Value) -> Response<std::io::Cursor<Vec<u8>>> {
  let mut body = json!({
    "code": code,
    "error": message,
    "message": message,
  });

  if let (Some(body_map), Some(extra_map)) = (body.as_object_mut(), extra.as_object()) {
    for (key, value) in extra_map {
      body_map.insert(key.clone(), value.clone());
    }
  }

  text_response(status, "application/json", body.to_string())
}

fn serve_static(path: &str) -> Option<Response<std::io::Cursor<Vec<u8>>>> {
  match path {
    "/" | "/overlay.html" => Some(text_response(200, "text/html; charset=utf-8", OVERLAY_HTML.to_string())),
    "/overlay.css" => Some(text_response(200, "text/css; charset=utf-8", OVERLAY_CSS.to_string())),
    "/overlay.js" => Some(text_response(200, "application/javascript; charset=utf-8", OVERLAY_JS.to_string())),
    _ => None,
  }
}

fn cache_get(state: &AppState, key: &str) -> Option<Value> {
  let mut cache = state.cache.lock().ok()?;
  let entry = cache.get(key)?;
  if Instant::now() > entry.expires_at {
    cache.remove(key);
    return None;
  }
  Some(entry.data.clone())
}

fn cache_set(state: &AppState, key: String, data: Value, ttl: Duration) {
  if let Ok(mut cache) = state.cache.lock() {
    cache.insert(key, CacheEntry { expires_at: Instant::now() + ttl, data });
  }
}

fn tier_to_text(value: &Value) -> String {
  match value {
    Value::Null => String::new(),
    Value::String(text) => text.trim().to_string(),
    Value::Number(num) => num.to_string(),
    Value::Object(map) => {
      let tier = ["tier", "currentTier", "name", "value"]
        .iter()
        .find_map(|key| map.get(*key).map(tier_to_text))
        .unwrap_or_default();
      let sub = ["subTier", "currentSubTier", "subtier", "level"]
        .iter()
        .find_map(|key| map.get(*key).map(tier_to_text))
        .unwrap_or_default();
      [tier, sub].into_iter().filter(|part| !part.is_empty()).collect::<Vec<_>>().join(" ")
    }
    _ => String::new(),
  }
}

fn pubg_fetch(client: &reqwest::blocking::Client, api_key: &str, url: &str) -> Result<Value, String> {
  let response = client
    .get(url)
    .bearer_auth(api_key)
    .header("Accept", "application/vnd.api+json")
    .send()
    .map_err(|e| pubg_error_payload(0, &e.to_string()).to_string())?;

  let status = response.status();
  let text = response.text().map_err(|e| e.to_string())?;

  if !status.is_success() {
    return Err(pubg_error_payload(status.as_u16(), &text.chars().take(300).collect::<String>()).to_string());
  }

  serde_json::from_str(&text).map_err(|e| e.to_string())
}

fn pubg_error_payload(status: u16, details: &str) -> Value {
  match status {
    0 => json!({
      "status": 502,
      "code": "Network error",
      "message": "Could not connect to PUBG API. Check your internet connection and try again.",
      "details": details,
    }),
    401 => json!({
      "status": 401,
      "code": "Invalid API key",
      "message": "PUBG API rejected the API key. Check the key in app settings.",
      "details": details,
    }),
    403 => json!({
      "status": 403,
      "code": "API key forbidden",
      "message": "PUBG API denied access for this key. The key may be blocked or not allowed to use this endpoint.",
      "details": details,
    }),
    404 => json!({
      "status": 404,
      "code": "PUBG data not found",
      "message": "PUBG API did not find the requested player, season, or stats endpoint.",
      "details": details,
    }),
    429 => json!({
      "status": 429,
      "code": "Rate limit",
      "message": "Too many PUBG API requests. Increase the refresh interval or wait a few minutes.",
      "details": details,
    }),
    500..=599 => json!({
      "status": 502,
      "code": "PUBG API unavailable",
      "message": "PUBG API is not responding correctly right now. Try again later.",
      "details": details,
    }),
    _ => json!({
      "status": status,
      "code": "PUBG API error",
      "message": format!("PUBG API returned HTTP {status}."),
      "details": details,
    }),
  }
}

fn query_param(url: &Url, name: &str) -> Option<String> {
  url
    .query_pairs()
    .find(|(key, _)| key == name)
    .map(|(_, value)| value.to_string())
}

fn handle_ranked(state: &AppState, request_url: &str) -> Response<std::io::Cursor<Vec<u8>>> {
  let url = match Url::parse(&format!("http://localhost{}", request_url)) {
    Ok(url) => url,
    Err(_) => return json_error(400, "Invalid URL", "The overlay request URL is invalid.", json!({})),
  };

  let settings = match state.settings.lock() {
    Ok(settings) => settings.clone(),
    Err(e) => return json_error(500, "Internal error", "Could not read app settings.", json!({ "details": e.to_string() })),
  };

  if settings.api_key.trim().is_empty() {
    return json_error(500, "Missing API key", "PUBG API key is not configured in the desktop app.", json!({}));
  }

  let platform = query_param(&url, "platform").unwrap_or(settings.platform);
  let player = query_param(&url, "player").unwrap_or(settings.player).trim().to_string();
  let mode = normalize_mode(&query_param(&url, "mode").unwrap_or(settings.mode)).to_string();
  let pubg_mode = match to_pubg_mode(&mode) {
    Some(mode) => mode,
    None => {
      return json_error(400, "Invalid mode", "Ranked overlay supports only duo and squad ranked modes.", json!({
        "mode": mode,
        "allowedModes": ALLOWED_MODES,
      }));
    }
  };

  if player.is_empty() {
    return json_error(400, "Missing player", "Add a PUBG player nickname to the overlay URL.", json!({}));
  }

  let cache_key = format!("ranked:{platform}:{player}:{mode}");
  if let Some(data) = cache_get(state, &cache_key) {
    return text_response(200, "application/json", data.to_string());
  }

  let client = match reqwest::blocking::Client::builder().timeout(Duration::from_secs(15)).build() {
    Ok(client) => client,
    Err(e) => return json_error(500, "Internal error", "Could not create PUBG API client.", json!({ "details": e.to_string() })),
  };

  let encoded_player = player.clone();
  let player_url = format!(
    "{PUBG_BASE}/shards/{platform}/players?filter[playerNames]={}",
    urlencoding::encode(&encoded_player)
  );

  let result = (|| {
    let player_json = pubg_fetch(&client, &settings.api_key, &player_url)?;
    let player_id = player_json["data"][0]["id"]
      .as_str()
      .ok_or_else(|| {
        json!({
          "status": 404,
          "code": "Player not found",
          "message": "PUBG API did not find this player on the selected platform.",
          "player": encoded_player,
          "platform": platform,
        }).to_string()
      })?;

    let seasons_key = format!("seasons:{platform}");
    let seasons_json = if let Some(data) = cache_get(state, &seasons_key) {
      data
    } else {
      let seasons_url = format!("{PUBG_BASE}/shards/{platform}/seasons");
      let data = pubg_fetch(&client, &settings.api_key, &seasons_url)?;
      cache_set(state, seasons_key, data.clone(), Duration::from_secs(6 * 60 * 60));
      data
    };

    let season_id = seasons_json["data"]
      .as_array()
      .and_then(|items| {
        items.iter().find_map(|item| {
          item["attributes"]["isCurrentSeason"]
            .as_bool()
            .filter(|is_current| *is_current)
            .and_then(|_| item["id"].as_str())
        })
      })
      .ok_or_else(|| {
        json!({
          "status": 502,
          "code": "Season not found",
          "message": "PUBG API did not return a current ranked season.",
          "platform": platform,
        }).to_string()
      })?;

    let ranked_url = format!("{PUBG_BASE}/shards/{platform}/players/{player_id}/seasons/{season_id}/ranked");
    let ranked_json = pubg_fetch(&client, &settings.api_key, &ranked_url)?;
    let stats_by_mode = &ranked_json["data"]["attributes"]["rankedGameModeStats"];
    let available_modes = stats_by_mode
      .as_object()
      .map(|map| map.keys().map(|key| from_pubg_mode(key)).collect::<Vec<_>>())
      .unwrap_or_default();

    if available_modes.is_empty() {
      return Err(json!({
        "status": 404,
        "code": "No ranked stats",
        "message": "This player has no ranked stats for the current season.",
        "player": encoded_player,
        "platform": platform,
        "seasonId": season_id,
        "allowedModes": ALLOWED_MODES,
      }).to_string());
    }

    let stats = stats_by_mode
      .get(pubg_mode)
      .ok_or_else(|| {
        json!({
          "status": 404,
          "code": "Mode unavailable",
          "message": "This player has no ranked stats for the selected mode in the current season.",
          "player": encoded_player,
          "mode": mode,
          "availableModes": available_modes,
          "allowedModes": ALLOWED_MODES,
        }).to_string()
      })?;

    let payload = json!({
      "player": encoded_player,
      "platform": platform,
      "seasonId": season_id,
      "mode": mode,
      "tier": tier_to_text(&stats["currentTier"]),
      "rp": stats["currentRankPoint"],
      "roundsPlayed": stats["roundsPlayed"],
      "wins": stats["wins"],
      "top10Ratio": stats["top10Ratio"],
      "kda": stats["kda"],
      "raw": stats,
      "updatedAt": chrono::Utc::now().to_rfc3339(),
    });

    Ok::<Value, String>(payload)
  })();

  match result {
    Ok(payload) => {
      cache_set(state, cache_key, payload.clone(), Duration::from_secs(60));
      text_response(200, "application/json", payload.to_string())
    }
    Err(error) => {
      if let Ok(value) = serde_json::from_str::<Value>(&error) {
        let status = value["status"].as_u64().unwrap_or(500) as u16;
        let code = value["code"].as_str().unwrap_or("API error").to_string();
        let message = value["message"].as_str().unwrap_or("PUBG API request failed.").to_string();
        json_error(status, &code, &message, value)
      } else {
        json_error(500, "API error", "PUBG API request failed.", json!({ "details": error }))
      }
    }
  }
}

fn start_overlay_server(state: Arc<AppState>) {
  let port = state.settings.lock().map(|settings| settings.port).unwrap_or(default_port());
  let server = match Server::http(("127.0.0.1", port)) {
    Ok(server) => server,
    Err(error) => {
      eprintln!("Failed to start overlay server: {error}");
      return;
    }
  };

  if let Ok(mut running) = state.server_running.lock() {
    *running = true;
  }

  thread::spawn(move || {
    for request in server.incoming_requests() {
      let request_url = request.url().to_string();
      let path = request_url.split('?').next().unwrap_or("/");
      let response = if path == "/api/ranked" {
        handle_ranked(&state, &request_url)
      } else {
        serve_static(path).unwrap_or_else(|| {
          text_response(404, "text/plain; charset=utf-8", "Not found".to_string())
        })
      };

      let _ = request.respond(response);
    }
  });
}

fn settings_path(app: &tauri::App) -> PathBuf {
  app
    .path()
    .app_config_dir()
    .unwrap_or_else(|_| dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")))
    .join("settings.json")
}

fn main() {
  tauri::Builder::default()
    .setup(|app| {
      let path = settings_path(app);
      let settings = load_settings(&path);
      let state = Arc::new(AppState {
        settings_path: path,
        settings: Mutex::new(settings),
        cache: Mutex::new(HashMap::new()),
        server_running: Mutex::new(false),
      });

      start_overlay_server(Arc::clone(&state));
      app.manage(state);
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![get_settings, save_settings])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
