# Cooking companion: initial research

> Historical design/research record (September 2026), with personal discovery context removed. [Current implementation and handoff](handoff.md) takes precedence: Capacitor iOS/Android, persistent browser/MCP storage, backups, history, and eight household features now exist. Earlier phase labels and deferrals are not current completion status. Provider/platform research should be rechecked before implementation.

Research date: September 19, 2026. Working name: **Kooks**, taken from the workspace directory; the name is not a branding decision.

## Purpose and evidence

The user wants a modern, intuitive way to add recipes, prepare shopping lists, and follow recipes while cooking. This research examines how those activities connect, which existing patterns are useful, and what could make a custom product worthwhile.

This combines product requirements with desk research using official product pages, documentation, web-platform references, and two firsthand community discussions. Products were not installed or tested, and no formal usability sessions or import benchmarks have been run. Vendor statements establish advertised capabilities, not measured usability or reliability. Community reports are examples of failure modes, not estimates of how common problems are. Recommendations below are our product hypotheses for this project.

The workspace was empty at the start. There is no existing application, repository history, or established technology stack to preserve.

## Product context

The first version targets households, with phone-first use and desktop access. Product goals include importing pasted recipes, search, editing, guided cooking, quantity adaptation, and measurement conversion.

This makes a personal recipe collection the core of the product. Paste-based capture, searchable text, an easy editor, scaling, and unit conversion become first-version priorities. Household access also belongs in the initial design. The exact mix of written messages, links, photos, and videos remains unknown; recipe languages, measurement preferences, and phone operating systems remain open.

## Findings that shape the product

