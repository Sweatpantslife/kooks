import { Resolver } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { KooksError } from "./store.js";

// Reading one recipe page from the web for an import. It is the only place
// Kooks fetches anything: a page the household named, on the public
// internet, never this machine or the network it sits on. The address is
// checked when it resolves and the connection goes to the address checked,
// so a name that later points somewhere else gains nothing; every redirect
// is checked the same way. The page is read as text, never run, and is not
// kept.

const MB = 1024 * 1024;

// Everything that is not the public internet: this machine, private and
// shared networks, link-local (cloud metadata lives there), multicast,
// documentation and reserved ranges, and the IPv6 forms that can carry any
// of them. A block list checks an IPv4-mapped address (::ffff:a.b.c.d)
// against the IPv4 ranges itself; NAT64, 6to4, Teredo and the old
// IPv4-compatible form (::a.b.c.d) need their own.
const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
])
  blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
])
  blocked.addSubnet(network, prefix, "ipv6");

export const isPublicAddress = (address) => {
  const family = isIP(address);
  return family !== 0 && !blocked.check(address, `ipv${family}`);
};

// One message for any page Kooks could not read, whatever the site said: a
// public address can loop back into the household's own router, and what
// it answers is not for the caller to learn.
const unreadablePage = () =>
  unreadable(
    "Kooks couldn’t read a recipe from that page. Check the link, or paste the recipe instead.",
  );
const refused = () =>
  new KooksError(
    "LINK_REFUSED",
    "Kooks reads recipe pages on the public web only, not on this computer or its network.",
  );
const unreadable = (message) => new KooksError("LINK_UNREADABLE", message);

// The address as Kooks will fetch it, or why not. A literal IP address
// never goes through name resolution, so it is checked here, on every hop.
function checked(address, { allowed, anyPort }) {
  let url;
  try {
    url = new URL(address);
  } catch {
    throw unreadable("That is not a web address.");
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw unreadable("Use a web address that starts with https:// or http://.");
  if (url.username || url.password)
    throw unreadable("Use the page’s address without a name or password.");
  if (url.port && !anyPort)
    throw unreadable(
      "Kooks reads pages at ordinary web addresses only, without a port number.",
    );
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !allowed(host)) throw refused();
  url.hash = "";
  return url;
}

// Name resolution for the connection itself: every address the name has
// must be public, and the connection uses one of them.
const guardedLookup = (allowed, resolver) => (hostname, options, callback) =>
  resolver(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || !addresses.every((a) => allowed(a.address)))
      return callback(refused());
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });

// A name's addresses, asked of DNS directly. The system's lookup runs on
// Node's small thread pool and cannot be cancelled, so a name whose server
// never answers would hold a thread long after the page was given up; these
// queries do not use the pool and give up after a few seconds. A public page
// needs nothing from the hosts file.
function resolveName(hostname, options, callback) {
  const dns = new Resolver({ timeout: 3000, tries: 2 });
  Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)]).then(
    ([four, six]) => {
      const addresses = [
        ...(four.value ?? []).map((address) => ({ address, family: 4 })),
        ...(six.value ?? []).map((address) => ({ address, family: 6 })),
      ];
      if (!addresses.length) return callback(four.reason ?? six.reason);
      callback(null, addresses);
    },
  );
}

// Agents of its own, without keep-alive, so no proxy setting or pooled
// connection stands between the check and the connection. Certificates are
// checked as usual.
const agents = {
  "http:": new http.Agent({ keepAlive: false }),
  "https:": new https.Agent({ keepAlive: false }),
};

function get(url, { allowed, resolver, signal }) {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).get(
      url,
      {
        agent: agents[url.protocol],
        lookup: guardedLookup(allowed, resolver),
        signal,
        headers: {
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "accept-encoding": "gzip, deflate, br",
          "user-agent":
            "Mozilla/5.0 (compatible; Kooks recipe import; +https://github.com/Sweatpantslife/kooks)",
        },
      },
      resolve,
    );
    request.on("error", reject);
  });
}

// The body as text, at most `limit` bytes once decompressed.
async function text(response, limit) {
  const encoding = String(response.headers["content-encoding"] ?? "")
    .trim()
    .toLowerCase();
  const decoders = {
    gzip: createGunzip,
    "x-gzip": createGunzip,
    deflate: createInflate,
    br: createBrotliDecompress,
  };
  const known = Object.hasOwn(decoders, encoding);
  if (encoding && encoding !== "identity" && !known) {
    response.destroy();
    throw unreadablePage();
  }
  const stream = known ? response.pipe(decoders[encoding]()) : response;
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > limit) throw unreadablePage();
      chunks.push(chunk);
    }
  } finally {
    response.destroy();
  }
  const charset =
    /charset\s*=\s*"?([\w-]+)/i.exec(response.headers["content-type"])?.[1] ??
    "utf-8";
  let decoder;
  try {
    decoder = new TextDecoder(charset);
  } catch {
    decoder = new TextDecoder("utf-8");
  }
  return decoder.decode(Buffer.concat(chunks));
}

// Fetch one web page: { url, html }, where url is the page's own address
// after any redirects. Tests may allow their own loopback server and port
// and resolve names their way.
export async function fetchPage(
  address,
  {
    allowed = isPublicAddress,
    anyPort = false,
    resolver = resolveName,
    timeout = 10000,
    limit = 3 * MB,
    redirects = 5,
  } = {},
) {
  const signal = AbortSignal.timeout(timeout);
  const rules = { allowed, anyPort };
  let url = checked(address, rules);
  try {
    for (let hop = 0; ; hop++) {
      const response = await get(url, { allowed, resolver, signal });
      const { statusCode: status, headers } = response;
      if ([301, 302, 303, 307, 308].includes(status) && headers.location) {
        response.destroy();
        if (hop >= redirects) throw unreadablePage();
        url = checked(new URL(headers.location, url).href, rules);
        continue;
      }
      if (
        status !== 200 ||
        !/^\s*(text\/html|application\/xhtml\+xml)\b/i.test(
          headers["content-type"] ?? "",
        )
      ) {
        response.destroy();
        throw unreadablePage();
      }
      return { url: url.href, html: await text(response, limit) };
    }
  } catch (error) {
    if (error instanceof KooksError) throw error;
    throw unreadablePage();
  }
}
