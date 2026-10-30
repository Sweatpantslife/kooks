import test from "node:test";
import assert from "node:assert/strict";
import { applyChanges } from "../client/src/lib/store.js";
import { monday, addDays, localDay } from "../client/src/lib/format.js";

const r = (id, title) => ({ id, data: { title } });

test("the redesigned app merges changed records in the server's id order and drops archived ones", () => {
  const before = {
    recipe: [r("a", "Dal"), r("c", "Pho")],
    meal: [r("m", "Sunday")],
  };
  const after = applyChanges(before, [
    { kind: "recipe", id: "b", record: r("b", "Bao") },
    { kind: "recipe", id: "c", record: r("c", "Pho ga") },
    { kind: "recipe", id: "z", record: r("z", "Ziti") },
    { kind: "meal", id: "m", record: null },
    { kind: "pantry", id: "p", record: r("p", "Rice") },
  ]);
  assert.deepEqual(
    after.recipe.map((x) => `${x.id}:${x.data.title}`),
    ["a:Dal", "b:Bao", "c:Pho ga", "z:Ziti"],
  );
  assert.deepEqual(after.meal, []);
  assert.deepEqual(after.pantry, [r("p", "Rice")]);
  // The tab's previous view is left as it was, so signals see a new value.
  assert.equal(before.recipe.length, 2);
  assert.equal(before.meal.length, 1);
});

