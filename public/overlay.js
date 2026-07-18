//overlay
const params = new URLSearchParams(location.search);
const platform = params.get("platform") || "steam";
const player = params.get("player") || "";
const mode = params.get("mode") || "fpp-squad";

const REFRESH_MS = Number(params.get("refresh") || 60000);

const line1 = document.getElementById("line1");
const line2 = document.getElementById("line2");
const line3 = document.getElementById("line3");

function stringifyTier(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);

  if (typeof value === "object") {
    const tier = stringifyTier(value.currentTier || value.tier || value.name || value.value);
    const sub = stringifyTier(value.currentSubTier || value.subTier || value.subtier || value.level);
    return [tier, sub].filter(Boolean).join(" ").trim();
  }

  return "";
}

function isObjectPlaceholder(value) {
  return typeof value === "string" && value.includes("[object Object]");
}

function getTierLabel(payload) {
  const directTier = stringifyTier(payload?.tier);
  if (directTier && !isObjectPlaceholder(directTier)) return directTier;

  const rawTier = stringifyTier(payload?.raw);
  if (rawTier) return rawTier;

  const currentTier = stringifyTier(payload?.raw?.currentTier);
  const currentSubTier = stringifyTier(payload?.raw?.currentSubTier);
  const fromCurrent = [currentTier, currentSubTier].filter(Boolean).join(" ").trim();
  if (fromCurrent) return fromCurrent;

  return "Unranked";
}

function formatRP(value) {
  if (typeof value !== "number") return "-";
  return Math.round(value).toLocaleString();
}

function formatMode(value) {
  if (!value) return "Unknown mode";
  const labels = {
    "tpp-duo": "TPP Duo",
    "tpp-squad": "TPP Squad",
    "fpp-duo": "FPP Duo",
    "fpp-squad": "FPP Squad",
    duo: "TPP Duo",
    squad: "TPP Squad",
    "duo-fpp": "FPP Duo",
    "squad-fpp": "FPP Squad",
  };
  return labels[value] || value.replace(/-/g, " ");
}

function formatError(payload, fallback) {
  const code = payload?.code || "ERROR";
  const message = payload?.message || payload?.error || fallback || "Unknown error";
  const details = [];

  if (payload?.player) details.push(`Player: ${payload.player}`);
  if (payload?.mode) details.push(`Mode: ${formatMode(payload.mode)}`);
  if (Array.isArray(payload?.availableModes) && payload.availableModes.length > 0) {
    details.push(`Available: ${payload.availableModes.map(formatMode).join(", ")}`);
  }
  if (Array.isArray(payload?.allowedModes) && payload.allowedModes.length > 0) {
    details.push(`Use: ${payload.allowedModes.map(formatMode).join(", ")}`);
  }
  if (payload?.details && details.length === 0) {
    details.push(String(payload.details).slice(0, 120));
  }

  return { code, message, details: details.join(" | ") };
}

async function tick() {
  try {
    if (!player) {
      line1.textContent = "Set player nickname";
      line2.textContent = "Use ?player=<name> in URL";
      line3.textContent = "";
      return;
    }

    const url = `/api/ranked?platform=${encodeURIComponent(platform)}&player=${encodeURIComponent(player)}&mode=${encodeURIComponent(mode)}`;
    const r = await fetch(url);
    const j = await r.json();

    if (!r.ok) {
      const error = formatError(j, `HTTP ${r.status}`);
      line1.textContent = error.code;
      line2.textContent = error.message;
      line3.textContent = error.details;
      return;
    }

    const tier = getTierLabel(j);
    const rp = formatRP(j.rp);

    line1.textContent = `${tier} - ${rp} RP`;
    line2.textContent = `${j.player || player} (${formatMode(j.mode || mode)})`;
    line3.textContent = `Updated: ${new Date(j.updatedAt).toLocaleTimeString()}`;
  } catch (e) {
    line1.textContent = "Network error";
    line2.textContent = e.message || "Unknown error";
    line3.textContent = "";
  }
}

tick();
setInterval(tick, REFRESH_MS);
