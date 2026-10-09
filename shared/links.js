// Recipe links and the video players both clients can embed for them. This
// module only reads a URL: nothing here fetches a page, and a site without a
// known player stays a plain link that opens in the browser.

export const providerNames = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
};

// Every player src produced below comes from one of these origins. The web
// server allows exactly this list in its Content-Security-Policy frame-src.
export const embedOrigins = [
  "https://www.youtube-nocookie.com",
  "https://player.vimeo.com",
  "https://www.facebook.com",
  "https://www.instagram.com",
  "https://www.tiktok.com",
];

export const MAX_LINKS = 50;

export function isWebUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const hostOf = (url) =>
  url.hostname.toLowerCase().replace(/^(www|m|mobile|web)\./, "");
const pathOf = (url) => url.pathname.split("/").filter(Boolean);
const digits = /^\d{1,20}$/;

// "90", "90s", "1m30s" or "1h2m3s" from a shared YouTube link.
function youtubeStart(url) {
  const raw = url.searchParams.get("start") ?? url.searchParams.get("t") ?? "";
  const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (!raw || !match) return 0;
  return (
    Number(match[1] ?? 0) * 3600 +
    Number(match[2] ?? 0) * 60 +
    Number(match[3] ?? 0)
  );
}

function youtube(url) {
  const host = hostOf(url),
    parts = pathOf(url);
  let id = null,
    shape = "wide";
  if (host === "youtu.be") id = parts[0];
  else if (
    ["youtube.com", "music.youtube.com", "youtube-nocookie.com"].includes(host)
  ) {
    if (parts[0] === "watch") id = url.searchParams.get("v");
    else if (["shorts", "embed", "live", "v"].includes(parts[0])) {
      id = parts[1];
      if (parts[0] === "shorts") shape = "tall";
    } else if (parts[0] === "playlist") {
      const list = url.searchParams.get("list");
      return list && /^[A-Za-z0-9_-]{2,}$/.test(list)
        ? {
            provider: "youtube",
            src: `https://www.youtube-nocookie.com/embed/videoseries?list=${list}`,
            shape,
          }
        : null;
    }
  }
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  const start = youtubeStart(url);
  return {
    provider: "youtube",
    src: `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ""}`,
    shape,
  };
}

// Paths whose trailing number is a collection, not a video.
const vimeoCollections = new Set([
  "groups",
  "channels",
  "album",
  "albums",
  "showcase",
  "user",
  "users",
  "ondemand",
  "event",
  "manage",
]);
function vimeo(url) {
  const host = hostOf(url),
    parts = pathOf(url);
  if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;
  let id = null,
    hash = url.searchParams.get("h") ?? "";
  if (host === "player.vimeo.com") {
    if (parts[0] === "video") id = parts[1];
  } else {
    const last = parts[parts.length - 1] ?? "",
      previous = parts[parts.length - 2] ?? "";
    if (digits.test(last) && !vimeoCollections.has(previous)) id = last;
    else if (/^[0-9a-f]{6,}$/i.test(last) && digits.test(previous)) {
      // Unlisted videos carry their access hash as a second path segment.
      id = previous;
      hash = last;
    }
  }
  if (!id || !digits.test(id)) return null;
  return {
    provider: "vimeo",
    src: `https://player.vimeo.com/video/${id}${hash ? `?h=${encodeURIComponent(hash)}` : ""}`,
    shape: "wide",
  };
}

