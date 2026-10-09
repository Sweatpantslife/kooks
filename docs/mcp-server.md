# Kooks MCP server

The local Kooks server gives an MCP-compatible agent 43 tools for recipes, composed meals, plan occurrences, shopping, equipment, cooking, pantry suggestions, household preferences, leftovers, recipe memories/variants, cost estimates, photo imports, and reversible history. The host agent interprets requests; this server validates and performs the actions. It does not require an API key or choose an AI provider.

This integration and the [browser interface](household-features.md) use the same Node.js domain tools and SQLite data. The separately packaged native application currently has its own device storage. AI provider sign-in requirements remain documented in [AI account connections](archive/ai-connections.md).

## Install and connect

Requires Node.js **22.13 or newer**. From the project directory:

```sh
npm ci --ignore-scripts
npm test
```

Register in Codex, replacing the path with the checkout's absolute path:

```sh
codex mcp add kooks -- node /absolute/path/to/kooks/mcp/index.js
codex mcp get kooks
```

Restart the MCP connection in Codex settings (or restart the client), then call `kooks_status`. Configuration alone does not reload an already-running task's tool catalog. The desktop app and CLI share the host's MCP configuration. See [the official Codex MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

Other clients can adapt [mcp-config.example.json](../mcp-config.example.json). Use the **absolute Node executable path** if the desktop client's PATH does not include Node. Launch `node mcp/index.js` directly; a normal `npm start` prints a banner on stdout and should not be used as the MCP transport command. Diagnostics go to stderr and stdout is reserved for MCP. The entry point uses the official SDK's [stdio transport](https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-server).

The default database is `.data/kooks.sqlite`, resolved relative to the project, regardless of the client's working directory. `KOOKS_DB_PATH` selects another database. Connect local clients to the same file to share a household; use separate files for separate households. The database and newly created data directory use owner-only permissions, and `.gitignore` excludes private data.

## Tools

| Area                | Tools                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Discover and search | `kooks_status`, `kooks_list`, `kooks_get`                                                                                  |
| Recipes             | `recipe_save`, `recipe_scale`, `quantity_convert`                                                                          |
| Meals and plan      | `meal_save`, `prepare_source`, `plan_save`                                                                                 |
| Shopping            | `shopping_create`, `shopping_preview`, `shopping_sync`, `shopping_remove_source`, `shopping_manual_item`, `shopping_check` |
| Equipment           | `equipment_save`                                                                                                           |
| Cooking             | `cooking_start`, `cooking_progress`, `cooking_timer`, `cooking_finish`                                                     |
| Notes and history   | `note_save`, `record_archive`, `history_list`, `history_undo`                                                              |
| Backup              | `backup_export`, `backup_restore`                                                                                          |
| Pantry and dinner   | `pantry_save`, `recipe_suggest`                                                                                            |
| Household           | `member_save`, `cooking_task_save` (timers also accept `member_id`)                                                        |
| Cooking memory      | `recipe_memory`, `recipe_variant_save`; `note_save` supports rating, changes, next-time notes and cook-again preference    |
| Cooked batches      | `batch_create`, `batch_allocate`, `batch_list`                                                                             |
| Costs and budgets   | `price_save`, `cost_estimate`, `budget_save`, `cost_week`                                                                  |
| Reviewed capture    | `recipe_parse`, `recipe_import_text`, `recipe_import_image`, `recipe_import_commit`                                        |

`kooks://workflow` provides the agent's workflow guide. Tool schemas are discoverable through MCP, with validation, descriptions, read/write annotations, and output schemas (results are open objects; writes carry `action_id` and `replayed`). `kooks_list` search matches the words in a record's values, not its field names.

## Ask the agent

Once connected, requests can look like:

- “Save this family recipe, keeping the original message and noting any missing quantities.”
- “Find recipes with chickpeas and scale this one to six servings.”
- “Combine the orzo for six and salad for four into a meal, and show the equipment I need.”
- “Plan that dinner for Friday, add its ingredients to my shopping list, and exclude the oil I already have.”
- “Start cooking dinner, remember each dish's step, and record that I used less salt.”
- “Attach the YouTube video and the written original to this recipe.”
- “Export my cookbook” or “Undo the last shopping change.”

The server starts empty; it does not seed demonstration recipes or import the user's WhatsApp archive. Pasted text and uploaded photos can create editable drafts through the import tools. Local photo recognition uses Apple Vision on macOS (command line tools required) or Tesseract elsewhere. Import commit requires `reviewed: true` and preserves the source image/text. The host can also supply structured recipes from other supported sources. Recipe text is data, never instructions granting the agent permissions.

## Action contract

Every write requires a `request_id`. Use a new key for each intended action; retry the exact same action and arguments with the same key to get its recorded result without performing it twice. Reusing a key with different arguments fails. A replay returns the original result; read the record again to obtain its current state.

Creates omit `id` and `expected_version`. Edits supply both, using the version from the latest read. `recipe_save`, `meal_save`, and `equipment_save` replace the full data object, so the agent must read and preserve fields it is not changing. Validation or stale-version failures roll back all changes. SQLite serializes writes across processes.

Writes return an `action_id`. `history_undo` restores an action's previous data only if its records have not changed since. Undoing creation archives the records. Active meal dependencies also block an invalid undo. Archive/undo retain records for recovery; neither permanently deletes data. History records successful actions and their before/after records; failed actions return errors without creating audit entries. Image bytes are not copied into history; an asset's history entry carries its SHA-256 and size.

For shopping, call `shopping_preview` first. Apply the exact same source, `source_key`, and exclusions to `shopping_sync`, adding the preview's token and `list_version` as `expected_version`. A source or list change invalidates the preview. The host can present the returned diff according to the user's chosen autonomy policy.

One `source_key` identifies one shopping occurrence: reuse it when updating that occurrence; choose another key for an additional dinner. Each dish retains its contributions. Names, preparation, and compatible units determine aggregation; no ingredient synonym guesses are made. Unknown quantities remain separate. Manual items survive recipe updates. Checkmarks survive unchanged purchasing requirements and reset when contributions or quantities change.

Meals reference current recipes. Scheduled occurrences and cooking sessions each store independent dish snapshots. Updating a recipe or reusable meal does not silently change an existing occurrence, shopping list, or session. Resave an occurrence or preview/sync a list explicitly to update it.

## Quantities, equipment, and timers

Original text, attribution, yield, and ingredient values remain on the recipe. A recipe's `links` (`url` plus optional `title`, HTTP or HTTPS only, up to 50) hold reference pages and videos; the household apps embed YouTube, Vimeo, Facebook, Instagram and TikTok players for them and open other links in the browser. The server stores and validates these addresses and never fetches them, so `recipe_save` must carry the existing `links` along with the rest of the data. Dish snapshots in plans and cooking sessions copy the links. Scaling produces a view; it does not rewrite the source or multiply times or temperatures. Amounts embedded in instruction prose remain unchanged, so the agent must use the scaled ingredient table when discussing them. A missing base yield blocks scaling; unspecified quantities stay null. Serving counts range from 0.01 to 10,000.

Known mass units normalize to grams and volume units to mL. Cup and spoon conversions require explicit conventions: `us_cup`, `us_tbsp`, `us_tsp`, `us_fl_oz`, `metric_cup` (250 mL), `metric_tbsp` (15 mL), and `metric_tsp` (5 mL). Bare `cup`, `tbsp`, or `tsp` values can be stored and combined with the same unit, but are not converted. Ingredient density is never inferred. These tool conventions do not settle the future application's regional unit preference.

Equipment overview matches names to inventory and shows dish uses, unknown availability, descriptive capacities, inferred requirements, and conditional overlaps or temperature conflicts. It does not infer capacity compatibility, optimize a schedule, or guarantee a serving time. An agent can propose an order from actual steps and durations, preserving dependencies and acknowledging unknowns.

Cooking progress uses zero-based step indices and independent dish tracks. Timers store UTC deadlines and survive restart. **This server does not deliver audible or background notifications.** The agent should use a device timer when an alarm is needed. Finishing a session cancels its remaining deadlines.

## Backup and boundaries

`backup_export` returns a versioned JSON object containing active and archived records, contributions, snapshots, and timer deadlines. Save the returned `backup` object to a file. `backup_restore` validates the data and restores only into an **empty database**; use another `KOOKS_DB_PATH` to verify a backup. Record IDs and versions are preserved. Action history is excluded from this portable export. For a full database backup including history, stop all MCP processes before copying the database and any WAL files, or use SQLite's backup tooling. Large exports remain subject to the connecting client's message-size limits. `kooks_get` returns an asset with its `base64` bytes as before; listings and the browser state carry only its name, type, SHA-256 and size. The database upgrades itself from schema 1 to 2 on first open, moving image bytes into a separate table; an older server refuses to open an upgraded file.

The MCP transport runs locally over stdio. A separate browser server (`npm run dev`) provides the household interface and an HTTP action API on loopback by default. Optional LAN access requires a shared household access key; individual accounts and cloud sync are not implemented. Neither entry point provides model-provider credentials, purchases, messages, public sharing, direct WhatsApp integration, or appliance control.

## Verification

`npm test` covers meal portions, equipment conflicts, compatible and ambiguous units, exclusions, shopping retries and checkmarks, stale previews, undo conflicts, persistent cooking progress and deadlines, complete export/restore, invalid input, competing database connections, and a real MCP client that discovers tools and reconnects to persisted data. Tests use isolated temporary databases.
