import { normalize } from "../../../shared/quantities.js";

// Where things are in a shop, in the order a walk through one usually meets
// them. A grocery's own category wins; most are "Other", so the name decides.
export const AISLES = [
  "Fruit and vegetables",
  "Bakery",
  "Meat and fish",
  "Dairy and eggs",
  "Pantry",
  "Spices",
  "Frozen",
  "Drinks",
  "Household",
  "Other",
];

const NAMES = {
  "Fruit and vegetables":
    "apple, banana, lemon, lemon juice, lime, lime juice, orange, grapefruit, onion, red onion, spring onion, green onion, scallion, shallot, leek, garlic, ginger, tomato, cherry tomato, potato, sweet potato, carrot, celery, bell pepper, red pepper, green pepper, yellow pepper, chili, chilli, jalapeno, cucumber, lettuce, spinach, kale, arugula, rocket, chard, parsley, cilantro, coriander leaf, fresh coriander, basil, mint, dill, thyme, rosemary, sage, chive, avocado, zucchini, courgette, eggplant, aubergine, mushroom, cabbage, broccoli, cauliflower, beet, beetroot, radish, corn, green bean, asparagus, fennel, squash, pumpkin, berry, strawberry, blueberry, raspberry, grape, pear, peach, plum, apricot, mango, pineapple, melon, watermelon, pomegranate, date, fig, kiwi, herb, salad leaf, sprout",
  Bakery:
    "bread, pita, tortilla, bun, roll, baguette, challah, sourdough, croissant, bagel, wrap",
  "Meat and fish":
    "chicken, beef, steak, ground beef, mince, lamb, pork, turkey, sausage, bacon, ham, fish, salmon, cod, tilapia, sea bass, trout, shrimp, prawn, mussel, squid",
  "Dairy and eggs":
    "milk, butter, cheese, parmesan, feta, mozzarella, ricotta, halloumi, cheddar, cream, cream cheese, sour cream, heavy cream, yogurt, yoghurt, labneh, egg",
  Pantry:
    "rice, pasta, spaghetti, penne, orzo, noodle, couscous, bulgur, quinoa, oat, flour, sugar, oil, olive oil, vinegar, lentil, chickpea, bean, black bean, kidney bean, tomato paste, canned tomato, crushed tomato, tomato sauce, stock, broth, honey, maple syrup, tahini, peanut butter, almond, walnut, pecan, cashew, pine nut, pistachio, sesame seed, raisin, soy sauce, mustard, ketchup, mayonnaise, jam, cocoa, chocolate, yeast, baking powder, baking soda, breadcrumb, cornstarch, coconut milk, tuna",
  Spices:
    "salt, pepper, black pepper, pepper flake, chili flake, chili powder, cumin, paprika, turmeric, cinnamon, oregano, za'atar, zaatar, sumac, cardamom, nutmeg, bay leaf, vanilla, curry powder, garam masala, allspice, cayenne, ground coriander, coriander seed",
  Frozen: "frozen, ice cream, pea",
  Drinks: "coffee, tea, juice, wine, beer, sparkling water, soda",
  Household:
    "paper towel, toilet paper, soap, dish soap, detergent, foil, baking paper, parchment, bag, sponge, napkin",
};

// "Tomatoes" is "tomato", "berries" is "berry", "leaves" is "leaf". The
// dictionary is read the same way, so an odd singular still matches.
const IRREGULAR = { leaves: "leaf", loaves: "loaf", halves: "half" };
const singular = (word) =>
  IRREGULAR[word] ??
  (word.endsWith("ies")
    ? `${word.slice(0, -3)}y`
    : word.endsWith("oes")
      ? word.slice(0, -2)
      : word.endsWith("s") && !word.endsWith("ss")
        ? word.slice(0, -1)
        : word);
const words = (text) =>
  normalize(text)
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .split(" ")
    .filter(Boolean)
    .map(singular);

// One spelling for a grocery's name, so "Lemons" at home is the "lemon" a
// recipe asks for.
export const nameKey = (name) => words(name).join(" ");

const KNOWN = new Map(
  Object.entries(NAMES).flatMap(([aisle, list]) =>
    list.split(", ").map((name) => [words(name).join(" "), aisle]),
  ),
);

export function aisleOf({ name = "", category = "" } = {}) {
  if (AISLES.includes(category) && category !== "Other") return category;
  const said = words(name);
  // The last thing named decides, two words before one: "red pepper flakes"
  // is pepper flakes, "chicken stock" is stock, "cherry tomatoes" tomatoes.
  for (let end = said.length; end > 0; end--) {
    const pair = end > 1 && KNOWN.get(said.slice(end - 2, end).join(" "));
    if (pair) return pair;
    const one = KNOWN.get(said[end - 1]);
    if (one) return one;
  }
  return "Other";
}
