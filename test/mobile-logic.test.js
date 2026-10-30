import test from "node:test";
import assert from "node:assert/strict";
import {
  amount,
  clockText,
  formatNumber,
  originalText,
  scaledText,
  timeLeft,
} from "../app/units.js";
import { editDraft, parseIngredient, pasteDraft } from "../app/parsing.js";
import {
  applyShoppingReview,
  buildReview,
  listItems,
} from "../app/shopping.js";
import { equipmentSummary } from "../app/equipment.js";
import { recipes } from "../app/sample-data.js";

const known = recipes.flatMap((r) => r.ingredients);

test("mobile ingredient lines keep the pasted wording and apply the stated volume convention", () => {
  const oil = parseIngredient("2 tbsp olive oil", known);
  assert.equal(oil.q, 30);
  assert.equal(oil.u, "ml");
  assert.equal(oil.k, "olive-oil");
  assert.equal(oil.group, "Pantry");
  assert.deepEqual(oil.original, { q: 2, u: "tbsp" });
  assert.equal(oil.raw, "2 tbsp olive oil");
  const flour = parseIngredient("1½ cups flour, sifted", known);
  assert.equal(flour.q, 360);
  assert.equal(flour.n, "flour");
  assert.equal(flour.note, "sifted");
  assert.equal(parseIngredient("1,5 kg potatoes").q, 1500);
  assert.equal(parseIngredient("1,5 kg potatoes").u, "g");
  assert.equal(parseIngredient("4 oz cheese").u, "g");
  assert.ok(Math.abs(parseIngredient("4 oz cheese").q - 113.4) < 0.01);
  const eggs = parseIngredient("3 eggs");
  assert.equal(eggs.q, 3);
  assert.equal(eggs.u, "");
  assert.deepEqual(eggs.original, { q: 3, u: "" });
  assert.equal(parseIngredient("2 cloves garlic").u, "clove");
  assert.equal(parseIngredient("2 bunches parsley").u, "bunch");
  assert.equal(parseIngredient("2 bunches parsley").n, "parsley");
  assert.equal(parseIngredient("250 g. rice").u, "g");
  assert.equal(parseIngredient("2 tbsp. sugar").q, 30);
  assert.deepEqual(parseIngredient("2 tbsp. sugar").original, {
    q: 2,
    u: "tbsp.",
  });
  const salt = parseIngredient("Salt to taste");
  assert.equal(salt.q, null);
  assert.equal(salt.note, "As written");
  assert.equal(salt.k, "text-salt to taste");
  assert.equal(parseIngredient("1/0 cup nonsense").q, null);
  assert.equal(parseIngredient("- 250 g orzo", known).k, "orzo");
});

test("mobile paste drafts split headed and unheaded recipes the same way", () => {
  const headed = pasteDraft(
    "Family rice\nServes 2\n\nIngredients\n100 g rice\n200 ml water\n\nMethod\n1. Rinse the rice.\n2. Simmer gently.",
  );
  assert.equal(headed.title, "Family rice");
  assert.equal(headed.servings, 2);
  assert.equal(headed.ingredientsText, "100 g rice\n200 ml water");
  assert.equal(headed.stepsText, "Rinse the rice.\n\nSimmer gently.");
  assert.equal(headed.originalText.startsWith("Family rice"), true);
  const loose = pasteDraft(
    "Toast\nServes 1\n2 slices bread\n½ avocado\nToast the bread.\n1) Mash the avocado.",
  );
  assert.equal(loose.servings, 1);
  assert.equal(loose.ingredientsText, "2 slices bread\n½ avocado");
  assert.equal(loose.stepsText, "Toast the bread.\n\nMash the avocado.");
});

