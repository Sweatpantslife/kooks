import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { gzipSync } from "node:zlib";
import { Store } from "../mcp/store.js";
import { createTools } from "../mcp/tools.js";
import { fetchPage, isPublicAddress } from "../mcp/fetch-page.js";
import { minutesOf, readRecipePage } from "../mcp/recipe-page.js";

const refusal = { code: "LINK_REFUSED" };
const unreadable = {
  code: "LINK_UNREADABLE",
  message:
    "Kooks couldn’t read a recipe from that page. Check the link, or paste the recipe instead.",
};

// Names resolved from a table, the way dns.lookup answers with all: true.
const resolverOf = (table) => (hostname, options, callback) => {
  const addresses = table[hostname];
  if (!addresses) return callback(new Error("ENOTFOUND"));
  callback(
    null,
    addresses.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    })),
  );
};

test("pages on this machine or its network are refused before any connection", async () => {
  for (const address of [
    "http://127.0.0.1/",
    "http://2130706433/",
    "http://0x7f.1/",
    "http://127.1/",
    "http://[::1]/",
    "http://0/",
    "http://0.0.0.0/",
    "http://[::]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::7f00:1]/",
    "http://[64:ff9b::7f00:1]/",
    "http://[2002:7f00:1::]/",
    "http://[2001:0:7f00:1::]/",
    "http://[fd00::1]/",
    "http://[fe80::1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.1/",
    "http://172.16.5.4/",
    "http://192.168.1.1/",
    "http://100.64.0.1/",
    "http://192.0.0.8/",
    "http://198.18.0.1/",
    "http://224.0.0.1/",
    "http://240.0.0.1/",
    "http://255.255.255.255/",
  ])
    await assert.rejects(
      fetchPage(address, {
        resolver: () => assert.fail("no name to resolve"),
      }),
      refusal,
      address,
    );
  for (const address of [
    "8.8.8.8",
    "1.1.1.1",
    "::ffff:8.8.8.8",
    "2606:4700:4700::1111",
  ])
    assert.ok(isPublicAddress(address), address);
});

