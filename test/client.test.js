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
