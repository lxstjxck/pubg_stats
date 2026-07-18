import express from "express";
import "dotenv/config";

const app = express();
const PORT = process.env.PORT || 3000;

// Create a local .env file or set this variable in the environment.
const API_KEY = process.env.PUBG_API_KEY;
if (!API_KEY) {
  console.error("ERROR: Set PUBG_API_KEY in .env or in your environment.");
  process.exit(1);
}

app.use(express.static("public"));

const PUBG_BASE = "https://api.pubg.com";
const HEADERS = {
  "Authorization": `Bearer ${API_KEY}`,
  "Accept": "application/vnd.api+json",
};

const cache = new Map();
const ALLOWED_MODES = ["tpp-duo", "tpp-squad", "fpp-duo", "fpp-squad"];

function cacheGet(key) {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() > v.exp) {
    cache.delete(key);
    return null;
  }
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

function apiError(res, status, code, message, extra = {}) {
  return res.status(status).json({
    code,
    error: message,
    message,
    ...extra,
  });
}

function normalizeMode(mode) {
  const aliases = {
    duo: "tpp-duo",
    squad: "tpp-squad",
    "duo-fpp": "fpp-duo",
    "squad-fpp": "fpp-squad",
  };
  return aliases[mode] || mode;
}

function toPubgMode(mode) {
  const modes = {
    "tpp-duo": "duo",
    "tpp-squad": "squad",
    "fpp-duo": "duo-fpp",
    "fpp-squad": "squad-fpp",
  };
  return modes[normalizeMode(mode)];
}

function fromPubgMode(mode) {
  return normalizeMode(mode);
}

async function pubgFetch(url) {
  let res;
  try {
    res = await fetch(url, { headers: HEADERS });
  } catch (e) {
    const err = new Error("Network error");
    err.status = 0;
    err.details = e.message;
    throw err;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`PUBG API ${res.status}`);
    err.status = res.status;
    err.details = text.slice(0, 300);
    throw err;
  }
  return res.json();
}

function pubgErrorPayload(error) {
  const status = error.status || 500;
  const details = error.details || error.message;

  if (status === 0) {
    return {
      status: 502,
      code: "Network error",
      message: "Could not connect to PUBG API. Check your internet connection and try again.",
      details,
    };
  }

  if (status === 401) {
    return {
      status,
      code: "Invalid API key",
      message: "PUBG API rejected the API key. Check the key in app settings.",
      details,
    };
  }

  if (status === 403) {
    return {
      status,
      code: "API key forbidden",
      message: "PUBG API denied access for this key. The key may be blocked or not allowed to use this endpoint.",
      details,
    };
  }

  if (status === 404) {
    return {
      status,
      code: "PUBG data not found",
      message: "PUBG API did not find the requested player, season, or stats endpoint.",
      details,
    };
  }

  if (status === 429) {
    return {
      status,
      code: "Rate limit",
      message: "Too many PUBG API requests. Increase the refresh interval or wait a few minutes.",
      details,
    };
  }

  if (status >= 500) {
    return {
      status: 502,
      code: "PUBG API unavailable",
      message: "PUBG API is not responding correctly right now. Try again later.",
      details,
    };
  }

  return {
    status,
    code: "PUBG API error",
    message: `PUBG API returned HTTP ${status}.`,
    details,
  };
}

app.get("/api/ranked", async (req, res) => {
  try {
    const platform = (req.query.platform || "steam").toString();
    const playerName = (req.query.player || "").toString().trim();
    const mode = normalizeMode((req.query.mode || "fpp-squad").toString());
    const pubgMode = toPubgMode(mode);

    if (!playerName) {
      return apiError(res, 400, "Missing player", "Add a PUBG player nickname to the overlay URL.");
    }

    if (!pubgMode) {
      return apiError(res, 400, "Invalid mode", "Ranked overlay supports only duo and squad ranked modes.", {
        mode,
        allowedModes: ALLOWED_MODES,
      });
    }

    const cacheKey = `ranked:${platform}:${playerName}:${mode}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const playerUrl = `${PUBG_BASE}/shards/${platform}/players?filter[playerNames]=${encodeURIComponent(playerName)}`;
    const playerJson = await pubgFetch(playerUrl);
    const playerId = playerJson?.data?.[0]?.id;
    if (!playerId) {
      return apiError(res, 404, "Player not found", "PUBG API did not find this player on the selected platform.", {
        player: playerName,
        platform,
      });
    }

    const seasonsKey = `seasons:${platform}`;
    let seasonsJson = cacheGet(seasonsKey);
    if (!seasonsJson) {
      const seasonsUrl = `${PUBG_BASE}/shards/${platform}/seasons`;
      seasonsJson = await pubgFetch(seasonsUrl);
      cacheSet(seasonsKey, seasonsJson, 6 * 60 * 60 * 1000);
    }

    const currentSeason = (seasonsJson?.data || []).find(s => s?.attributes?.isCurrentSeason);
    const seasonId = currentSeason?.id;
    if (!seasonId) {
      return apiError(res, 502, "Season not found", "PUBG API did not return a current ranked season.", { platform });
    }

    const rankedUrl = `${PUBG_BASE}/shards/${platform}/players/${playerId}/seasons/${seasonId}/ranked`;
    const rankedJson = await pubgFetch(rankedUrl);

    const statsByMode = rankedJson?.data?.attributes?.rankedGameModeStats || {};
    const availableModes = Object.keys(statsByMode || {}).map(fromPubgMode);
    if (availableModes.length === 0) {
      return apiError(res, 404, "No ranked stats", "This player has no ranked stats for the current season.", {
        player: playerName,
        platform,
        seasonId,
        allowedModes: ALLOWED_MODES,
      });
    }

    const m = statsByMode?.[pubgMode];
    if (!m) {
      return apiError(res, 404, "Mode unavailable", "This player has no ranked stats for the selected mode in the current season.", {
        player: playerName,
        mode,
        availableModes,
        allowedModes: ALLOWED_MODES,
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
      raw: m,
      updatedAt: new Date().toISOString(),
    };

    cacheSet(cacheKey, payload, 60 * 1000);
    res.json(payload);
  } catch (e) {
    const payload = pubgErrorPayload(e);
    res.status(payload.status).json({
      code: payload.code,
      error: payload.message,
      message: payload.message,
      details: payload.details,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Overlay server running: http://localhost:${PORT}/overlay.html`);
});
