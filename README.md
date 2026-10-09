# Kooks

A household cooking companion for recipes, composed meals, shopping, equipment, and guided cooking. This repository contains the local browser application, MCP backend, and Capacitor iOS/Android application.

**Start here: [Developer handoff and unfinished work](docs/handoff.md).** The project is implemented for local use but is not release-ready. Native device validation, live AI/provider login, cloud sync, and mobile/backend integration remain outstanding.

## Quick start

Use Node.js 22.13 or newer and npm.

```sh
npm ci
npm test
npm run dev
```

`npm run test:e2e` runs the Playwright suites for both interfaces (run `npx playwright install chromium` once), and `npm run format:check` enforces the shared Prettier style; the GitHub Actions workflow runs all of these on every push.

Open `http://127.0.0.1:4317` for the persistent browser app. It starts with an empty cookbook and shares SQLite storage with the MCP server. Features include recipe capture/editing, meal composition, shopping, cooking sessions, pantry suggestions, leftovers, cooking memories, taste profiles, shared tasks, costs, reviewed photo imports, recipe links with embedded YouTube, Vimeo, Facebook, Instagram and TikTok players that load only when you press play, a place for techniques and inspiration with the same click-to-play videos, and a library of your own PDF and EPUB cookbooks with bookmarks and an in-page PDF reader.

For the separate mobile interface:

```sh
npm run dev:mobile
```

Open `http://127.0.0.1:5173`. This interface uses IndexedDB in a browser and device-local files when packaged natively. Its six example recipes are synthetic demonstration data. It does **not** share the browser/MCP cookbook or automatically include all household additions.

## Native projects

```sh
npm run cap:sync
npm run native:doctor
npm run cap:ios
npm run cap:android
```

Native compilation requires Xcode or the Android toolchain. The projects include storage, notifications, sharing, haptics, icons, and launch screens, but native execution and physical-device notification behavior still need verification. See [native setup and limits](docs/native-app.md).

## Agent integration

Connect an MCP client to `node /absolute/path/to/kooks/mcp/index.js`; adapt [the example configuration](mcp-config.example.json). The backend exposes 47 validated tools with persistent storage, request deduplication, optimistic versions, undo, and backup/restore. The host agent supplies intelligence; Kooks has no built-in model-provider connection. See [MCP setup and workflows](docs/mcp-server.md).

## Data and privacy

The local server stores its cookbook in `.data/kooks.sqlite`; `KOOKS_DB_PATH` selects another location. The native app stores its own cookbook in its private app directory. Keep personal recipes, photos, exports, credentials, and logs outside version control. `.gitignore` excludes local data, configuration, backups, signing material, dependencies, and generated build outputs.

The browser server binds to loopback by default and asks nobody to sign in. Sharing it beyond this computer turns sign-in on: the people listed in `KOOKS_HOUSEHOLD_EMAILS` prove their address with a one-time emailed link and then add passkeys for one-tap sign-in. See [household setup](docs/household-features.md) and [hosting](docs/hosting.md). Publishing this source repository does not deploy a running service.

## Code layout

`mcp/` holds the SQLite store, domain rules and MCP tools (`mcp/library*.js` for techniques, inspiration and the book shelf); `web/` the browser server and client, with sign-in in `web/auth.js`, passkey verification in `web/webauthn.js` and mail in `web/mail.js`; `app/` the Capacitor mobile app; `shared/` the unit table, the ingredient tokenizer that both parsers build on, and the link module that recognises video players for both apps. `test/` holds the Node unit and integration tests plus the Playwright projects in `test/mobile-e2e`, `test/web-e2e` and `test/web-auth-e2e`.

## Documentation

| Guide                                                          | Purpose                                                                            |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [Developer handoff](docs/handoff.md)                           | Verified status, remaining work, entry points, next steps, and acceptance criteria |
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
