import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalQuantity,
  convertUnits,
  unitInfo,
  unitLabel,
  unitSpelling,
} from "../shared/quantities.js";
import {
  editedIngredients,
  editedSteps,
  ingredientLine,
  parseQuantity,
  splitIngredientLine,
  stepsText,
} from "../shared/ingredients.js";
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
  const sugar = splitIngredientLine("2 tbsp. sugar");
  assert.equal(sugar.unitToken, "tbsp.");
  assert.equal(sugar.name, "sugar");
  assert.equal(splitIngredientLine("1 lb. beef").name, "beef");
  for (const [line, unit, name] of [
    ["1 bunch parsley", "bunch", "parsley"],
    ["2 bunches parsley", "bunches", "parsley"],
    ["1 pinch salt", "pinch", "salt"],
    ["3 sprigs thyme", "sprigs", "thyme"],
    ["2 sticks butter", "sticks", "butter"],
    ["4 slices bread", "slices", "bread"],
    ["1 head garlic", "head", "garlic"],
    ["2 stalks celery", "stalks", "celery"],
    ["1 tin tomatoes", "tin", "tomatoes"],
    ["1 jar tahini", "jar", "tahini"],
  ]) {
    const parts = splitIngredientLine(line);
    assert.equal(parts.unitToken, unit, line);
    assert.equal(parts.name, name, line);
  }
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

test("shared unit words keep one spelling, so plurals and abbreviations compare as one unit", () => {
  assert.equal(unitSpelling("Cans"), "can");
  assert.equal(unitSpelling("cloves"), "clove");
  assert.equal(unitSpelling("Tablespoons"), "tbsp");
  assert.equal(unitSpelling("tbsp."), "tbsp");
  assert.equal(unitSpelling("bunches"), "bunch");
  assert.equal(unitSpelling("mL"), "ml");
  assert.equal(unitSpelling(""), "");
  assert.deepEqual(canonicalQuantity(2, "cans"), { quantity: 2, unit: "can" });
  assert.deepEqual(canonicalQuantity(1, "Cups"), { quantity: 1, unit: "cup" });
  assert.deepEqual(canonicalQuantity(3, "teaspoons"), {
    quantity: 3,
    unit: "tsp",
  });
  assert.deepEqual(canonicalQuantity(1, "lb."), {
    quantity: 453.59237,
    unit: "g",
  });
  assert.equal(unitInfo("oz.").unit, "g");
  // A bare cup or spoon still has no size.
  assert.equal(unitInfo("cups"), null);
  assert.equal(convertUnits(1, "cups", "mL"), null);
});

test("shared unit labels read in the plural only above one", () => {
  assert.equal(unitLabel("cup", 1), "cup");
  assert.equal(unitLabel("cup", 0.5), "cup");
  assert.equal(unitLabel("cup", 2), "cups");
  assert.equal(unitLabel("cans", 1), "can");
  assert.equal(unitLabel("can", 1.5), "cans");
  assert.equal(unitLabel("bunch", 3), "bunches");
  assert.equal(unitLabel("tbsp", 2), "tbsp");
  assert.equal(unitLabel("g", 200), "g");
  assert.equal(unitLabel("mL", 30), "mL");
  assert.equal(unitLabel("us_cup", 2), "us_cup");
  assert.equal(unitLabel("", 3), "");
});

test("editor lines left as shown keep their stored ingredient exactly", () => {
  const original = [
    {
      name: "salt",
      quantity: 1,
      unit: "pinch of",
      preparation: "",
      category: "Pantry",
      original_text: "a pinch of salt",
    },
    {
      name: "Pepper",
      quantity: null,
      unit: "",
      preparation: "to taste",
      category: "Pantry",
      original_text: "Pepper, to taste",
    },
    {
      name: "onion",
      quantity: 1,
      unit: "",
      preparation: "diced",
      category: "Produce",
      original_text: "1 onion, finely diced",
    },
    {
      name: "milk",
      quantity: 1,
      unit: "us_cup",
      preparation: "",
      category: "Dairy",
      original_text: "1 cup milk",
    },
  ];
  const text = original.map(ingredientLine).join("\n");
  assert.equal(
    text,
    "1 pinch of salt\nPepper, to taste\n1 onion, diced\n1 us_cup milk",
  );
  assert.deepEqual(editedIngredients(text, original), original);
  // Reordered and with stray spaces, every line still finds its ingredient.
  assert.deepEqual(
    editedIngredients(
      `  1 us_cup   milk\n${text}`.split("\n").slice(0, 4).join("\n"),
      original,
    ),
    [original[3], original[0], original[1], original[2]],
  );
});

test("edited editor lines are parsed again and keep the category they replaced", () => {
  const original = [
    {
      name: "onion",
      quantity: 1,
      unit: "",
      preparation: "diced",
      category: "Produce",
      original_text: "1 onion, diced",
    },
    {
      name: "flour",
      quantity: 2,
      unit: "cup",
      preparation: "",
      category: "Baking",
      original_text: "2 cups flour",
    },
    {
      name: "eggs",
      quantity: 2,
      unit: "",
      preparation: "",
      category: "Dairy",
      original_text: "2 eggs",
    },
  ];
  const [onion, flour, eggs, extra] = editedIngredients(
    "1 onion, sliced\n2 cups bread flour\n3 eggs\n1 bunch parsley",
    original,
  );
  // Same name, new preparation: the category and source wording follow.
  assert.equal(onion.preparation, "sliced");
  assert.equal(onion.category, "Produce");
  assert.equal(onion.original_text, "1 onion, diced");
  // Renamed in place: the category of the line it replaced.
  assert.equal(flour.name, "bread flour");
  assert.equal(flour.unit, "cup");
  assert.equal(flour.category, "Baking");
  assert.equal(eggs.quantity, 3);
  assert.equal(eggs.category, "Dairy");
  // A new line is parsed like a pasted one and has no category yet.
  assert.equal(extra.name, "parsley");
  assert.equal(extra.unit, "bunch");
  assert.equal(extra.category, undefined);
});

test("editor steps keep their timers and never split at a blank line inside them", () => {
  const original = [
    { text: "Mix.\n\nThen rest.", duration_seconds: 600, equipment_names: [] },
    { text: "Bake.", duration_seconds: 1200, equipment_names: ["Oven"] },
  ];
  const text = stepsText(original);
  assert.equal(text, "Mix.\nThen rest.\n\nBake.");
  assert.deepEqual(editedSteps(text, original), original);
  assert.deepEqual(
    editedSteps("Bake.\n\nMix.\nThen rest.\n\nServe.", original),
    [original[1], original[0], { text: "Serve." }],
  );
  assert.deepEqual(editedSteps("", original), []);
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
