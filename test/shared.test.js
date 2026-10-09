import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalQuantity,
  convertUnits,
  unitInfo,
} from "../shared/quantities.js";
import { parseQuantity, splitIngredientLine } from "../shared/ingredients.js";
import {
  describeLink,
  displayLinks,
  embedOrigins,
  formatLinkLines,
  isWebUrl,
  parseLinkLines,
} from "../shared/links.js";
import {
  courseKeys,
  dietKeys,
  facetText,
  formatLabels,
  hasFacetFilters,
  matchesFacets,
  parseLabels,
  taxonomy,
} from "../shared/taxonomy.js";

test("shared quantity tokens cover decimals, commas, fractions and mixed numbers", () => {
  assert.equal(parseQuantity("1"), 1);
  assert.equal(parseQuantity("1.5"), 1.5);
  assert.equal(parseQuantity("1,5"), 1.5);
  assert.equal(parseQuantity("1/2"), 0.5);
  assert.equal(parseQuantity("1 1/2"), 1.5);
  assert.equal(parseQuantity("1/0"), null);
  assert.equal(parseQuantity("abc"), null);
});

test("shared ingredient lines split into quantity, unit token, name and preparation", () => {
  assert.deepEqual(splitIngredientLine("250g rice"), {
    original: "250g rice",
    quantity: 250,
    unitToken: "g",
    name: "rice",
    preparation: "",
  });
  const oil = splitIngredientLine("- 2 Tbsp olive oil, extra virgin");
  assert.equal(oil.original, "2 Tbsp olive oil, extra virgin");
  assert.equal(oil.quantity, 2);
  assert.equal(oil.unitToken, "Tbsp");
  assert.equal(oil.name, "olive oil");
  assert.equal(oil.preparation, "extra virgin");
  assert.equal(splitIngredientLine("½ lemon").quantity, 0.5);
  assert.equal(splitIngredientLine("½ lemon").name, "lemon");
  assert.equal(splitIngredientLine("1 lbs beef").unitToken, "lbs");
  assert.equal(splitIngredientLine("3 eggs").unitToken, "");
  assert.equal(splitIngredientLine("3 eggs").name, "eggs");
  const salt = splitIngredientLine("Salt to taste");
  assert.equal(salt.quantity, null);
  assert.equal(salt.name, "Salt to taste");
  assert.equal(splitIngredientLine("1/0 cup nonsense").quantity, null);
});

test("shared conversions stay within a dimension and report ambiguity as null", () => {
  assert.deepEqual(convertUnits(1, "kg", "g"), { quantity: 1000, unit: "g" });
  assert.deepEqual(convertUnits(100, "C", "F"), { quantity: 212, unit: "F" });
  assert.deepEqual(convertUnits(250, "metric_cup", "mL"), {
    quantity: 62500,
    unit: "mL",
  });
  assert.equal(convertUnits(1, "cup", "mL"), null);
  assert.equal(convertUnits(1, "mL", "g"), null);
  assert.deepEqual(canonicalQuantity(0.5, "kg"), { quantity: 500, unit: "g" });
  assert.deepEqual(canonicalQuantity(null, "Cup"), {
    quantity: null,
    unit: "cup",
  });
  assert.equal(unitInfo("Litres").unit, "mL");
  assert.equal(unitInfo("cup"), null);
});

test("shared link lines accept an address with an optional title in either order", () => {
  const parsed = parseLinkLines(
    "https://youtu.be/dQw4w9WgXcQ Grandma folds them\nThe written version example.com/orzo\nyoutu.be/dQw4w9WgXcQ\n\nnot a link at all\nmailto:cook@example.com hello\nftp://files.example.com/x",
  );
  assert.deepEqual(parsed.links, [
    { url: "https://youtu.be/dQw4w9WgXcQ", title: "Grandma folds them" },
    { url: "https://example.com/orzo", title: "The written version" },
    { url: "https://youtu.be/dQw4w9WgXcQ", title: "" },
  ]);
  assert.deepEqual(parsed.invalid, [
    "not a link at all",
    "mailto:cook@example.com hello",
    "ftp://files.example.com/x",
  ]);
  assert.equal(
    formatLinkLines(parsed.links),
    "https://youtu.be/dQw4w9WgXcQ Grandma folds them\nhttps://example.com/orzo The written version\nhttps://youtu.be/dQw4w9WgXcQ",
  );
  assert.equal(
    formatLinkLines([{ url: "https://a.example", title: " a\nb " }]),
    "https://a.example a b",
  );
  assert.deepEqual(parseLinkLines(""), { links: [], invalid: [] });
  assert.equal(isWebUrl("javascript:alert(1)"), false);
  assert.equal(isWebUrl("https://example.com"), true);
});