test("only ordinary web addresses are read", async () => {
  for (const [address, message] of [
    ["not a link", /not a web address/],
    ["ftp://example.com/r", /https:\/\//],
    ["file:///etc/passwd", /https:\/\//],
    ["https://cook:secret@example.com/", /without a name or password/],
    ["https://example.com:8443/", /without a port number/],
  ])
    await assert.rejects(fetchPage(address), {
      code: "LINK_UNREADABLE",
      message,
    });
});

test("a name is refused when any of its addresses is not public", async () => {
  const resolver = resolverOf({
    "inside.test": ["10.0.0.5"],
    "both.test": ["93.184.215.14", "192.168.0.2"],
    "six.test": ["2606:4700::6810:1", "::1"],
  });
  for (const name of ["inside.test", "both.test", "six.test"])
    await assert.rejects(
      fetchPage(`https://${name}/recipe`, { resolver }),
      refusal,
      name,
    );
});

// A page server on loopback, which the tests allow and nothing else does.
async function pages(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  return {
    port,
    url: (path) => `http://127.0.0.1:${port}${path}`,
  };
}
const local = (extra = {}) => ({
  allowed: (address) => address === "127.0.0.1",
  anyPort: true,
  ...extra,
});

const page = (recipe) =>
  `<!doctype html><html><head><title>x</title><script type="application/ld+json">${JSON.stringify(recipe)}</script></head><body>Recipe</body></html>`;

test("a page is read after redirects, and a redirect inward is refused", async (t) => {
  const site = await pages(t, (req, res) => {
    const to = {
      "/old": "/recipe",
      "/metadata": "http://169.254.169.254/latest/",
      "/inside": `http://elsewhere.test:${site.port}/recipe`,
      "/loop": "/loop",
    }[req.url];
    if (to) {
      res.writeHead(302, { Location: to });
      return res.end();
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page({ "@type": "Recipe", name: "Toast" }));
  });
  const read = await fetchPage(site.url("/old"), local());
  assert.equal(read.url, site.url("/recipe"));
  assert.match(read.html, /"name":"Toast"/);

  // A name is resolved once, checked, and connected to as checked.
  const named = await fetchPage(
    `http://recipes.test:${site.port}/old`,
    local({ resolver: resolverOf({ "recipes.test": ["127.0.0.1"] }) }),
  );
  assert.equal(named.url, `http://recipes.test:${site.port}/recipe`);

  await assert.rejects(fetchPage(site.url("/metadata"), local()), refusal);
  await assert.rejects(
    fetchPage(
      site.url("/inside"),
      local({
        resolver: resolverOf({ "elsewhere.test": ["127.0.0.1", "10.9.8.7"] }),
      }),
    ),
    refusal,
  );
  await assert.rejects(fetchPage(site.url("/loop"), local()), unreadable);
});

test("what a site answers is never repeated, and large or slow pages are let go", async (t) => {
  const bomb = gzipSync(Buffer.alloc(8 * 1024 * 1024, 32));
  const site = await pages(t, (req, res) => {
    if (req.url === "/error") {
      res.writeHead(500, { "Content-Type": "text/html", "X-Secret": "router" });
      return res.end("router admin page: password=hunter2");
    }
    if (req.url === "/json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end('{"secret":"hunter2"}');
    }
    if (req.url === "/bomb") {
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Content-Encoding": "gzip",
      });
      return res.end(bomb);
    }
    if (req.url === "/constructor") {
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Content-Encoding": "constructor",
      });
      return res.end("hunter2");
    }
    if (req.url === "/odd") {
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Content-Encoding": "zstd-ish",
      });
      return res.end("hunter2");
    }
    // /slow never answers.
  });
  for (const path of [
    "/error",
    "/json",
    "/bomb",
    "/odd",
    "/constructor",
    "/slow",
  ]) {
    const error = await fetchPage(
      site.url(path),
      local({ limit: 1024 * 1024, timeout: 300 }),
    ).then(
      () => assert.fail(path),
      (e) => e,
    );
    assert.deepEqual(
      { code: error.code, message: error.message },
      unreadable,
      path,
    );
  }
});

