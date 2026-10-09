import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalQuantity,
  convertUnits,
  unitInfo,
} from "../shared/quantities.js";
import { parseQuantity, splitIngredientLine } from "../shared/ingredients.js";

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
