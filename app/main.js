const invoke = window.__TAURI__?.core?.invoke;

const els = {
  form: document.getElementById("settingsForm"),
  apiKey: document.getElementById("apiKey"),
  apiKeyHint: document.getElementById("apiKeyHint"),
  platform: document.getElementById("platform"),
  player: document.getElementById("player"),
  mode: document.getElementById("mode"),
  refresh: document.getElementById("refresh"),
  port: document.getElementById("port"),
  obsUrl: document.getElementById("obsUrl"),
  preview: document.getElementById("preview"),
  copyLink: document.getElementById("copyLink"),
  serverStatus: document.getElementById("serverStatus"),
};

const modeAliases = {
  duo: "tpp-duo",
  squad: "tpp-squad",
  "duo-fpp": "fpp-duo",
  "squad-fpp": "fpp-squad",
};
const allowedModes = new Set(["tpp-duo", "tpp-squad", "fpp-duo", "fpp-squad"]);

function normalizeMode(mode) {
  const normalized = modeAliases[mode] || mode;
  return allowedModes.has(normalized) ? normalized : "fpp-squad";
}

function getFormSettings() {
  return {
    apiKey: els.apiKey.value.trim() || null,
    platform: els.platform.value,
    player: els.player.value.trim(),
    mode: normalizeMode(els.mode.value),
    refresh: Number(els.refresh.value || 60000),
    port: Number(els.port.value || 3000),
  };
}

function buildUrl(settings) {
  const url = new URL(`http://localhost:${settings.port}/overlay.html`);
  url.searchParams.set("platform", settings.platform || "steam");
  url.searchParams.set("player", settings.player || "YOUR_NICK");
  url.searchParams.set("mode", normalizeMode(settings.mode));
  url.searchParams.set("refresh", String(settings.refresh || 60000));
  return url.toString();
}

function render(settings) {
  const url = buildUrl(settings);
  els.obsUrl.textContent = url;
  els.preview.src = url;
}

function fill(settings) {
  els.platform.value = settings.platform || "steam";
  els.player.value = settings.player || "";
  els.mode.value = normalizeMode(settings.mode);
  els.refresh.value = settings.refresh || 60000;
  els.port.value = settings.port || 3000;
  els.apiKeyHint.textContent = settings.hasApiKey
    ? "A key is already stored locally. Leave this field empty to keep it."
    : "No API key saved yet. Paste one and save settings.";
  render(settings);
}

async function loadSettings() {
  if (!invoke) {
    els.serverStatus.textContent = "Tauri API unavailable";
    return;
  }

  const settings = await invoke("get_settings");
  fill(settings);
  els.serverStatus.textContent = settings.serverRunning ? "Local server running" : "Local server unavailable";
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = await invoke("save_settings", { settings: getFormSettings() });
  els.apiKey.value = "";
  fill(settings);
  els.serverStatus.textContent = settings.serverRunning ? "Saved" : "Saved, restart app to change port";
});

els.copyLink.addEventListener("click", async () => {
  await navigator.clipboard.writeText(els.obsUrl.textContent);
  els.copyLink.textContent = "Copied";
  setTimeout(() => {
    els.copyLink.textContent = "Copy OBS URL";
  }, 1200);
});

for (const input of [els.platform, els.player, els.mode, els.refresh, els.port]) {
  input.addEventListener("input", () => render(getFormSettings()));
}

loadSettings().catch((error) => {
  els.serverStatus.textContent = "Error";
  els.obsUrl.textContent = error?.message || String(error);
});