test("shared link descriptions recognise video players and leave other sites as plain links", () => {
  const player = (url) => describeLink(url)?.embed ?? null;
  assert.deepEqual(
    player("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s"),
    {
      src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=65",
      autoplay_src:
        "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=65&autoplay=1",
      shape: "wide",
    },
  );
  assert.equal(
    player("https://youtu.be/dQw4w9WgXcQ?t=90").src,
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90",
  );
  assert.equal(
    player("https://m.youtube.com/shorts/dQw4w9WgXcQ").shape,
    "tall",
  );
  assert.equal(
    player("https://www.youtube.com/playlist?list=PL12ab_-").src,
    "https://www.youtube-nocookie.com/embed/videoseries?list=PL12ab_-",
  );
  assert.equal(player("https://www.youtube.com/@somechannel"), null);
  assert.equal(player("https://youtu.be/tooshort"), null);
  assert.equal(
    player("https://vimeo.com/channels/staffpicks/76979871").src,
    "https://player.vimeo.com/video/76979871",
  );
  assert.equal(
    player("https://vimeo.com/76979871/abcdef1234").src,
    "https://player.vimeo.com/video/76979871?h=abcdef1234",
  );
  assert.equal(player("https://vimeo.com/groups/123"), null);
  assert.equal(
    player("https://www.facebook.com/somepage/videos/10153231379946729/").src,
    "https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Fsomepage%2Fvideos%2F10153231379946729&show_text=false",
  );
  assert.equal(
    player("https://m.facebook.com/watch/?v=10153231379946729").src,
    "https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Fwatch%3Fv%3D10153231379946729&show_text=false",
  );
  assert.equal(
    player("https://www.facebook.com/reel/1234567890").shape,
    "tall",
  );
  assert.equal(player("https://www.facebook.com/somepage/posts/123"), null);
  assert.equal(player("https://fb.watch/abc123/"), null);
  assert.deepEqual(player("https://www.instagram.com/p/C1abcdefg/"), {
    src: "https://www.instagram.com/p/C1abcdefg/embed/",
    autoplay_src: "https://www.instagram.com/p/C1abcdefg/embed/",
    shape: "post",
  });
  assert.equal(
    player("https://www.instagram.com/cook/reel/C1abcdefg/?igsh=x").src,
    "https://www.instagram.com/reel/C1abcdefg/embed/",
  );
  assert.equal(player("https://www.instagram.com/reels/"), null);
  assert.deepEqual(
    player("https://www.tiktok.com/@cook/video/7234567890123456789"),
    {
      src: "https://www.tiktok.com/embed/v2/7234567890123456789",
      autoplay_src: "https://www.tiktok.com/embed/v2/7234567890123456789",
      shape: "portrait",
    },
  );
  assert.equal(player("https://vm.tiktok.com/ZMabc/"), null);
  assert.deepEqual(describeLink("https://www.example.com/recipe"), {
    url: "https://www.example.com/recipe",
    site: "example.com",
    provider: null,
    label: "example.com",
    embed: null,
  });
  assert.equal(describeLink("https://youtu.be/dQw4w9WgXcQ").label, "YouTube");
  assert.equal(describeLink("javascript:alert(1)"), null);
  for (const url of [
    "https://youtu.be/dQw4w9WgXcQ",
    "https://vimeo.com/76979871",
    "https://www.facebook.com/reel/1234567890",
    "https://www.instagram.com/p/C1abcdefg/",
    "https://www.tiktok.com/@cook/video/7234567890123456789",
  ])
    assert.ok(
      embedOrigins.includes(new URL(player(url).autoplay_src).origin),
      `${url} embeds from an allowed origin`,
    );
});

