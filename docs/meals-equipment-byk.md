# Meals, equipment, and AI assistant

> Historical design/research record (September 2026), with personal discovery context removed. [Current implementation and handoff](handoff.md) takes precedence: Capacitor iOS/Android, persistent browser/MCP storage, backups, history, and eight household features now exist. Earlier phase labels and deferrals are not current completion status. Provider/platform research should be rechecked before implementation.

Updated September 19, 2026. This expands the approved direction for meals that combine recipes, required tools, and an AI agent across the product. The product proposal includes OpenAI and Claude account sign-in, subject to supported integration paths. These capabilities belong in the first-release scope; provider-specific authentication feasibility is an explicit gate. Detailed behavior below is proposed for Phase 1 review.

## A meal is a reusable combination of recipes

A saved meal might be “Lemon orzo dinner,” containing orzo as the main dish and chopped salad as a side. It has a name, optional notes, and dish components with their own portions. The same meal can be scheduled more than once without duplicating its recipe definitions. Cooking it today and again on Friday creates separate occurrences.

The interaction is: choose recipes → set portions for each dish → review ingredients and equipment → shop → prepare and cook the meal. A whole-meal serving control may adjust linked dish portions; the cook can override a dish, for example making six servings of the main and four of the salad. This distinction avoids assuming that a recipe's “serves four” is interchangeable between a main course and a side.

Meal composition does not require a calendar. Weekly placement is an optional layer. Multi-day batch cooking is awaiting clarification: if included, model the amount cooked separately from the portions allocated to future meals, so the same cooked batch is not purchased repeatedly. Storage, freezing, and reheating requirements must be designed from the user's routine and appropriate sources; generic shelf-life claims are outside this initial design.

### Shopping behavior

Each dish contributes ingredients at its selected yield. Merge only compatible identities, units, and preparation forms, and retain a trace back to the meal occurrence and dish. Equipment is displayed separately from groceries.

Example: four servings of the sample orzo use 30 mL oil and four servings of the salad use 15 mL, giving 45 mL. Increasing only the orzo to six servings changes the total to 60 mL. Removing the salad removes its 15 mL contribution. Repeating “update this meal's list” replaces that occurrence's contributions; intentionally shopping for a second occurrence adds another set.

Changes to a saved meal or recipe must show a diff before updating an already prepared list. Bought items and manual adjustments remain traceable. An active cooking session keeps its starting snapshot until the cook explicitly chooses to update it.

## Required equipment

Recipes need a visible, editable tools section: pots, pans, trays, bowls, knives, scales, appliances, and any size or capacity mentioned by the source. A step may link to the tools it uses. Preserve explicit source requirements and mark inferred tools for review. Missing tool data means “not specified,” not “no equipment needed.”

The meal preparation screen combines tool names and shows which dishes need each one. This is an overview, not a proof that one of each tool is enough. Peak concurrent demand, capacity, cleaning/reuse, and oven temperatures affect the cooking sequence. Two recipes listing an oven do not automatically require two ovens, and two recipes listing a tray cannot automatically share one tray at the same time.

Start with an optional household equipment list and a lightweight availability check. Ask about capacities when they affect a plan; do not require a full kitchen inventory before saving a recipe. Unknown capacities remain visible. Tools can have acceptable alternatives, but The assistant should propose those changes and explain the effect instead of silently rewriting instructions.

## Cooking a meal together

The first release should support multiple dish tracks in one cooking session, with progress and named timers tied to a dish and step. Switching dishes must preserve each position. A preparation overview shows ingredients, equipment, unresolved requirements, and an editable order of work.

For coordinated timing, collect a desired serving time, explicit step durations, active versus unattended work, dependencies, and relevant equipment availability. Keep original recipe order where a step depends on an earlier step. The assistant can propose an order and explain what can overlap; the application validates dependencies and resource conflicts. If durations or capacities are missing, ask or present a rough order with its uncertainty instead of promising a finish time.

Scaling ingredients does not multiply oven temperature or cooking time. A larger batch can change pan capacity and require separate batches, so surface the capacity question. If two dishes specify 200°C and 220°C and the household has one oven, identify the conflict and let the cook select a different sequence, appliance, or recipe adjustment.

## AI assistant across the workflow

BYK means bring your own key, and the desired experience is logging in with the user's OpenAI and Claude accounts inside Kooks. Use “Assistant” in the interface. Design one set of cooking actions behind separate provider connections; preserve each provider's actual authentication, billing, and availability rules. Account sign-in and API-key access are distinct. See [AI account connections](ai-connections.md) for findings and the unresolved fallback choice. The preview has no connected provider and collects no credentials.