function facebook(url) {
  const host = hostOf(url),
    parts = pathOf(url);
  if (host !== "facebook.com" && host !== "fb.com") return null;
  const v = url.searchParams.get("v") ?? "";
  const videos = parts.indexOf("videos");
  const video =
    (videos >= 0 &&
      parts.slice(videos + 1).some((part) => digits.test(part))) ||
    (parts[0] === "reel" && digits.test(parts[1] ?? "")) ||
    (["watch", "video.php"].includes(parts[0]) && digits.test(v));
  if (!video) return null;
  const href = `https://www.facebook.com/${parts.join("/")}${digits.test(v) ? `?v=${v}` : ""}`;
  return {
    provider: "facebook",
    src: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(href)}&show_text=false`,
    shape: parts[0] === "reel" ? "tall" : "wide",
  };
}

function instagram(url) {
  if (hostOf(url) !== "instagram.com") return null;
  const parts = pathOf(url);
  const at = parts.findIndex((part) =>
    ["p", "reel", "reels", "tv"].includes(part),
  );
  const code = at >= 0 ? parts[at + 1] : null;
  if (!code || !/^[A-Za-z0-9_-]{5,}$/.test(code)) return null;
  const kind = parts[at] === "p" || parts[at] === "tv" ? parts[at] : "reel";
  return {
    provider: "instagram",
    src: `https://www.instagram.com/${kind}/${code}/embed/`,
    shape: kind === "p" ? "post" : "portrait",
  };
}

function tiktok(url) {
  if (hostOf(url) !== "tiktok.com") return null;
  const parts = pathOf(url);
  const at = parts.findIndex((part) => ["video", "v2", "v1"].includes(part));
  const id = at >= 0 ? parts[at + 1] : null;
  if (!id || !/^\d{5,}$/.test(id)) return null;
  return {
    provider: "tiktok",
    src: `https://www.tiktok.com/embed/v2/${id}`,
    shape: "portrait",
  };
}

const autoplayParameter = { youtube: "autoplay=1", vimeo: "autoplay=1" };
const withAutoplay = ({ provider, src }) =>
  autoplayParameter[provider]
    ? `${src}${src.includes("?") ? "&" : "?"}${autoplayParameter[provider]}`
    : src;

// What a client can show for one link: the site name, and for a recognised
// video a player. `embed.src` is the plain player; `embed.autoplay_src` is for
// a player opened by the person pressing play. `shape` is one of wide (16:9),
// tall (9:16), post (a square-ish photo post) or portrait (a tall reel).
export function describeLink(url) {
  if (!isWebUrl(url)) return null;
  const parsed = new URL(url);
  const player =
    youtube(parsed) ??
    vimeo(parsed) ??
    facebook(parsed) ??
    instagram(parsed) ??
    tiktok(parsed);
  const site = hostOf(parsed);
  return {
    url,
    site,
    provider: player?.provider ?? null,
    label: player ? providerNames[player.provider] : site,
    embed: player
      ? {
          src: player.src,
          autoplay_src: withAutoplay(player),
          shape: player.shape,
        }
      : null,
  };
}

// Links worth showing on a recipe page: a video source first, then the saved
// links. A source that is an ordinary page already has its own link.
export function displayLinks({ source_url = null, links = [] } = {}) {
  const items = (links ?? []).filter((link) => link && link.url);
  if (
    source_url &&
    describeLink(source_url)?.embed &&
    !items.some((link) => link.url === source_url)
  )
    items.unshift({ url: source_url, title: "Original source" });
  return items;
}

// A bare address such as "youtu.be/abc" or "www.example.com/recipe".
const bareHost = /^(?:[\w-]+\.)+[a-z]{2,}(?:[:/?#]|$)/i;
function webUrlFromWord(word) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(word))
    return isWebUrl(word) ? word : null;
  return bareHost.test(word) && isWebUrl(`https://${word}`)
    ? `https://${word}`
    : null;
}

// Editor text with one link per line: the web address plus an optional title
// in either order. Lines without an address come back as `invalid`.
export function parseLinkLines(text) {
  const links = [],
    invalid = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const words = line.trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const at = words.findIndex((word) => webUrlFromWord(word));
    if (at < 0) {
      invalid.push(words.join(" "));
      continue;
    }
    links.push({
      url: webUrlFromWord(words[at]),
      title: words.filter((_, index) => index !== at).join(" "),
    });
  }
  return { links, invalid };
}

export const formatLinkLines = (links) =>
  (links ?? [])
    .map((link) =>
      [
        link.url,
        String(link.title ?? "")
          .replace(/\s+/g, " ")
          .trim(),
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join("\n");