test("the redesigned app's weeks start on Monday", () => {
  assert.equal(monday("2026-10-30"), "2026-10-26");
  assert.equal(monday("2026-10-26"), "2026-10-26");
  assert.equal(monday("2026-11-01"), "2026-10-26");
  assert.equal(addDays("2026-10-26", 6), "2026-11-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(localDay(new Date(2026, 2, 29, 23, 30)), "2026-03-29");
});

test("the redesigned app writes amounts the way a cook does", async () => {
  const { amount, minutes } = await import("../client/src/lib/kitchen.js");
  const i = (quantity, unit = "") => ({ quantity, unit });
  assert.equal(amount(i(0.5, "cup")), "½ cup");
  assert.equal(amount(i(0.5, "cup"), 1.25), "⅝ cup");
  assert.equal(amount(i(2, "tbsp"), 1.25), "2½ tbsp");
  assert.equal(amount(i(1, "cup"), 2), "2 cups");
  assert.equal(amount(i(1, "clove"), 3), "3 cloves");
  assert.equal(amount(i(1), 1 / 3), "⅓");
  // Grams and millilitres stay decimal, rounded to what a scale shows.
  assert.equal(amount(i(250, "g"), 1.25), "313 g");
  assert.equal(amount(i(7.5, "g")), "7.5 g");
  assert.equal(amount(i(0.25, "l")), "0.25 l");
  assert.equal(amount(i(0.3, "cup")), "0.3 cup");
  assert.equal(amount(i(null, "g")), "");
  assert.equal(minutes(25), "25 min");
  assert.equal(minutes(60), "1 hr");
  assert.equal(minutes(95), "1 hr 35 min");
});

test("groceries find their aisle by the last thing their name says", async () => {
  const { aisleOf } = await import("../client/src/lib/aisles.js");
  const cases = {
    "cherry tomatoes": "Fruit and vegetables",
    "canned tomatoes": "Pantry",
    "red pepper": "Fruit and vegetables",
    "red pepper flakes": "Spices",
    "black pepper": "Spices",
    "chicken breasts": "Meat and fish",
    "chicken stock": "Pantry",
    "peanut butter": "Pantry",
    butter: "Dairy and eggs",
    "egg yolks": "Dairy and eggs",
    "extra virgin olive oil": "Pantry",
    "frozen peas": "Frozen",
    chives: "Fruit and vegetables",
    "bay leaves": "Spices",
    "lemon juice": "Fruit and vegetables",
    coffee: "Drinks",
    "dish soap": "Household",
    "Sea Salt": "Spices",
    "something unusual": "Other",
  };
  for (const [name, aisle] of Object.entries(cases))
    assert.equal(aisleOf({ name }), aisle, name);
  // A grocery's own aisle wins over its name.
  assert.equal(aisleOf({ name: "tomatoes", category: "Pantry" }), "Pantry");
  assert.equal(
    aisleOf({ name: "tomatoes", category: "Other" }),
    "Fruit and vegetables",
  );
});

test("groceries read as a shop sells them and say what they are for", async () => {
  const { shopAmount, forWhat } =
    await import("../client/src/lib/groceries.js");
  const { nameKey } = await import("../client/src/lib/aisles.js");
  const row = (quantity, unit) => ({ quantity, unit });
  assert.equal(shopAmount(row(1500, "g")), "1.5 kg");
  assert.equal(shopAmount(row(250, "g")), "250 g");
  assert.equal(shopAmount(row(750, "mL")), "750 ml");
  assert.equal(shopAmount(row(2000, "mL")), "2 l");
  assert.equal(shopAmount(row(3, "each")), "3");
  assert.equal(shopAmount(row(2, "can")), "2 cans");
  assert.equal(shopAmount(row(null, "")), "");
  const c = (source_key, recipe_title) => ({ source_key, recipe_title });
  assert.equal(
    forWhat({
      contributions: [
        c("plan:1", "Dal"),
        c("manual", null),
        c("plan:2", "Dal"),
        c("recipe:3", "Pho"),
      ],
    }),
    "for Dal, Pho",
  );
  assert.equal(forWhat({ contributions: [c("manual", null)] }), "");
  // "Lemons" at home is the "lemon" a recipe asks for.
  assert.equal(nameKey("Lemons"), nameKey("lemon"));
  assert.equal(nameKey(" Bay  Leaves "), "bay leaf");
});

test("cooking timers read as a kitchen clock does", async () => {
  const { clock, minutesLabel, secondsLeft } =
    await import("../client/src/lib/cooking.js");
  assert.equal(clock(545), "9:05");
  assert.equal(clock(59), "0:59");
  assert.equal(clock(3720), "1:02:00");
  assert.equal(minutesLabel(600), "10 min");
  assert.equal(minutesLabel(20), "1 min");
  assert.equal(minutesLabel(3600), "1 hr");
  assert.equal(minutesLabel(5400), "1 hr 30 min");
  const deadline = new Date(Date.UTC(2026, 9, 30, 18, 0, 0)).toISOString();
  const at = Date.parse(deadline);
  assert.equal(secondsLeft({ deadline }, at - 1500), 2);
  assert.equal(secondsLeft({ deadline }, at + 5000), 0);
});

test("amounts read in the units this device chose, where the recipe's unit has a size", async () => {
  const { measure } = await import("../client/src/lib/kitchen.js");
  const { units } = await import("../client/src/lib/units.js");
  const i = (quantity, unit = "") => ({ quantity, unit });
  units.value = "us";
  assert.equal(measure(i(300, "g")), "10½ oz");
  assert.equal(measure(i(1, "kg")), "2¼ lb");
  assert.equal(measure(i(1, "l")), "4¼ cups");
  assert.equal(measure(i(15, "ml")), "1 tbsp");
  assert.equal(measure(i(5, "ml")), "1 tsp");
  assert.equal(measure(i(250, "g"), 2), "1 lb");
  // US amounts, counts and a cup of no stated size stay as written.
  assert.equal(measure(i(1, "lb")), "1 lb");
  assert.equal(measure(i(2, "cup")), "2 cups");
  assert.equal(measure(i(3, "clove")), "3 cloves");
  units.value = "metric";
  assert.equal(measure(i(1, "lb")), "455 g");
  assert.equal(measure(i(4, "oz")), "115 g");
  assert.equal(measure(i(2, "us_cup")), "475 ml");
  assert.equal(measure(i(3, "lb")), "1.35 kg");
  assert.equal(measure(i(300, "g")), "300 g");
  assert.equal(measure(i(1, "tbsp")), "1 tbsp");
  units.value = "written";
  assert.equal(measure(i(4, "oz")), "4 oz");
  assert.equal(measure(i(null, "g")), "");
});

test("a recipe says who at the table likes what's in it, and who doesn't", async () => {
  const { db } = await import("../client/src/lib/store.js");
  const { tastes } = await import("../client/src/lib/people.js");
  const person = (id, name, likes, dislikes, spice_tolerance = null) => ({
    id,
    data: { name, likes, dislikes, spice_tolerance },
  });
  db.value = {
    member: [
      person("b", "Ben", [], ["olives", "coriander"], 1),
      person("a", "Ada", ["chickpeas", "weeknight"], []),
    ],
  };
  const recipe = {
    ingredients: [
      { name: "Chickpea" },
      { name: "kalamata olives" },
      { name: "olive oil" },
    ],
    tags: ["Weeknight"],
    spice_level: 2,
  };
  assert.deepEqual(
    tastes(recipe).map((t) => [t.liked, t.text]),
    [
      [true, "Ada likes chickpeas"],
      [true, "Ada likes weeknight"],
      [false, "Ben doesn’t like olives"],
      [false, "Hotter than Ben likes"],
    ],
  );
  db.value = {};
});