1. **The connection between activities matters as much as the individual features.** Several established products link recipes, meal planning, and shopping. Our opportunity is to make the user's particular route through those activities feel natural; the feature combination alone is not a novel differentiator. [Paprika](https://www.paprikaapp.com/), [AnyList meal planning](https://www.anylist.com/meal-planning).
2. **Capturing a recipe should require little work.** Competitors support website imports, and some support photos and scanned pages. A useful first version needs dependable manual entry and paste-based entry, plus URL import for sources the user actually uses. Which of these deserves priority depends on those sources. [Recipe Keeper](https://www.recipekeeperonline.com/).
3. **Shopping needs understandable calculations.** Similar-looking ingredients are not always interchangeable, and not all quantities can be combined. Users need to see what a total includes and correct it easily. This is a core design and data-model problem, not just list formatting. [Mealie ingredient discussion](https://github.com/mealie-recipes/mealie/discussions/6920).
4. **Cooking is a separate interaction context.** Step focus, quantities close to instructions, persistent progress, and accessible timers deserve their own screen design. Existing products make step guidance and timer access prominent. [Crouton press kit](https://crouton.app/press-kit.html), [Pestle](https://pestlechef.app/).
5. **Network and interruption behavior are part of usability.** A shopping checkbox that appears to work but is not saved is more damaging than a missing decorative feature. Offline access needs a precise definition and real-device testing. [Historical Mealie offline report](https://github.com/mealie-recipes/mealie/issues/3834).
6. **A phone-friendly web app is a candidate, not yet a decision.** It can serve phone and desktop use, but background timer requirements may favor a native application. This should be resolved before committing to the platform. [MDN page visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API), [Apple AlarmKit](https://developer.apple.com/documentation/alarmkit).

## Comparable products

These comparisons identify patterns to learn from. An omitted capability means it was not evaluated, not that the product lacks it.

| Product | Verified capabilities relevant here | Implication for Kooks |
| --- | --- | --- |
| [Paprika](https://www.paprikaapp.com/) | Website imports; ingredient consolidation and aisle sorting; scaling; detected timers; recipe progress; screen staying awake; meal plans and cloud sync. Its platform versions are sold separately. | A strong reference for continuity from collection to kitchen. A custom product should deliver a meaningfully better fit for the user's habits. |
| [AnyList](https://www.anylist.com/recipes) | Recipe collections and ingredient search; imports via mobile sharing and desktop extensions; recipe-to-list actions; household recipe and plan sharing. | Make shopping and household coordination easy to reach. Saving a recipe from another app is an important later usability improvement. |
| [Samsung Food](https://support.samsungfood.com/hc/en-us/articles/18369342052372-Getting-Started-with-Samsung-Food-Create-and-Manage-Shopping-Lists) | Multiple shopping lists; individual items and recipe ingredients; serving adjustments before adding; ingredient selection; collaborative editing; recipe or aisle views. | Show a short review before adding ingredients, including what the cook already has. Keep an item connected to the recipe that needs it. |
| [Recipe Keeper](https://www.recipekeeperonline.com/) | Manual and pasted recipes; web import; OCR from photos and PDFs; shopping and meal planning; cross-device sync and offline access. | Capture sources deserve explicit prioritization. OCR should retain an editable draft because recognition accuracy must be checked with real samples. |
| [Crouton](https://crouton.app/) | Website and cookbook capture; meal plans; scaling; multiple timers; household iCloud synchronization. Its [press kit](https://crouton.app/press-kit.html) describes step mode and hands-free navigation. | Keep the kitchen experience focused and readable. Hands-free interaction is a possible enhancement to validate later. |
| [Pestle](https://pestlechef.app/) | Website and social recipe capture; guided cooking; household collections; shopping lists; scaling. Its [iOS 26 feature page](https://pestlechef.app/ios-26) describes native AlarmKit timers. | Native integrations can materially improve cooking mode. Social import and reliable system alarms have different technical requirements from ordinary web capture. |
| [Mealie](https://docs.mealie.io/documentation/getting-started/introduction/) | Self-hosted recipe management; URL imports; an API; a progressive web app; meal plans; shopping lists; household organization. | An existing foundation is worth considering if getting a practical household tool quickly matters more than creating a distinct application. |
| [Tandoor](https://docs.tandoor.dev/) | Structured recipes; planning; shopping; cookbooks; collaboration; fractions; imports from structured website data. | Ingredient and unit modeling are central. Adapting an existing application is an alternative to owning an entire new product. |

The vendor pages confirm a mature category. This research does not establish market demand for another public recipe application. For a personal tool, success can instead be measured by regular use and reduced friction in the user's cooking routine.

## Firsthand problem signals

In a January 2026 Mealie discussion, a user wanted repeated ingredients consolidated. A maintainer explained that consolidation depends on parsed ingredient data and that different units cannot always be combined. **Our inference:** retain both the original ingredient line and structured fields, and make unresolved quantities understandable instead of silently inventing conversions. [Discussion and maintainer response](https://github.com/mealie-recipes/mealie/discussions/6920).

A July 2024 report described shopping edits failing after a connection loss. The reporter also said the behavior worked on the demo and might be deployment-specific. This is historical evidence of a useful test scenario, not a claim about Mealie's current release. **Our inference:** test opening a list online, losing connectivity, checking items, closing it, reopening it, and reconnecting. [Original report](https://github.com/mealie-recipes/mealie/issues/3834).

These reports inform the proposed message-to-recipe workflow. Shopping frequency, recipe formats, and the household's collaboration habits still need clarification.

## Proposed workflows

### Add and retrieve a recipe

Start with a visible Add recipe action offering manual entry, pasted text, and a website link. A draft can be incomplete. The user should not have to classify cuisine, upload a photo, or populate nutrition fields before saving a family recipe.

An imported draft should expose title, ingredients, instructions, yield, and source for correction before committing it. Missing fields stay missing. Preserve sections such as sauce and dough. If a page contains multiple recipes, ask which one to use. If extraction fails, offer paste/manual entry while keeping the source URL.

Search should find names, ingredients, tags, and personal notes. Favorites and a small number of user-defined collections are likely enough initially. Duplicate detection should offer to open or update an existing recipe, while preserving intentional variations.

### Choose food and prepare shopping

A recipe can go directly to shopping or be assigned to a simple weekly plan. A plan entry needs a serving count and may represent leftovers or eating out; it need not always link to a recipe. A lightweight plan is a proposed addition, subject to how the user actually shops.

Before creating the list, review servings and deselect ingredients already available. Combine compatible quantities, group by grocery category, and allow ordinary non-recipe items. The cook should be able to inspect which recipes contributed to a total.

Changing tomorrow's dinner should present the resulting list changes. Repeatedly pressing Add should not accidentally double a contribution. Removing one recipe must not remove ingredients still needed by another recipe or erase a manually added item.

### Shop

Prioritize readable item names, generous checkbox targets, quick additions, and an immediate undo. Bought items can collapse into a separate group. Store order should be adjustable; a large supermarket database is unnecessary for the first version.

For shared lists, distinguish saved, waiting to sync, and failed changes. If offline shopping is included, checklist changes must persist locally. Reconnection must not restore already-bought items or apply the same edit twice.

### Cook and improve

Open a preparation overview showing yield, total time if known, ingredients, and any equipment notes. Cooking mode then focuses on one step, with access to all ingredients and the complete method. Keep current-step quantities nearby when the recipe has reliable ingredient-to-step associations; otherwise keep the ingredient list accessible without guessing associations.

Support moving backward, jumping between steps, multiple named timers, and resuming after an interruption. A timer finishing must not silently advance the recipe. Persist the recipe version and servings used for a session so later edits do not change instructions mid-cook.

After cooking, offer a short optional note and a Cook again preference. This turns a saved recipe into a record of what worked in this kitchen. Full ratings, social comments, and a recommendation engine can wait.

## Important domain details

The examples here are proposed rules to test, not culinary advice.

| Situation | Proposed behavior |
| --- | --- |
| 200 g tomatoes + 300 g tomatoes | Show 500 g when ingredient identity and preparation state match. |
| 500 g flour + 0.5 kg flour | Combine using a supported mass conversion, keeping source contributions available. |
| 2 tomatoes + 300 g tomatoes | Group together but preserve both quantities unless an explicit ingredient-specific conversion is available. |
| Fresh tomatoes + canned tomatoes | Keep separate by default. |
| 1 can (400 g) + 1 can (800 g) | Preserve package size; do not reduce to an ambiguous “2 cans.” |
| Cups of flour + grams of flour | Do not treat volume and mass as interchangeable. Density and cup convention require an explicit rule. |
| “Salt to taste,” optional garnish, or 2–3 cloves | Preserve qualifiers and ranges rather than forcing a single precise number. |
| Scaling a recipe from 4 servings to 6 | Scale eligible ingredient quantities; preserve source cooking times and temperatures. |
| Changing servings after shopping | Show which quantities would change; keep purchased status and manual adjustments understandable. |
| The same recipe planned twice | Track separate meal occurrences so two intentional meals are distinct from a duplicate tap. |

These details justify designing ingredients as data from the start, while allowing plain text when structure is uncertain. They also explain why a full pantry inventory can add substantial work: exact stock is only useful if someone keeps it current. A simple “have this” selection is the proposed starting point; persistent stock quantities and automatic deductions remain optional.

Because conversion is an explicit pain point, support mass-to-mass, volume-to-volume, and temperature conversions in the first version. Store the original unit and the selected measurement convention, and round only for display. A cooking reference can use rounded household equivalencies, so the product must distinguish its chosen convention from exact physical-unit conversions. [NIST cooking measurement equivalencies](https://www.nist.gov/pml/owm/metric-si/metric-kitchen/metric-kitchen-cooking-measurement-equivalencies).

Ingredient-specific cup-to-gram conversions need a named reference and an ingredient/preparation match; they are estimates, not a universal formula. Ambiguous terms such as a glass, packet, heaped spoon, or an unspecified cup stay visible for the user to clarify. Whether these advanced conversions are needed in the first version depends on the user's examples.

## Import feasibility

Recipe websites can expose structured data for ingredients, yield, timing, and instructions. Schema.org allows several representations, including text and ordered steps or sections; an importer must tolerate those variants. Google's recipe documentation provides practical structured-data examples. [Schema.org Recipe](https://schema.org/Recipe), [Google recipe structured data](https://developers.google.com/search/docs/appearance/structured-data/recipe).

Proposed sequence:

1. Attempt structured recipe extraction from a user-supplied public URL.
2. Validate fields and preserve the source link and original ingredient wording.
3. Present a draft for correction, including unresolved quantities and missing fields.
4. Fall back to pasted text or manual entry if a page cannot be imported.
5. Prioritize OCR from real recipe samples. Following the user's scope addition, AI assistance is core scope; its extraction behavior, input formats, privacy, and cost still need validation.

Social video, screenshots, handwritten cards, and private pages are separate input problems. A URL does not necessarily contain a complete written recipe. No arbitrary-site or arbitrary-video success rate should be promised. The first benchmark should use approximately 15–20 recipes representative of the user's sources and languages, recording complete, partial, and failed imports separately.

If an import service fetches URLs, implementation must constrain destinations and redirects, bound fetch size/time, and treat extracted markup as untrusted text. Keep imported recipes private within their intended audience and preserve attribution; a public recipe catalog would be a separate product decision.

### Moving from WhatsApp

Make copying a recipe message into an editable draft the dependable starting route. Preserve the original text as a reference and allow several related messages to be combined into one recipe. Store links as sources; image recognition and video extraction are separate capabilities to prioritize after seeing the user's input mix.

For the existing archive, evaluate a one-time, user-selected chat export and recipe-by-recipe review. WhatsApp documents a chat export facility. The migration should identify message boundaries, links, and attachments and avoid importing unrelated conversation automatically. Direct ongoing access to the private WhatsApp group is not assumed. [WhatsApp chat export help](https://faq.whatsapp.com/1180414079177245/).

Receiving content from a phone's Share menu would reduce future capture effort, but the web share-target mechanism has limited availability and requires an installed app. Sending content through a Share menu is a different capability from receiving it. Verify incoming sharing on the household's actual phones before including it in the first-version promise. [MDN share targets](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target).

## Web versus native feasibility

| Approach | Useful fit | Main tradeoff to validate |
| --- | --- | --- |
| Responsive, installable web app | One interface for phone, tablet, and desktop; easy iteration and sharing. | Offline storage and synchronization require explicit design. Browser timer alerts during suspension cannot be assumed reliable. |
| Native or cross-platform mobile app | System timers, device sharing, and deeper phone integration are central requirements. | Platform-specific permissions, distribution, maintenance, and a possible separate desktop experience. |
| Adapt an existing self-hosted product | The priority is owning a useful household tool quickly. | UX and data models are constrained by the upstream application; evaluate extension support, maintenance, and licensing before committing. |

A progressive web app can use service workers for cached resources and supported background operations. That does not automatically make every feature available offline. We must specify which recipes, images, lists, and edits persist, and whether synchronization needs the app to be reopened. [MDN offline and background operation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation).

Screen Wake Lock can keep a visible recipe screen awake in supporting browsers over a secure connection. The system can reject or release it, including when the document becomes inactive. Show its actual state and reacquire it when appropriate. [MDN Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API).

Browsers throttle background JavaScript timers. Persisting a timer's target time lets the UI recover an accurate remaining duration when resumed; it does not guarantee a punctual alert while the app is suspended. **Recommendation:** determine whether locked-screen alarms are essential before choosing the platform. [MDN page visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API).

Native platforms expose alarm APIs but still have authorization and platform constraints. Apple documents AlarmKit for alarms and countdowns; Android documents exact-alarm permissions. Native is a stronger candidate when system-level alerts are essential, with behavior to verify on the actual target devices. [Apple AlarmKit](https://developer.apple.com/documentation/alarmkit), [Android alarm scheduling](https://developer.android.com/develop/background-work/services/alarms).

## Interface principles

“Modern” should mean quick comprehension, dependable state, and comfortable use in context. Proposed design principles are a calm visual hierarchy, strong text contrast, restrained motion, optional photography, visible primary actions, and useful empty states. The visual style itself remains for the user to choose in the design phase.

For cooking and shopping, aim for roughly 44–48 CSS pixel primary touch targets as a project design target. WCAG 2.2's AA minimum target-size criterion uses 24 CSS pixels with defined exceptions; our larger target is a deliberate usability choice. Verify keyboard access, focus, labels, zoom, and contrast as well. [W3C target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [WCAG 2.2](https://www.w3.org/TR/WCAG22/).

Language and measurement choices affect the data model as well as copy. Ask about English, Hebrew, other languages, mixed-language recipes, metric and customary units, and Celsius/Fahrenheit. If right-to-left support is required, test mixed-direction ingredient names and numbers early. No language or dietary preference should be inferred from location.

## Recommended scope and remaining uncertainty

Prioritize WhatsApp-friendly recipe capture and retrieval, editing, serving and measurement changes, household access, shopping lists, focused cooking, saved progress, cooking notes, and data export. The expanded product scope includes composed meals, required tools, and AI assistance throughout. These supersede the initial recommendation to defer multi-dish coordination. Calendar placement and a manual “already have” check support the flow. Clarify simultaneous household editing.

Defer exact pantry inventory, expiry tracking, grocery retailer integrations, nutrition calculations, public social features, and automatic substitutions until the core workflow is used successfully. Include an editable meal preparation sequence and relevant equipment conflicts in the core design; advanced schedule optimization can follow actual use. OCR, voice control, and social imports can move earlier if essential.

The most important remaining unknowns are phone platforms, recipe formats/languages, measurement conventions, shopping habits, collaboration, offline expectations, timer behavior, AI account-connection feasibility/autonomy, and multi-day batching. The [delivery plan](project-plan.md) turns these into phase-specific questions and validation gates. No delivery deadline or recurring-cost commitment is justified until these choices are clearer.

### Scope addition: meals, tools, and AI assistant

The [expanded requirements](meals-equipment-byk.md) distinguish reusable meal composition, calendar occurrence, and coordinated cooking. This is a design inference to prevent duplicated shopping and ambiguous portions. Recipe equipment can be imported when supplied: Schema.org's Recipe inherits `tool`, and HowToTool supports required quantity. Missing metadata must remain unknown. [Recipe schema](https://schema.org/Recipe), [HowToTool schema](https://schema.org/HowToTool).

The assistant should span the confirmed workflows through validated app actions. The product proposal includes OpenAI and Claude account sign-in, subject to supported integration paths. [AI account connection research](ai-connections.md) distinguishes supported API access from subscription login and records the provider-specific feasibility gap. The Phase 1 preview demonstrates the interaction without a connected model.
