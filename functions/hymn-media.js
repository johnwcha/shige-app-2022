// The legacy hymns collection stores edition/number inside a human-readable label.
function parseHymnLabel(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(
      /^(大本(?:詩歌|诗歌)?|d|補充本?|小本|b)\s*(\d+)(?=\D|$)/i,
  );
  if (!match) return null;
  return {
    edition: /^(大本|d)/i.test(match[1]) ? "ch" : "ts",
    hymnNumber: match[2].replace(/^0+(?=\d)/, ""),
  };
}

function normalizeYoutubeUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) {
      return null;
    }
    const host = url.hostname.toLowerCase();
    let videoId;
    if (host === "youtu.be") {
      videoId = url.pathname.slice(1);
    } else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)) {
      videoId = url.pathname === "/watch" ? url.searchParams.get("v") :
        url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)\/?$/)?.[1];
    }
    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
    const canonical = new URL("https://www.youtube.com/watch");
    canonical.searchParams.set("v", videoId);
    const time = url.searchParams.get("t") || url.searchParams.get("start");
    if (time && /^(?:\d+|(?:\d+h)?(?:\d+m)?(?:\d+s)?)$/.test(time)) {
      canonical.searchParams.set("t", time);
    }
    return canonical.href;
  } catch {
    return null;
  }
}

function buildLegacyMediaIndex(docs) {
  const index = new Map();
  // Choose the most recently edited valid YouTube recording; ID breaks ties.
  const sorted = [...docs].sort((a, b) => {
    const timestamp = doc => doc.data().updated?.toMillis?.() || 0;
    return timestamp(b) - timestamp(a) || a.id.localeCompare(b.id);
  });
  for (const doc of sorted) {
    const data = doc.data();
    const hymn = parseHymnLabel(data.hymn);
    const youtubeUrl = normalizeYoutubeUrl(data.link);
    if (!hymn || !youtubeUrl) continue;
    const key = `${hymn.edition}:${hymn.hymnNumber}`;
    if (!index.has(key)) index.set(key, youtubeUrl);
  }
  return index;
}

module.exports = {parseHymnLabel, normalizeYoutubeUrl, buildLegacyMediaIndex};