test("mobile edit drafts reproduce pasted lines and format parsed ones", () => {
  const recipe = {
    id: "r",
    title: "Rice",
    servings: 2,
    ingredients: [
      parseIngredient("100 g rice"),
      { k: "salt", n: "Salt", q: null, u: "", note: "to taste" },
      { k: "oil", n: "Oil", q: 1.5, u: "", note: "light", original: null },
    ],
    steps: [{ text: "Rinse." }, { text: "Simmer." }],
    equipment: ["Pan"],
  };
  const draft = editDraft(recipe);
  assert.equal(draft.ingredientsText, "100 g rice\nSalt\n1½ Oil, light");
  assert.equal(draft.stepsText, "Rinse.\n\nSimmer.");
  assert.equal(draft.equipmentText, "Pan");
  assert.equal(draft.linksText, "");
  assert.equal(
    editDraft({
      ...recipe,
      links: [
        { url: "https://youtu.be/dQw4w9WgXcQ", title: "The method" },
        { url: "https://example.com/rice", title: "" },
      ],
    }).linksText,
    "https://youtu.be/dQw4w9WgXcQ The method\nhttps://example.com/rice",
  );
  assert.equal(pasteDraft("Rice\nServes 2\n100 g rice").linksText, "");
  assert.match(draft.originalText, /Serves 2/);
  assert.match(originalText(recipe), /1\. Rinse\./);
});

test("mobile amounts format fractions, scale, convert for display and pluralize", () => {
  assert.equal(formatNumber(1.5), "1½");
  assert.equal(formatNumber(0.25), "¼");
  assert.equal(formatNumber(2), "2");
  assert.equal(formatNumber(1.333), "1.3");
  assert.equal(formatNumber(0), "0");
  const oil = { q: 30, u: "ml", original: { q: 2, u: "tbsp" } };
  assert.equal(amount(oil), "30 ml");
  assert.equal(amount(oil, 2), "60 ml");
  assert.equal(amount(oil, 1, "us"), "2 tbsp");
  assert.equal(amount(oil, 1, "original"), "2 tbsp");
  assert.equal(amount({ q: 1500, u: "g" }, 1, "metric"), "1½ kg");
  assert.equal(amount({ q: 1000, u: "ml" }, 1, "metric"), "1 L");
  assert.equal(amount({ q: 240, u: "ml" }, 1, "us"), "1 cup");
  assert.equal(amount({ q: 480, u: "ml" }, 1, "us"), "2 cups");
  assert.equal(amount({ q: 5, u: "ml" }, 1, "us"), "1 tsp");
  assert.equal(amount({ q: 2, u: "can" }), "2 cans");
  assert.equal(amount({ q: null, u: "", note: "to taste" }), "to taste");
  assert.equal(amount({ q: null, u: "" }), "As needed");
  assert.equal(scaledText("Bake at 200°C", "us"), "Bake at 392°F");
  assert.equal(scaledText("Bake at 200°C", "metric"), "Bake at 200°C");
});

test("mobile amounts choose the plural after rounding and use the shared cup size", () => {
  // A US cup is 236.6 mL and a metric cup 250 mL: both read as about one cup.
  assert.equal(amount({ q: 236.6, u: "ml" }, 1, "us"), "1 cup");
  assert.equal(amount({ q: 250, u: "ml" }, 1, "us"), "1 cup");
  assert.equal(amount({ q: 120, u: "ml" }, 1, "us"), "½ cup");
  assert.equal(amount({ q: 360, u: "ml" }, 1, "us"), "1½ cups");
  assert.equal(amount({ q: 0.5, u: "can" }), "½ can");
  assert.equal(amount({ q: 1, u: "clove" }), "1 clove");
  assert.equal(amount({ q: 3, u: "bunch" }), "3 bunches");
  assert.equal(
    amount({ q: 480, u: "ml", original: { q: 2, u: "cups" } }, 0.5, "original"),
    "1 cup",
  );
  assert.equal(
    amount({ q: 480, u: "ml", original: { q: 2, u: "cup" } }, 1, "original"),
    "2 cups",
  );
  // Parsing and display use the same sizes, so a pasted amount reads back.
  for (const line of ["1 cup milk", "2 tbsp oil", "1 tsp salt", "3 cups rice"])
    assert.equal(
      `${amount(parseIngredient(line), 1, "us")} ${parseIngredient(line).n}`,
      line,
    );
});

