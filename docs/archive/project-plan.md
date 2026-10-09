# Kooks: product and phased delivery plan

> Historical design/research record (September 2026), with personal discovery context removed. [Current implementation and handoff](../handoff.md) takes precedence: Capacitor iOS/Android, persistent browser/MCP storage, backups, history, and eight household features now exist. Earlier phase labels and deferrals are not current completion status. Provider/platform research should be rechecked before implementation.

Prepared September 19, 2026. This historical proposal is informed by [research](research.md). See the current handoff for implemented scope and outstanding work.

## Product direction

**Build a household cooking companion for recipes, composed meals, equipment, shopping, and coordinated cooking, with AI assistance throughout, on phone and desktop.**

Kooks supports a recipe-capture workflow based on pasted messages. The main problems are search, editing, following instructions, changing quantities, and converting measurements. The product should replace that friction while remaining easy enough to use every time a recipe is worth saving.

The end-to-end journey is **capture → organize → compose a meal → adapt → shop → prepare → cook → record what worked**. A meal combines recipes and their portions. Calendar placement is optional, and a single recipe can go directly to shopping or cooking. The user's scope addition is detailed in [Meals, equipment, and AI assistant](../meals-equipment-byk.md).

The initial audience is individual households. Exact devices, languages, measurement conventions, collaboration rules, visual style, and hosting are still to be decided. Kooks is a working name only.

## Proposed first version

| Area                        | First-version behavior                                                                                                                                                                                 | Why it matters                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Recipe capture              | Manual entry; paste from WhatsApp; editable import drafts; original text and source links retained; URL import for agreed sources.                                                                     | Moves pasted recipes into a usable collection. The mix of source formats may change implementation priority.                            |
| Library and editing         | Search by title, ingredient, and notes; favorites; simple tags/collections; ingredient and instruction sections; duplicate/variant handling.                                                           | Directly addresses the difficulty of finding and improving saved messages.                                                              |
| Quantities and measurements | Serving multiplier and custom servings; fractions; supported mass, volume, and temperature conversion; original values available.                                                                      | Makes adaptation a normal part of reading a recipe. Ambiguous units and volume-to-mass estimates require explicit handling.             |
| Meal composition            | Named, reusable combinations of recipes; a role and selected portions for each dish; separate scheduled occurrences; whole-meal shopping and cooking.                                                  | Explicitly requested meal prep. Multi-day batch allocation remains to be clarified.                                                     |
| Required equipment          | Editable recipe/step tools, a combined meal overview, availability checks, and relevant capacity/temperature conflicts.                                                                                | Prevents discovering a missing tool or competing appliance requirement during cooking.                                                  |
| Shopping                    | Add one or several recipes at selected servings; review ingredients already available; combine compatible quantities; grocery categories; manual items; undo and contribution details.                 | Connects the cookbook to an actual shopping trip.                                                                                       |
| Household use               | A private shared collection and lists; individual membership; separate cooking progress unless shared cooking is specifically requested.                                                               | Matches the confirmed audience without forcing two cooks to share one active step.                                                      |
| Cooking                     | Preparation overview and coordinated order for a meal; separate dish progress; focused steps; ingredients/tools within reach; multiple named timers; save and resume; supported screen-awake behavior. | Makes following one or several recipes comfortable in the kitchen. Background alarm requirements determine part of the platform choice. |
| AI assistant                | Capture, search, adaptation, meal composition, shopping, equipment checks, cooking assistance, and notes through shared app actions, using the user's OpenAI/Claude access.                            | Account sign-in is requested; supported connection paths and autonomy remain open. Manual controls remain available.                    |
| Small supporting features   | Optional weekly plan, post-cook notes, favorites, export/restore, and selected offline access if confirmed.                                                                                            | Helps repeat good meals and preserve the collection. Offline scope needs a concrete agreement.                                          |

Photos and covers should be optional. An incomplete recipe can be saved as a draft; it should be clear which missing fields prevent scaling or guided cooking. Search and editing should not depend on having a photo or extensive metadata.

Keep detailed pantry stock, expiry dates, nutrition analysis, public sharing feeds, retailer checkout, and automatic recipe generation for later. Meal composition and multi-dish coordination are now core scope. OCR, video capture, and ingredient-specific density conversions can move into the first version if the user's sample recipes make them essential.

