# Kooks

A household cooking companion for recipes, composed meals, shopping, equipment, and guided cooking. This repository contains the household server with its app, the MCP backend, and the same app packaged for iOS and Android with Capacitor.

**Start here: [Developer handoff and unfinished work](docs/handoff.md).** The project is implemented for local use but is not release-ready. Native device validation remains outstanding, and the built-in assistant has not yet been tried by real households.

## Quick start

Use Node.js 22.13 or newer and npm.

```sh
npm ci
npm test
npm run build:client
npm run dev
```

`npm run test:e2e` runs the Playwright suite (run `npx playwright install chromium` once), `npm run format:check` enforces the shared Prettier style, and `npm run lint` runs ESLint's recommended rules; the GitHub Actions workflow runs all of these on Node 22 and 24 for every pull request and every push to `main`.

Open `http://127.0.0.1:4317` for the browser app. It starts with an empty cookbook and shares SQLite storage with the MCP server. It plans the week, keeps recipes (read from a link, pasted, photographed or written, with courses, cuisines, diet labels and tags), meals, ideas to try, techniques and a shelf of your own PDF and EPUB cookbooks, builds the grocery list by aisle and keeps track of what is at home, cooks one step at a time with timers, notes and leftovers, and knows the people at the table, the prices paid and the weekly budget. Recipe links and videos open in a new tab.

The browser app has three tabs, Week, Recipes and Groceries, with Household behind the household's initials, and cooking as a full-screen mode. It was redesigned from scratch in October 2026; [Information architecture and experience design](docs/ia-ux.md) is the design authority, and the previous app's bookmarks open the pages that replaced them. The phone app is the same app.

### Working on the browser app

The app lives in `client/` (Preact and Vite). `npm run build:client` builds it into `client/dist`, which the server shows at `/`; `npm run dev:client` serves it with live reload at `http://127.0.0.1:5174`, sending `/api` to the server on port 4317 (`KOOKS_API` points elsewhere). Addresses under `/next/`, where it was tried out before it replaced the previous app, lead to `/`.

## Native projects

```sh
npm run cap:sync
npm run native:doctor
npm run cap:ios
npm run cap:android
```

`npm run cap:sync` builds the app in `client/` and copies it into both projects. On a phone it signs in to the household's kitchen with an emailed link confirmed on any device, rings cooking timers as notifications, hands books and backups to the share sheet, and offers to bring in the recipes the previous phone app kept. Native compilation requires Xcode or the Android toolchain, and native execution and physical-device notification behavior still need verification. See [native setup and limits](docs/native-app.md).

## Agent integration

Connect an MCP client to `node /absolute/path/to/kooks/mcp/index.js`; adapt [the example configuration](mcp-config.example.json). The backend exposes 49 validated tools with persistent storage, request deduplication, optimistic versions, undo, and backup/restore. The host agent supplies intelligence. Separately, the household server can run its own assistant, Ask Kooks, with a Claude API key ([hosting](docs/hosting.md#the-assistant)). See [MCP setup and workflows](docs/mcp-server.md).

## Data and privacy

The local server stores its cookbook in `.data/kooks.sqlite`; `KOOKS_DB_PATH` selects another location. Keep personal recipes, photos, exports, credentials, and logs outside version control. `.gitignore` excludes local data, configuration, backups, signing material, dependencies, and generated build outputs.

The browser server binds to loopback by default and asks nobody to sign in. Sharing it beyond this computer turns sign-in on: people have accounts, belong to households that each keep their own cookbook, and join by emailed invitation; they sign in with a one-time emailed link or a passkey. `KOOKS_OWNER_EMAIL` names the first person. See [household setup](docs/household-features.md) and [hosting](docs/hosting.md); [.env.example](.env.example) lists every setting the servers read, with its default. Publishing this source repository does not deploy a running service.

Nothing goes to a model provider unless the host sets `KOOKS_ANTHROPIC_API_KEY`. Then Ask Kooks sends each question, and the records it reads to answer it, to Anthropic; [SECURITY.md](SECURITY.md) lists what it reads and its limits.

## Code layout

`mcp/` holds the SQLite store, domain rules and MCP tools (`mcp/library*.js` for techniques, inspiration and the book shelf); `web/` the server, with sign-in in `web/auth.js`, passkey verification in `web/webauthn.js` and mail in `web/mail.js`; `client/` the app, in browsers and on phones (see [Working on the browser app](#working-on-the-browser-app)); `ios/` and `android/` the native projects that package it; `shared/` what the app and the server share: the unit table, the ingredient tokenizer that both parsers build on, the link module that recognises video players, and the recipe facet taxonomy (courses, diet labels, cuisine and tag matching). `test/` holds the Node unit and integration tests plus the Playwright suite in `test/web-e2e`.

## Documentation

| Guide                                                          | Purpose                                                                            |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [Developer handoff](docs/handoff.md)                           | Verified status, remaining work, entry points, next steps, and acceptance criteria |
| [Changelog](CHANGELOG.md)                                      | What changed and how each change was verified                                      |
| [Contributing](CONTRIBUTING.md)                                | Setup, checks, conventions and dependencies for changes                            |
| [Security policy](SECURITY.md)                                 | How to report a vulnerability privately, and what is in scope                      |
| [Information architecture and UX](docs/ia-ux.md)               | Navigation, routes, pages, flows, components, copy and accessibility               |
| [Current decisions](docs/decisions.md)                         | Selected architecture and unresolved product decisions                             |
| [Household features](docs/household-features.md)               | All eight additions, local sharing, OCR, and backups                               |
| [Native app](docs/native-app.md)                               | Capacitor setup, storage, testing, and device limitations                          |
| [MCP server](docs/mcp-server.md)                               | Tools, action contracts, and agent configuration                                   |
| [Research](docs/archive/research.md)                           | Historical comparisons and technical research                                      |
| [Project plan](docs/archive/project-plan.md)                   | Historical phased proposal and acceptance examples                                 |
| [Product brief](docs/archive/product-brief.md)                 | Original experience and prototype design                                           |
| [Prototype review](docs/archive/prototype-review.md)           | Historical interaction checks                                                      |
| [Meals, equipment, and assistant](docs/meals-equipment-byk.md) | Detailed design rationale                                                          |
| [AI connections](docs/archive/ai-connections.md)               | Historical integration research; recheck before implementation                     |

The handoff and current implementation guides take precedence over older phase labels. No production hosting, store distribution, or live AI service is configured by this repository.

## License

Kooks is free software under the GNU Affero General Public License, version 3 only. Copyright (C) 2026 Sweatpantslife. See [LICENSE](LICENSE) for the full text. If you modify Kooks and let other people use it over a network, the AGPL requires you to offer them the corresponding source code.