test("mobile parsing converts every mass and volume in the shared unit table", () => {
  const beef = parseIngredient("2 lbs beef");
  assert.equal(beef.u, "g");
  assert.ok(Math.abs(beef.q - 907.18474) < 1e-9);
  assert.deepEqual(beef.original, { q: 2, u: "lbs" });
  assert.equal(parseIngredient("1 pound beef").u, "g");
  assert.equal(parseIngredient("500 mg saffron").q, 0.5);
  const milk = parseIngredient("1 us_cup milk");
  assert.equal(milk.u, "ml");
  assert.ok(Math.abs(milk.q - 236.5882365) < 1e-9);
  assert.equal(parseIngredient("1 metric_cup milk").q, 250);
  assert.equal(parseIngredient("1.1 l stock").q, 1100);
  assert.equal(parseIngredient("2 pieces ginger").u, "piece");
  assert.equal(parseIngredient("3 each lemons").u, "each");
});

test("mobile temperatures convert with spaces, decimals and ranges", () => {
  assert.equal(scaledText("Bake at 180 °C.", "us"), "Bake at 356°F.");
  assert.equal(scaledText("Bake at 180ºC.", "us"), "Bake at 356°F.");
  assert.equal(scaledText("Roast at 175.5°C", "us"), "Roast at 348°F");
  assert.equal(scaledText("Bake at 180–200 °C", "us"), "Bake at 356–392°F");
  assert.equal(
    scaledText("Bake at 180 to 200°C", "us"),
    "Bake at 356 to 392°F",
  );
  assert.equal(scaledText("Heat to 400°F", "us"), "Heat to 400°F");
  assert.equal(scaledText("Add 2 cups.", "us"), "Add 2 cups.");
});

test("mobile timer clocks respect pauses", () => {
  assert.equal(timeLeft({ pausedMs: 20000, endAt: 0 }, 5000), 20000);
  assert.equal(timeLeft({ pausedMs: null, endAt: 65000 }, 5000), 60000);
  assert.equal(timeLeft({ pausedMs: null, endAt: 1000 }, 5000), 0);
  assert.equal(clockText(61000), "1:01");
  assert.equal(clockText(0), "0:00");
});

test("mobile shopping merges matching ingredients and keeps checkmarks only for unchanged amounts", () => {
  const byId = (id) =>
    ({
      r: {
        id: "r",
        title: "Rice",
        servings: 4,
        ingredients: [
          { k: "oil", n: "Oil", q: 30, u: "ml", group: "Pantry", note: "" },
          { k: "salt", n: "Salt", q: null, u: "", group: "Pantry", note: "" },
        ],
      },
      s: {
        id: "s",
        title: "Salad",
        servings: null,
        ingredients: [
          { k: "oil", n: "Oil", q: 15, u: "ml", group: "Pantry", note: "" },
        ],
      },
    })[id];
  const review = (servings, excluded = []) => ({
    replaceGroup: null,
    entries: buildReview(
      [
        { source: "recipe:r", recipeId: "r", servings },
        { source: "recipe:s", recipeId: "s", servings: 1, context: "Side" },
      ],
      byId,
    ),
    excluded: new Set(excluded),
  });
  const first = review(8);
  assert.equal(first.entries[0].items[0].q, 60);
  assert.equal(first.entries[0].yieldKnown, true);
  assert.equal(first.entries[1].title, "Salad · Side");
  assert.equal(first.entries[1].yieldKnown, false);
  let state = { contributions: {}, manual: [], bought: {} };
  state = { ...state, ...applyShoppingReview(state, first) };
  let items = listItems(state);
  const oil = items.find((i) => i.k === "oil");
  assert.equal(oil.q, 75);
  assert.deepEqual(oil.sources, ["Rice", "Salad · Side"]);
  assert.equal(items.length, 2);
  state.bought = { [oil.key]: true };
  state = { ...state, ...applyShoppingReview(state, review(8)) };
  assert.deepEqual(state.bought, { [oil.key]: true });
  state = { ...state, ...applyShoppingReview(state, review(12)) };
  assert.equal(listItems(state).find((i) => i.k === "oil").q, 105);
  assert.deepEqual(state.bought, {});
  state = { ...state, ...applyShoppingReview(state, review(12, ["0-1"])) };
  assert.equal(
    listItems(state).some((i) => i.k === "salt"),
    false,
  );
  state.manual = [
    { key: "manual-1", n: "Coffee", q: null, u: "", manual: true },
  ];
  items = listItems(state);
  assert.deepEqual(items.find((i) => i.key === "manual-1").sources, [
    "Added by you",
  ]);
  state.contributions["meal:m:d1"] = {
    title: "Dinner",
    items: [{ k: "oil", n: "Oil", q: 10, u: "ml", group: "Pantry", note: "" }],
  };
  state = {
    ...state,
    ...applyShoppingReview(state, { ...review(12), replaceGroup: "meal:m" }),
  };
  assert.equal("meal:m:d1" in state.contributions, false);
});