## Main screens and journeys

Proposed navigation has **Recipes**, **Meals**, **Shop**, and **Plan**, with a consistent **AI assistant** entry point. Plan remains optional calendar placement; Meals contains reusable dish combinations. Recipes is the initial home screen, with prominent search and Add recipe actions. An active cooking session appears as an easy-to-reach Continue cooking control. Desktop provides more room for side-by-side ingredients, tools, and instructions. Validate the expanded phone navigation during Phase 1.

| Journey                                   | Proposed interaction                                                                                                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Save a WhatsApp recipe                    | Copy message → paste into Add recipe → review ingredients, steps, and yield → save. Preserve source text and allow related messages to be combined.                                      |
| Change dinner for 4 into dinner for 6     | Open recipe → set 6 servings → see scaled ingredients and linked step quantities where available → keep source timing unchanged.                                                         |
| Read a recipe in preferred units          | Select display convention → convert supported quantities → inspect originals or unresolved units → retain the original recipe data.                                                      |
| Prepare a complete dinner                 | Create a meal → choose main and sides → set each dish's portions → review shared ingredients and required tools → shop and cook together.                                                |
| Delegate the preparation to the assistant | Describe the meal or select recipes → resolve missing constraints → inspect proposed changes → apply according to the agreed autonomy policy → see resulting records and available undo. |
| Shop for several meals                    | Select recipes/plan entries → choose servings → deselect what is already available → review combined list → check off items.                                                             |
| Cook with interruptions                   | Start cooking → follow steps and timers → leave/reopen → resume saved session and recover timer state.                                                                                   |
| Coordinate dishes                         | Check tools and serving-time goal → review order and resource conflicts → switch between dishes → retain independent progress and named timers.                                          |
| Improve a family recipe                   | Add a cooking note → decide whether to update the recipe or create a variant → preserve the source reference.                                                                            |

Prototype both normal and difficult states: empty library, partial recipe, failed import, missing serving count, ambiguous conversion, no search results, an offline list, a conflicting household edit, and a resumed cooking session. Screen density and visual direction should be chosen with the user during Phase 1.

## Architecture direction

The provisional front-runner is a responsive, installable web application because the requested experience spans phones and desktop. Confirm actual devices and incoming sharing/timer requirements before committing. Native mobile or a native companion may be justified if those are essential. The [research](research.md) documents platform constraints.

If the web route is selected, keep the architecture small: one application, one shared data service, one database, and storage for user images when needed. Add import processing as a bounded server-side function. Choose the language/framework and hosting after platform and ownership decisions; avoid separate services until a concrete requirement needs them.

Use a shared database for household records, plus local persistence for drafts, selected recipes, shopping operations, and cooking sessions according to the agreed offline scope. Cross-device sync and durable backups are separate requirements. An installable icon alone does not satisfy either.

| Core record              | Information it needs to preserve                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Household and membership | Household identity, members, access rights, locale and display preferences.                                                                 |
| Recipe                   | Title, original content, source, base yield, optional times, equipment requirements, notes, ownership, and revision.                        |
| Ingredient               | Original line, optional normalized identity, quantity or range, unit and convention, preparation notes, section, and certainty of parsing.  |
| Step                     | Ordered text, section, ingredient/tool references, explicit durations, dependencies, and timer suggestions; unknown values preserved.       |
| Equipment requirement    | Tool identity/name, quantity, size/capacity, optional alternatives, source or inference status, and recipe/step uses.                       |
| Household equipment      | Optional available tools/appliances and capacities; absence of a record is unknown availability.                                            |
| Meal and component       | Reusable meal name/notes and component recipes with roles and selected portions.                                                            |
| Meal occurrence          | Distinct identity, date/slot if scheduled, meal composition/revision and portions; separate from the reusable meal.                         |
| Shopping contribution    | Which recipe occurrence or manual action requested an ingredient and quantity.                                                              |
| Shopping item            | Aggregated compatible contributions, category, manual adjustments, bought state, and synchronization version.                               |
| Cooking session          | Recipe or meal snapshots, per-dish servings/progress, units, prep order, equipment allocations, ingredient check-offs, and timer deadlines. |
| Cooking note             | Date, recipe reference, personal changes, and optional Cook again marker.                                                                   |
| Agent action             | Request, actor/household, affected records/revisions, validated proposal, execution result, retry identity, and reversal information.       |

