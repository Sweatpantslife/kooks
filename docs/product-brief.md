# Kooks: Phase 1 product brief

> Historical design/research record (September 2026), with personal discovery context removed. [Current implementation and handoff](handoff.md) takes precedence: Capacitor iOS/Android, persistent browser/MCP storage, backups, history, and eight household features now exist. Earlier phase labels and deferrals are not current completion status. Provider/platform research should be rechecked before implementation.

Status: historical experience proposal. Current implementation and open questions are recorded in the handoff.

## The job

Turn pasted or manually entered recipes into a cookbook that is easy to search, edit, adjust, combine into meals, shop from, and follow while cooking. Include required tools and an assistant that uses the user's AI access. Prioritize phone use, with a roomy desktop editor.

## Experience proposal

The home screen is the recipe library. Search and Add recipe stay prominent. Favorites and simple filters help retrieval without elaborate organization. Recipes, Meals, Shop, Plan, and Assistant form the proposed phone navigation; desktop uses a sidebar. Validate whether five destinations feel clear in daily use.

Opening a recipe reveals its source, servings, ingredients, required tools, method, and notes. Serving and measurement controls belong beside the ingredients. Starting cooking uses those quantities. A composed meal has a name, selected recipes, dish roles, and independent portions. Its equipment overview shows shared tools and which dishes require them.

Adding a recipe or meal to shopping includes a review for excluding items already available. Contributions make shared ingredients traceable. Editing a meal does not silently change an existing shopping selection or scheduled portions. Weekly placement is optional, with each occurrence counted separately.

Meal cooking has a selector for its dishes, independent step positions, and timers labeled with the dish. Leaving and resuming retains the current session. A later implementation phase will add a preparation sequence that accounts for timing, dependencies, and equipment capacity; the current preview only demonstrates progress/timers and a simple oven-temperature conflict.

The Assistant area demonstrates a proposal that creates a meal, an undo, shopping review, and required-tool lookup. “BYK” means bring your own key, not the assistant's name. The proposal includes OpenAI and Claude account sign-in. The preview shows both as disconnected; [connection research](ai-connections.md) records the provider-specific limitations and unresolved fallback decision.

## First design direction

Explore a calm, editorial cookbook: warm neutral surfaces, restrained olive accents, readable serif recipe titles, and clear sans-serif controls. Recipe cards work without photographs so copied family recipes feel complete immediately. Offer a second palette and a denser library layout for comparison. This is a proposal, not a settled brand.

Primary phone controls should provide generous touch targets. Desktop should show ingredients beside the method or editor. Ingredient checkboxes must not be confused with shopping selection; cooking progress is independent of bought status.

## Prototype scope

The interactive concept uses illustrative recipes and demonstrates search, favorites, serving changes, metric/US kitchen display, ingredient review, shopping check-offs, recipe/meal placement, paste/manual editing including tools, composing/editing meals, per-dish portions, combined equipment, and cooking with resumable progress across dishes. An assistant proposal uses preset sample requests and local actions. Any countdown is a foreground interaction demonstration.

It does not provision accounts, connect AI providers, perform AI inference, synchronize households, connect to WhatsApp, extract websites, optimize a cooking schedule, allocate multi-day batches, or establish background/locked-screen alarm reliability. Original source text is retained. Sample recipes are design fixtures.

English and metric values are temporary demonstration defaults pending the user's language and unit choices. US kitchen display uses a stated 240 mL cup convention for volume; mass converts to ounces rather than guessing a cup-to-gram density. These defaults do not settle the production conversion policy.

## Decisions needed before implementation

1. Actual phone platforms and required alarm behavior.
2. Dominant input formats in the WhatsApp archive.
3. Interface/recipe languages, unit conventions, and important conversions.
4. Feedback on visual direction, recipe density, and cooking layout.
5. Which offline actions are essential and how household access should work.
6. Whether separately billed API keys are acceptable if a provider cannot support account sign-in; final connection architecture after feasibility review.
7. Assistant autonomy and whether meal prep should also include multi-day batch cooking.

These questions guided the original prototype; Capacitor has since been selected for both mobile platforms. A familiar recipe supplied by the user is needed to validate the flow beyond illustrative data.

## Review tasks

Find a recipe by an ingredient. Change its servings from four to six and inspect the quantities. Compare unit displays. Exclude a staple when adding ingredients to Shop, then check off an item. Put a recipe in the weekly plan. Enter cooking mode, advance a step, leave, and resume. Finally, paste a short recipe and review the resulting editable draft.

Open Meals and inspect Lemon orzo dinner. Increase only the main dish's portions, review the combined shopping list, and inspect shared equipment. Cook the meal, change dishes, and resume a previous step. Create a pasta-and-potatoes meal to see its two oven temperatures. In Assistant, try the sample dinner proposal, apply it, then undo it. These tasks test the experience, not model quality.

Record friction from those tasks before moving into Phase 2. A useful prototype is an input to the platform and product decisions, not evidence that production reliability has been established.
