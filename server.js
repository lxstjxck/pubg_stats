import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

// 1) Получите ключ на PUBG Developer Portal, затем задайте переменной окружения:
// Windows (PowerShell): setx PUBG_API_KEY "ваш_ключ"
const API_KEY = process.env.PUBG_API_KEY;
if (!API_KEY) {
  console.error("ERROR: Set PUBG_API_KEY env var.");
  process.exit(1);
}

app.use(express.static("public"));

const PUBG_BASE = "https://api.pubg.com";
const HEADERS = {
  "Authorization": `Bearer ${API_KEY}`,
  "Accept": "application/vnd.api+json",
};

const cache = new Map();

function cacheGet(key) {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() > v.exp) { cache.delete(key); return null; }
  return v.data;
}
function cacheSet(key, data, ttlMs) {
  cache.set(key, { data, exp: Date.now() + ttlMs });
}

function tierToText(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value !== "object") return "";

  const tier = tierToText(value.tier || value.currentTier || value.name || value.value);
  const sub = tierToText(value.subTier || value.currentSubTier || value.subtier || value.level);
  return [tier, sub].filter(Boolean).join(" ").trim();
}

async function pubgFetch(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PUBG API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

app.get("/api/ranked", async (req, res) => {
  try {
    const platform = (req.query.platform || "steam").toString();
    const playerName = (req.query.player || "").toString().trim();
    const mode = (req.query.mode || "squad-fpp").toString();

    if (!playerName) {
      return res.status(400).json({ error: "Missing player" });
    }

    const cacheKey = `ranked:${platform}:${playerName}:${mode}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    // 1) playerId
    const playerUrl = `${PUBG_BASE}/shards/${platform}/players?filter[playerNames]=${encodeURIComponent(playerName)}`;
    const playerJson = await pubgFetch(playerUrl);
    const playerId = playerJson?.data?.[0]?.id;
    if (!playerId) return res.status(404).json({ error: "Player not found" });

    // 2) current season
    const seasonsKey = `seasons:${platform}`;
    let seasonsJson = cacheGet(seasonsKey);
    if (!seasonsJson) {
      const seasonsUrl = `${PUBG_BASE}/shards/${platform}/seasons`;
      seasonsJson = await pubgFetch(seasonsUrl);
      // сезоны меняются редко; можно кэшировать надолго
      cacheSet(seasonsKey, seasonsJson, 6 * 60 * 60 * 1000);
    }
    const currentSeason = (seasonsJson?.data || []).find(s => s?.attributes?.isCurrentSeason);
    const seasonId = currentSeason?.id;
    if (!seasonId) return res.status(500).json({ error: "Current season not found" });

    // 3) ranked stats
    const rankedUrl = `${PUBG_BASE}/shards/${platform}/players/${playerId}/seasons/${seasonId}/ranked`;
    const rankedJson = await pubgFetch(rankedUrl);

    const statsByMode = rankedJson?.data?.attributes?.rankedGameModeStats || {};
    const m = statsByMode?.[mode];
    if (!m) {
      return res.status(404).json({
        error: "Mode not found in rankedGameModeStats",
        availableModes: Object.keys(statsByMode || {}),
      });
    }

    const payload = {
      player: playerName,
      platform,
      seasonId,
      mode,
      tier: tierToText(m.currentTier) || tierToText(m.currentSubTier) || "",
      rp: m.currentRankPoint ?? null,
      roundsPlayed: m.roundsPlayed ?? null,
      wins: m.wins ?? null,
      top10Ratio: m.top10Ratio ?? null,
      kda: m.kda ?? null,
      raw: m, // оставим сырой объект на всякий случай
      updatedAt: new Date().toISOString(),
    };

    cacheSet(cacheKey, payload, 60 * 1000); // обновление раз в минуту
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Overlay server running: http://localhost:${PORT}/overlay.html`);
});
