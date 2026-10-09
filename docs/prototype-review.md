# Phase 1 prototype review

> Historical design/research record (September 2026), with personal discovery context removed. [Current implementation and handoff](handoff.md) takes precedence: Capacitor iOS/Android, persistent browser/MCP storage, backups, history, and eight household features now exist. Earlier phase labels and deferrals are not current completion status. Provider/platform research should be rechecked before implementation.

This document records an earlier interactive concept. This is an experience prototype with illustrative recipes, not the production household application.

## What was checked

| Interaction                        | Observed result                                                                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search by ingredient               | Searching for chickpea returns the orzo recipe.                                                                                                                 |
| Scale from 4 to 6 servings         | Orzo changes from 250 g to 375 g; stock from 600 mL to 900 mL; olive oil from 30 mL to 45 mL.                                                                   |
| Change unit display                | The same scaled oil shows 3 tbsp; stock shows 3¾ cups under the demonstration's 240 mL convention.                                                              |
| Select shopping ingredients        | Excluding salt produces a six-item selection.                                                                                                                   |
| Combine recipe contributions       | Orzo's 45 mL olive oil plus pasta's 30 mL becomes one 75 mL item with both recipe names.                                                                        |
| Remove a recipe contribution       | Removing the orzo contribution leaves pasta's 30 mL oil and its other ingredients.                                                                              |
| Add an everyday item               | Coffee appears as a separate item in Other.                                                                                                                     |
| Cook and resume                    | Two timers run independently; leaving and returning resumes step 3 with elapsed time reflected.                                                                 |
| Paste and review a message         | A recipe with ingredient and method headings opens in an editable form with the title and yield detected.                                                       |
| Parse fractions and preserve units | A pasted ½ tsp and 1½ cups are recognized; Original units preserves those values.                                                                               |
| Missing yield                      | The recipe shows Original quantities and offers Set yield instead of inventing a serving count.                                                                 |
| Add a planned meal                 | A saved recipe can be assigned to Monday and sent to ingredient review.                                                                                         |
| Responsive layout                  | Desktop at 1024 px, phone at 390 px, and narrow phone at 320 px were inspected in the browser. The root had no horizontal overflow at the checked phone widths. |

JavaScript syntax was checked. Browser inspection found no reported application errors in the exercised flows. The checks exposed and corrected local form submission behavior, echoed preview-state updates interrupting capture, and preservation of parsed original units.

## Expanded meal and assistant checks

The September 19 scope addition was exercised with fresh demonstration data. BYK was clarified during this work as bring your own key/account access; the interface now uses the label Assistant.

| Interaction                        | Observed result                                                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Independent dish portions          | The sample meal keeps the salad at four portions while orzo increases to six. The ingredient review shows 375 g orzo and 300 g salad tomatoes.                                                         |
| Combined meal shopping             | Orzo's 45 mL oil and salad's 15 mL become 60 mL with both dish references.                                                                                                                             |
| Repeat a meal's shopping selection | Repeating the same meal action keeps oil at 60 mL instead of adding it twice.                                                                                                                          |
| Remove a dish and review again     | Removing the salad and applying the revised selection leaves 45 mL oil and seven ingredient rows; its other contributions are removed.                                                                 |
| Required equipment                 | Shared chopping board and knife each appear with both dish names. Equipment is outside the grocery list.                                                                                               |
| Edit recipe tools                  | Editing the soup's tools and saving shows the three entered tools on its recipe view.                                                                                                                  |
| Unknown yield in a meal            | Clearing the soup's yield shows Original quantities on the recipe and Original quantities included on its meal card. No serving count is invented in those views.                                      |
| Oven conflict                      | A created pasta-and-potatoes meal shows the recipes' 200°C and 220°C requirements and asks for a reviewed order if using one oven. This is a simple source-temperature check, not a scheduling engine. |
| Switch dishes                      | Orzo remains at Toast the orzo while the salad advances to Dress and serve; the orzo timer remains visible with its dish label.                                                                        |
| Leave, resume, and reload          | The current dish, independent step positions, and running timer survive navigation and a preview reload in the exercised session.                                                                      |
| Complete dishes                    | Finishing orzo stops its timers and moves to the unfinished salad; completing both returns to the meal with a completion message.                                                                      |
| Plan the same meal twice           | Monday and Tuesday produce four dish contributions. The two roast-dinner occurrences add 120 mL oil, bringing the existing 45 mL to 165 mL. The review labels each occurrence with its day.            |
| Assistant sample proposal          | A clearly labeled preset request creates one two-dish meal; Undo removes the unchanged, unused creation. No model is called.                                                                           |
| Narrow phone controls              | Meal editor checked at 390 and 320 px; assistant view inspected at 320 px. No control extended outside the root in the checked editor, and root scroll width equaled its visible width.                |

The expanded flows had no reported browser errors during these checks. Verification used the local preview, not actual household phones or provider authentication.

## What remains unvalidated

The sample data is not a benchmark of real-world recipe archives. Real recipes, languages, and conventions still need to be supplied or described. The text parser is deliberately limited and its output is editable; it is not evidence of reliable extraction from arbitrary messages, websites, photos, or videos.

No real-device Share-menu integration, background alarms, offline synchronization, accounts, access controls, backups, or production deployment were implemented or tested. The prototype countdowns demonstrate the interaction while the preview is active. A preview's remembered state is not a production backup.

AI connections are displayed as disconnected. Account login, model output, provider billing, arbitrary natural-language requests, and production action history/undo have not been implemented or tested. A preset proposal demonstrates an interaction only. Kitchen capacities, dependency scheduling, and multi-day batch allocation remain specification work; the prototype does not claim a feasible serving-time calculation.

The prototype uses English, metric values, and a declared US kitchen conversion convention as review defaults. It does not yet establish right-to-left support or the final regional measurement policy. Alternative color, library, spacing, and phone-view options are available through the design controls when supported by the conversation interface.

## Phase 1 exit conditions still open

Further usability validation should cover timer behavior, recipe formats, language/measurement conventions, and familiar recipe/meal workflows. Assistant autonomy, account sign-in versus API-key fallback, and multi-day batching remain open. [AI connection feasibility](ai-connections.md) also affects the platform recommendation. Phase 2 begins with its own household, migration, hosting, and connection questions after this checkpoint.