Contributions must survive aggregation so removing one planned meal can subtract its needs correctly. Recipe edits must not silently rewrite an existing shopping trip or active cooking session. Preserve source data separately from scaled and converted display values.

The assistant and the manual interface should call the same validated operations. Keep calculations, household access, contribution updates, and timer scheduling in application code. Validate proposed actions, record outcomes, and handle partial failure. The proposal includes OpenAI/ChatGPT and Claude account sign-in; [connection feasibility](ai-connections.md) must inform the platform choice. API-key fallback has not been accepted. Meal scheduling must distinguish known constraints from estimates; a tool overview alone cannot prove a sequence feasible.

Handle list updates as explicit item operations with stable IDs so offline retries do not create duplicates. Recipe edit conflicts should preserve both versions or prompt for resolution. Fine details belong in implementation design; these constraints need to be established before the first database schema.

Export should use a documented format for recipes and related records, with a clear policy for images. A restore check is required before trusting it as a backup. Private household access and access checks belong in the initial foundation.

## Phases and checkpoints

At the beginning of each phase, ask a small batch of questions that affect that phase. Record the answers in [decisions](../decisions.md). Continue independent work when an answer is optional; wait on a required choice before doing work that depends on it. Reopen a decision only when new evidence changes the tradeoff.

Each phase ends with a concrete artifact or working demonstration, a short account of verification, and the decisions needed for the next phase. The questions below are a future question bank, not a request for the user to answer everything now. Deployment details and recurring costs will be made reviewable before any hosting commitment.

### Phase 0 — Research and initial discovery

**Status:** Research and initial discovery complete; recommendations remain provisional.

**Work:** Compare relevant products, examine import and cooking constraints, identify useful additions, understand the current workflow, and prepare this roadmap.

**Initial product scope:** Household audience; phone-first with desktop access; pasted-message capture and search/editing/scaling/conversion/cooking workflows.

**Deliverables:** Research with sources, initial product scope, phased plan, and decision log.

**Exit criterion:** A grounded proposal that identifies known needs, assumptions, alternatives, and remaining decisions. This checkpoint does not imply that platform or implementation choices are approved.

### Phase 1 — Scope, experience, and prototype

**Status:** Product brief and interactive concept prepared following approval of the direction, now expanded for meals, equipment, and AI assistant. Device, input-format, language/measurement, AI assistant, and batching answers and usability review remain outstanding. See the [product brief](product-brief.md) and [prototype review notes](prototype-review.md).

**Purpose:** Make the intended product concrete before committing to the implementation.

**Beginning questions:**

1. Which phones are in the household, and must a cooking timer alert while the phone is locked or another app is open?
2. What does the WhatsApp archive contain: written recipe messages, website links, photos/screenshots, videos, or a mixture?
3. Which recipe/interface languages and measurement conventions are needed, and which conversions cause the most trouble?

Ask about visual preferences and typical shopping/planning habits while reviewing the first concepts. If availability without internet is essential, settle the exact offline actions here. Gather a few representative recipe snippets or URLs voluntarily supplied by the user; do not assume access to the private chat.

**Work:** Set first-version priorities; map capture, adaptation, meal composition, equipment, shopping, and cooking; create an interactive mobile prototype and desktop editing view; demonstrate an assistant proposal; clarify autonomy and batching; investigate OpenAI/Claude sign-in alongside phone sharing and timer constraints before the platform decision.

**Deliverables:** Agreed product brief, prototype, representative recipe examples, and a platform recommendation with tradeoffs.

**Done when:** The user can walk through saving, finding, scaling/converting, composing and shopping a meal, reviewing tools, and cooking a familiar recipe; the assistant's intended role is clear; important ambiguous states are designed; platform choice follows actual device needs. No production framework is committed before the platform decision.

### Phase 2 — Foundation and useful recipe library

**Purpose:** Replace the WhatsApp archive for everyday recipe retrieval and editing.

**Beginning questions:** How should household members join and edit the collection, including any personal recipes? Is manual migration sufficient or is chat-export migration needed now? What hosting/stack constraints and recurring-cost ceiling apply? Which of the researched account-connection routes should be implemented, with what data access and per-member credential boundaries?