| User intent | The assistant should be able to prepare or perform, within agreed authority |
| --- | --- |
| “Save this recipe” | Extract a draft from supported input, retain the source, flag missing yield or unclear amounts, and save through the recipe editor's actions. |
| “Find something with chickpeas” | Search the actual household collection, link results, and state when no match is found. |
| “Make this for six in metric” | Select servings and display units using deterministic conversion functions, preserving the source. |
| “Combine these into dinner” | Create a named meal, set dish portions, and optionally place an occurrence in the plan. |
| “What do I need?” | Prepare a grocery contribution review and a separate equipment checklist; ask about unknown availability. |
| “Get everything ready for 7” | Propose a sequence from known steps, durations, and kitchen constraints; show assumptions and conflicts. |
| “Help me cook this meal” | Navigate dish/step views, use supported timer actions, answer from the recipe, and adapt the remaining plan after a delay. |
| “Remember what I changed” | Save a cooking note or propose a recipe revision/variant with a visible diff. |

The assistant should use the same validated application actions as the manual controls. The model interprets intent and proposes choices; recipe arithmetic, unit conversion, list totals, permissions, and timer scheduling remain application responsibilities. The cookbook and active cooking view remain usable when AI is unavailable.

### Action behavior to decide

An open product decision is whether the assistant should propose changes for review, apply reversible changes with undo, or remain advisory. The Phase 1 preview demonstrates a review step; that is a design option, not a settled autonomy policy.

Proposed action lifecycle: understand the request and selected context → fetch relevant household records → resolve consequential ambiguities → validate a proposed change → apply according to the chosen policy → report exactly what changed, with links and undo where feasible. A multi-action request needs a clear result for each action, including failures or work left undone.

Every action should record the request, affected record IDs/revisions, result, and available reversal. Retrying a network request must not create a duplicate meal or shopping contribution. If another household member changed a record after the assistant prepared its proposal, refresh the comparison before applying it. Undo must not overwrite someone else's later edit.

Imported recipe text is content to extract from, not instructions granting the agent permissions. Household access must be enforced by application code. Data sent to an AI service and expected recurring costs are implementation decisions to settle in Phase 2. Grocery purchases, external messages, public sharing, and appliance control are not implied by the request to handle the in-app workflow.

## Delivery changes

| Phase | Addition |
| --- | --- |
| 1 — Experience | Prototype composing a meal, per-dish portions, combined shopping, equipment overview, and an assistant proposal. Resolve account-connection feasibility, autonomy, and whether batching is included. |
| 2 — Foundation | Recipe/step equipment data, extensible meal records, shared action layer, provider/integration choice, first AI assistant capture/search/adaptation actions, and action history. |
| 3 — Meals and shopping | Reusable meals, separate occurrences, contribution-based shopping, equipment overview, AI assistant composition/planning/list actions, and agreed batching support. |
| 4 — Coordinated cooking | Multi-dish sessions, per-dish progress/timers, equipment-aware prep sequence, and AI assistance during cooking. |
| 5 — Pilot | Cook a real composed meal, verify a tool conflict, test assistant failures/undo, and confirm manual continuity when AI is unavailable. |

## Acceptance examples

1. Save two recipes as one meal, alter one dish's portions, and reopen without losing the composition.
2. Generate correct combined quantities; exclude staples; remove a dish; repeat an update without duplication; distinguish two intentional occurrences of the same meal.
3. See each required tool and the recipes using it. Preserve unknown requirements. Detect incompatible simultaneous oven requirements when one oven is known.
4. Move between two dishes while preserving steps and timers, and resume the meal after interruption.
5. Ask the assistant to compose and shop a meal. Verify the proposed diff, resulting records, and an undo that respects subsequent household edits.
6. Reject an invalid or stale action without losing the request. A failed provider call leaves the cookbook unchanged and offers a usable manual path.
7. Preserve source quantities, timing, and attribution when AI suggests an adaptation.

## Research implications

Schema.org's Recipe type inherits a `tool` property from HowTo; HowToTool can represent a required quantity. This supports preserving equipment supplied in structured recipe imports. It does not establish that particular recipe sites populate those fields. [Recipe schema](https://schema.org/Recipe), [HowToTool schema](https://schema.org/HowToTool).

Crouton describes weekly recipe placement, recipe scaling, and multiple timers as distinct capabilities. Our design inference is that Kooks should distinguish a reusable meal composition from calendar placement and from a coordinated cooking session; none alone guarantees the other two. [Crouton feature overview](https://crouton.app/).

The new request supersedes the earlier recommendation to defer meal templates and multi-dish coordination. Provider-specific authentication research is recorded separately because account sign-in changes the runtime, hosting, and credential design.