test("mobile equipment summary flags shared tools, unknown tools and oven temperature conflicts", () => {
  const byId = (id) =>
    ({
      a: {
        title: "Roast",
        equipment: ["Oven", "Tray"],
        steps: [{ text: "Roast at 200°C." }],
      },
      b: {
        title: "Gratin",
        equipment: ["oven "],
        steps: [{ text: "Bake at 220°C then 180°C." }],
      },
      c: { title: "Salad", equipment: [], steps: [{ text: "Toss." }] },
    })[id];
  const summary = equipmentSummary(
    [{ recipeId: "a" }, { recipeId: "b" }, { recipeId: "c" }],
    byId,
  );
  assert.deepEqual(
    summary.rows.map((row) => [row.name, row.uses]),
    [
      ["Oven", ["Roast", "Gratin"]],
      ["Tray", ["Roast"]],
    ],
  );
  assert.deepEqual(summary.unknown, ["Salad"]);
  assert.equal(summary.conflict, true);
  assert.deepEqual(
    summary.ovens.map((o) => o.temps),
    [[200], [220, 180]],
  );
  const spaced = (text) => ({
    title: "Bread",
    equipment: ["Oven"],
    steps: [{ text }],
  });
  assert.deepEqual(
    equipmentSummary([{ snapshot: spaced("Bake at 175.5 °C.") }], byId).ovens[0]
      .temps,
    [175.5],
  );
  assert.equal(
    equipmentSummary(
      [{ snapshot: spaced("Bake at 180 °C.") }, { recipeId: "a" }],
      byId,
    ).conflict,
    true,
  );
  assert.equal(
    equipmentSummary([{ snapshot: byId("a") }], byId).conflict,
    false,
  );
});

test("mobile drafts carry course, cuisine, diet labels and tags", () => {
  const pasted = pasteDraft("Rice\nIngredients\n100 g rice\nMethod\nCook.");
  assert.equal(pasted.course, null);
  assert.equal(pasted.cuisine, "");
  assert.deepEqual(pasted.diets, []);
  assert.equal(pasted.tagsText, "");
  const draft = editDraft(recipes[0]);
  assert.equal(draft.course, "main");
  assert.equal(draft.cuisine, "Mediterranean");
  assert.deepEqual(draft.diets, ["vegan"]);
  assert.equal(draft.tagsText, "Weeknight, One pot");
  const bare = editDraft({
    ...recipes[0],
    course: undefined,
    cuisine: undefined,
    diets: undefined,
    tags: undefined,
  });
  assert.equal(bare.course, null);
  assert.equal(bare.cuisine, "");
  assert.deepEqual(bare.diets, []);
  assert.equal(bare.tagsText, "");
});