**Work:** Establish the app and data storage; household boundaries; recipe editor/drafts with equipment; paste capture; agreed URL import; search, favorites, tags; serving calculations and conversions; source preservation; export/restore. Establish the shared action layer and the assistant's capture/search/adaptation capabilities with agreed autonomy and action history. Include a basic readable recipe view. Keep records ready for composed meals and the offline behaviors agreed in Phase 1.

**Deliverables:** A working private cookbook and an initial set of the user's recipes. The shared data model is in place even if only the user pilots the first build.

**Done when:** At least 10 representative recipes can be saved, edited, found, scaled, and displayed in the chosen units. The originals remain recoverable. Import failures retain a usable draft. Reloads do not lose data. Members cannot access a household they do not belong to. An export can be restored and compared with its source.

The assistant must execute a representative capture/search/adaptation request through validated actions, preserve source data, and report failures accurately. An unavailable AI service must leave manual recipe work usable. Equipment can be entered, edited, and retained, including an explicit unknown state.

**Complexity:** High where recipes are unstructured or multilingual; moderate for ordinary library UI. Import scope is based on real samples, not a promise to support every website.

### Phase 3 — Meals, shopping, and planning

**Purpose:** Compose reusable meals and produce a trustworthy household shopping list from them.

**Beginning questions:** What is a typical meal, and do main/side portions differ or include leftovers? Do you shop weekly or day by day? Will household members shop/edit simultaneously, and are store-specific lists needed? Is a quick “already have” check enough? If batching was selected, how are cooked portions allocated across days?

**Work:** Reusable meals and per-dish portions; distinct occurrences; equipment overview; compatible ingredient aggregation; source contributions; categories; manual list items; undo; shared updates; agreed offline persistence. Add optional weekly placement and AI assistant meal/planning/list actions. Include batch allocation only if confirmed, preventing repeated shopping for already allocated cooked portions.

**Deliverables:** Saved composed meals, one combined list for their dishes and household essentials, an equipment overview, and AI assistant actions using the same workflow.

**Done when:** A meal with at least two recipes can be saved/reused with independent portions. The shopping trip has correct quantities; ambiguous units remain readable; retries do not duplicate contributions; removing a dish preserves other needs and manual items; separate occurrences remain distinct. Combined tools retain dish references and unknowns. Household changes and agreed offline operations behave predictably. An assistant-created meal/list can be inspected and reversed according to the selected policy.

**Complexity:** High for aggregation and offline collaboration; additional work for meal identity, batch allocation if chosen, and agent actions. Detailed pantry inventory is not a dependency.

### Phase 4 — Guided and coordinated cooking

**Purpose:** Make the app comfortable and dependable during real cooking.

**Beginning questions:** Do you prefer one step at a time, a full method, or both? Should meal preparation target a serving time? What oven, burner, and tool capacities matter? Will several people cook together, and is hands-free control needed? Reuse agreed device/timer choices.

**Work:** Meal preparation overview; editable order/dependencies; equipment and temperature conflicts; focused/full-method views; per-dish ingredient/tool access and saved progress; named timers; supported screen-awake behavior; resume after interruption; short notes. Add AI assistant sequencing and cooking assistance using the same session controls. Keep timing assumptions visible and preserve the alarm expectations agreed in Phase 1.

**Deliverables:** A complete save-to-shop-to-cook workflow on the actual target phones.

**Done when:** A real meal with at least two dishes can be cooked while switching between their steps, running named timers, and leaving/reopening without losing progress. An equipment/temperature conflict is identified before the affected work starts. The assistant identifies missing scheduling constraints rather than inventing a precise finish time. Timer behavior is tested under agreed visible, background, and locked-screen conditions. Recipe edits elsewhere do not alter active sessions.

**Complexity:** High where device alarms, concurrent dishes, resource constraints, and recovery interact. Begin with explainable, editable sequences; do not promise optimal scheduling.

### Phase 5 — Household pilot and release

**Purpose:** Verify the product under real household use and make it maintainable.

**Beginning questions:** Who will participate in the pilot and on which devices? Where should the private app run? What backup and account-recovery arrangements fit the household? Is there a target date or a remaining must-have before regular use?