test("a recipe page's schema.org data becomes the draft's fields, read as text", () => {
  const before = Object.prototype.polluted;
  const html = `<html><head>
    <script>var recipe = {"@type":"Recipe","name":"Not this"};</script>
    <SCRIPT TYPE='application/ld+json'>{ not json }</SCRIPT>
    <script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebPage", url: "javascript:alert(1)" },
        {
          "@type": ["Recipe", "NewsArticle"],
          __proto__: { polluted: true },
          name: "Lemon &amp; herb <em>orzo</em>",
          description: "Bright &#38; quick.",
          url: "javascript:alert(1)",
          image: "http://169.254.169.254/x.jpg",
          recipeYield: ["4", "4 servings"],
          recipeIngredient: ["300 g orzo", "1 <b>lemon</b>", "", { n: 1 }],
          recipeInstructions: [
            {
              "@type": "HowToSection",
              name: "Orzo",
              itemListElement: [
                { "@type": "HowToStep", text: "Boil the orzo." },
                { "@type": "HowToStep", text: "Drain it." },
              ],
            },
            { "@type": "HowToStep", text: "Add the lemon." },
          ],
          prepTime: "PT10M",
          cookTime: "PT15M",
          recipeCategory: ["Dinner", "Main Course"],
          recipeCuisine: "Greek",
        },
      ],
    })}</script></head></html>`;
  const read = readRecipePage(html);
  assert.equal(Object.prototype.polluted, before);
  assert.deepEqual(read, {
    title: "Lemon & herb orzo",
    servings: 4,
    ingredients: ["300 g orzo", "1 lemon"],
    steps: ["Orzo: Boil the orzo.", "Drain it.", "Add the lemon."],
    total_minutes: 25,
    course: "main",
    cuisine: "Greek",
    text: "Lemon & herb orzo\n\nBright & quick.\n\nYield: 4\n\nIngredients\n300 g orzo\n1 lemon\n\nMethod\n1. Orzo: Boil the orzo.\n2. Drain it.\n3. Add the lemon.",
  });
  // Instructions as one text, and a yield in words.
  const plainOne = readRecipePage(
    page({
      "@type": "Recipe",
      name: "Shortbread",
      recipeYield: "Makes 12 biscuits",
      recipeInstructions: "Cream the butter.\nAdd flour.<br>Bake.",
      totalTime: "PT1H5M",
    }),
  );
  assert.deepEqual(plainOne.steps, [
    "Cream the butter.",
    "Add flour.",
    "Bake.",
  ]);
  assert.equal(plainOne.servings, 12);
  assert.equal(plainOne.total_minutes, 65);
  // A letter that lowercases to two characters moves nothing.
  assert.equal(
    readRecipePage(
      `<title>İç pilav</title>${page({ "@type": "Recipe", name: "İç pilav" })}`,
    ).title,
    "İç pilav",
  );
  assert.throws(() => readRecipePage(page({ "@type": "Article" })), {
    code: "NO_RECIPE",
  });
  assert.throws(() => readRecipePage("<html>no data</html>"), {
    code: "NO_RECIPE",
  });
  assert.deepEqual(
    ["PT1H30M", "P0DT0H45M", "PT90S", "PT", "P", "P8D", "soon"].map(minutesOf),
    [90, 45, 2, null, null, null, null],
  );
});

test("recipe_import_link saves a draft from the page with the address it was read from", async (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const asked = [];
  const tools = new Map(
    createTools(store, {
      readPage: async (url) => {
        asked.push(url);
        return {
          url: "https://recipes.example/orzo",
          html: page({
            "@type": "Recipe",
            name: "Orzo",
            url: "javascript:alert(1)",
            recipeYield: "4",
            recipeIngredient: ["300 g orzo", "2 cups stock"],
            recipeInstructions: ["Cook it."],
          }),
        };
      },
    }).map((tool) => [tool.name, tool]),
  );
  assert.equal(tools.get("recipe_import_link").openWorld, true);
  assert.equal(
    [...tools.values()].filter((tool) => tool.openWorld).length,
    1,
    "no other tool reaches beyond this machine",
  );
  const { record } = await tools.get("recipe_import_link").execute({
    request_id: "link-1",
    url: "https://short.example/o",
  });
  assert.deepEqual(asked, ["https://short.example/o"]);
  assert.equal(record.data.status, "draft");
  assert.equal(record.data.recipe.source_url, "https://recipes.example/orzo");
  assert.deepEqual(record.data.recipe.links, []);
  assert.equal(record.data.recipe.servings, 4);
  assert.deepEqual(
    record.data.recipe.ingredients.map((i) => [i.quantity, i.unit, i.name]),
    [
      [300, "g", "orzo"],
      [2, "cup", "stock"],
    ],
  );
  assert.match(record.data.original_text, /^Orzo\n/);
  assert.deepEqual(record.data.warnings, [
    "Cup and spoon conventions are unspecified. Original units are preserved.",
  ]);
  // Only web addresses are taken.
  await assert.rejects(async () =>
    tools.get("recipe_import_link").execute({
      request_id: "link-2",
      url: "javascript:alert(1)",
    }),
  );
  const { record: saved } = await tools.get("recipe_import_commit").execute({
    request_id: "commit-1",
    id: record.id,
    expected_version: record.version,
    reviewed: true,
    recipe: record.data.recipe,
  });
  assert.equal(saved.data.source_url, "https://recipes.example/orzo");
});