test("shared display links put a video source first and never repeat it", () => {
  const links = [{ url: "https://example.com/orzo", title: "Written" }];
  assert.deepEqual(
    displayLinks({ source_url: "https://youtu.be/dQw4w9WgXcQ", links }),
    [
      { url: "https://youtu.be/dQw4w9WgXcQ", title: "Original source" },
      ...links,
    ],
  );
  assert.deepEqual(
    displayLinks({ source_url: "https://example.com/page", links }),
    links,
  );
  assert.deepEqual(
    displayLinks({
      source_url: "https://youtu.be/dQw4w9WgXcQ",
      links: [{ url: "https://youtu.be/dQw4w9WgXcQ", title: "Mine" }],
    }),
    [{ url: "https://youtu.be/dQw4w9WgXcQ", title: "Mine" }],
  );
  assert.deepEqual(displayLinks({}), []);
  assert.deepEqual(displayLinks({ links: undefined }), []);
});

test("shared taxonomy dedupes labels, matches facets case-insensitively and counts the vocabulary", () => {
  assert.deepEqual(parseLabels(" Weeknight, weeknight ,, Shabbat "), [
    "Weeknight",
    "Shabbat",
  ]);
  assert.deepEqual(parseLabels(""), []);
  assert.equal(formatLabels(["Weeknight", "Shabbat"]), "Weeknight, Shabbat");
  assert.equal(courseKeys.includes("main") && dietKeys.includes("vegan"), true);
  const orzo = {
    course: "main",
    cuisine: "Italian",
    diets: ["vegan", "gluten_free"],
    tags: ["Weeknight", "One pot"],
  };
  assert.equal(
    matchesFacets(orzo, {
      course: "main",
      cuisine: "italian",
      diets: ["vegan"],
      tags: ["one POT"],
    }),
    true,
  );
  assert.equal(matchesFacets(orzo, { diets: ["vegan", "nut_free"] }), false);
  assert.equal(matchesFacets(orzo, { tags: ["Weeknight", "Soup"] }), false);
  assert.equal(matchesFacets(orzo, { cuisine: "Thai" }), false);
  // Unknown stays unknown: a missing course or cuisine never matches.
  assert.equal(matchesFacets({ tags: [] }, { course: "main" }), false);
  assert.equal(matchesFacets({ cuisine: "" }, { cuisine: "Thai" }), false);
  assert.equal(matchesFacets({}, { diets: [], tags: [] }), true);
  assert.equal(hasFacetFilters({ diets: [], tags: [] }), false);
  assert.equal(hasFacetFilters({ cuisine: "Thai" }), true);
  assert.equal(
    facetText(orzo),
    "Main Italian Vegan Gluten-free Weeknight One pot",
  );
  const counts = taxonomy([
    orzo,
    { course: "main", cuisine: "italian", tags: ["weeknight"] },
    { cuisine: "ITALIAN", diets: ["vegan"], tags: ["Weeknight", "Soup"] },
    { course: null, cuisine: "", diets: [], tags: [] },
  ]);
  assert.deepEqual(counts.courses, [{ key: "main", label: "Main", count: 2 }]);
  assert.deepEqual(counts.cuisines, [{ name: "Italian", count: 3 }]);
  assert.deepEqual(counts.diets, [
    { key: "vegan", label: "Vegan", count: 2 },
    { key: "gluten_free", label: "Gluten-free", count: 1 },
  ]);
  assert.deepEqual(counts.tags, [
    { name: "Weeknight", count: 3 },
    { name: "One pot", count: 1 },
    { name: "Soup", count: 1 },
  ]);
  assert.deepEqual(
    taxonomy([{ tags: ["shabbat"] }, { tags: ["Shabbat"] }]).tags,
    [{ name: "Shabbat", count: 2 }],
  );
  assert.deepEqual(taxonomy([]).courses, []);
});