**Work:** Pilot composed meals and a shopping trip; fix observed friction; test equipment conflicts, AI assistant actions/undo/provider failure, access boundaries, failed imports, connection loss, accessibility, responsiveness, backup/restore, and updates; document setup and recovery. Review concrete hosting configuration and recurring costs before committing to them.

**Deliverables:** The household-ready application, tested recovery procedure, brief usage guide, and a prioritized list of follow-up improvements.

**Done when:** The agreed core journeys pass on the actual phones and desktop; no critical data-loss or quantity-calculation issues remain; backup restoration works; the user can use the app through an ordinary cooking/shopping cycle without returning to WhatsApp for missing information.

**Complexity:** Driven by observed issues and device coverage. A prototype alone does not satisfy this phase.

### Phase 6 — Optional expansion based on use

**Beginning question:** After using the core product, which remaining task wastes the most time?

Candidates include OCR and chat-archive migration, better incoming phone sharing, voice navigation, recurring calendar automation, ingredient-specific conversion references, and pantry/expiry tracking. Reusable meals and coordination of several dishes have already moved into the core phases at the user's request. Promote further features only when supported by actual use.

## Validation and success measures

These are proposed pilot targets, not measured results or industry benchmarks. Adjust them after observing the user's first prototype session.

| Outcome                | How to evaluate it                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Easier retrieval       | Find several known recipes from title fragments or ingredients, aiming for about 10 seconds each without guidance.                     |
| Low capture friction   | Save a typical pasted message as a reviewed recipe in around one minute; separately record correction time for messy sources.          |
| Trustworthy adaptation | Verify fractions, ranges, zero/missing yield, 0.5×/1.5×/2× scaling, supported conversions, and retention of source times/temperatures. |
| Useful shopping        | Complete a trip planned from at least three recipes without unexplained duplicates, missing contributions, or lost check-offs.         |
| Meal preparation       | Save and reuse a main-plus-side meal, vary one dish's portions, and verify combined groceries and equipment uses.                      |
| Comfortable cooking    | Complete several real cooking sessions without losing the current step, selected servings, or timer state.                             |
| Coordinated cooking    | Complete a two-dish meal with independent progress/timers and a resolved tool conflict.                                                |
| Useful AI assistance   | Complete representative capture, composition, shopping, and cooking requests; verify changes, failure reporting, and available undo.   |
| Household reliability  | Test independent and simultaneous edits on two devices, including reconnects if offline use is included.                               |
| Data ownership         | Export and restore the collection and agreed related data; verify recipe fields, original text, and attachment coverage.               |

Automated checks should focus on calculations, aggregation, access control, import handling, and persistence. End-to-end tests should exercise the core journeys. Real-device checks are necessary for incoming sharing, offline operation, screen wake behavior, and timers. UI polish should also be reviewed visually at phone and desktop sizes.

## Risks, scope drivers, and sequencing

| Risk or open choice                                                                  | Response                                                                                                                                                         |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WhatsApp recipes are mostly screenshots or videos                                    | Reprioritize capture after Phase 1 examples; do not build only a website importer.                                                                               |
| Measurement conversion depends on ingredient density                                 | Start with compatible dimensions; add sourced ingredient-specific estimates only where needed.                                                                   |
| Required incoming sharing or alarms exceed browser capabilities                      | Decide on native support during Phase 1, before committing the implementation.                                                                                   |
| List regeneration overwrites household work                                          | Preserve contribution records and review changes instead of replacing the whole list.                                                                            |
| Sharing and offline edits conflict                                                   | Design stable records, retry-safe operations, and an understandable conflict policy early.                                                                       |
| AI assistant output changes quantities, exceeds authority, or incurs unexpected cost | Use validated app actions and deterministic calculations, preserve sources, enforce the selected policy, record results, and agree on provider/data/cost limits. |
| A meal sequence assumes unavailable equipment or timing                              | Preserve unknowns; check capacity, temperature, dependencies, and active work before presenting a concrete sequence.                                             |
| Too many supporting features delay useful cooking                                    | Keep the core workflow central; revisit additions using pilot evidence.                                                                                          |

Dates and costs depend most on import formats, native integrations, offline collaboration, and existing-recipe migration. Set an estimate after Phase 1 and revise it only when evidence changes the scope. The phase order is a dependency plan, not an assertion that every phase takes the same amount of work.
