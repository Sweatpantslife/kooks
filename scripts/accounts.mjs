// Accounts on the computer that keeps the kitchen, for whoever runs it, from
// its terminal while the server keeps running (see docs/recovery.md):
//
//   node scripts/accounts.mjs list                 households, members, roles
//   node scripts/accounts.mjs link <address>       print a sign-in link
//   node scripts/accounts.mjs owner <address> [--household <id>]
//                                                  make an address an owner
//
// link is for an owner whose sign-in email doesn't arrive or whose mailbox
// is gone. The link works once, for 15 minutes, and signs in whichever
// device opens it as that address, so it goes to this terminal only. owner
// gives an address an account if it has none and makes it an owner of the
// first household, or of the one --household names; it signs nobody in.
// KOOKS_DB_PATH selects the database and KOOKS_PUBLIC_ORIGIN the address
// links point at, as for the server.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KooksError } from "../mcp/store.js";
import { createAuth, HOME, normalizeEmail } from "../web/auth.js";

const usage =
  "Usage: node scripts/accounts.mjs list | link <address> | owner <address> [--household <id>]";
const [mode, ...rest] = process.argv.slice(2);
const at = rest.indexOf("--household");
const household = at === -1 ? HOME : rest[at + 1];
const [address, ...extra] = rest.filter(
  (arg, i) => at === -1 || (i !== at && i !== at + 1),
);
if (
  !["list", "link", "owner"].includes(mode) ||
  (mode === "list" ? address : !address) ||
  extra.length ||
  (at !== -1 && (mode !== "owner" || !household))
) {
  console.error(usage);
  process.exit(2);
}
const dbPath = process.env.KOOKS_DB_PATH
  ? resolve(process.env.KOOKS_DB_PATH)
  : fileURLToPath(new URL("../.data/kooks.sqlite", import.meta.url));
if (!existsSync(dbPath)) {
  console.error(
    `There is no Kooks database at ${dbPath}. Set KOOKS_DB_PATH to the server's, as in its environment.`,
  );
  process.exit(1);
}
const day = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium" })
    : "never";

// The link is caught here rather than emailed.
let message = null;
const auth = createAuth({
  path: dbPath,
  mailer: {
    async send(sent) {
      message = sent;
    },
  },
});
const doing = {
  list: "list the accounts",
  link: "make a sign-in link",
  owner: "make an owner",
}[mode];
try {
  if (mode === "list") {
    const { households, unhoused } = auth.roster();
    const owner = normalizeEmail(process.env.KOOKS_OWNER_EMAIL ?? "");
    for (const h of households) {
      console.log(
        `${h.name} (${h.id}), ${h.members.length} member${h.members.length === 1 ? "" : "s"}`,
      );
      for (const m of h.members)
        console.log(
          `  ${m.role.padEnd(6)}  ${m.email}${m.email === owner ? " (KOOKS_OWNER_EMAIL)" : ""}: joined ${day(m.joined_at)}, last signed in ${day(m.signed_in_at)}, ${m.passkeys} passkey${m.passkeys === 1 ? "" : "s"}`,
        );
    }
    if (unhoused.length)
      console.log(
        `In no household: ${unhoused.map((a) => a.email).join(", ")}`,
      );
    if (!households.length && !unhoused.length)
      console.log("Nobody has an account yet.");
  } else if (mode === "link") {
    const origin =
      process.env.KOOKS_PUBLIC_ORIGIN ||
      `http://127.0.0.1:${process.env.PORT || 4317}`;
    if (!(await auth.requestLink({ email: address, origin })))
      throw new KooksError(
        "NOT_FOUND",
        `${address} has no account. \`node scripts/accounts.mjs list\` shows who has one.`,
      );
    const [link] = message.text.match(/\S+#\/signin\/\S+/);
    console.error(
      `A sign-in link for ${message.to}. It works once, in the next 15 minutes, and signs in whichever device opens it as ${message.to}: open it yourself, and paste it nowhere else.`,
    );
    console.log(link);
  } else {
    const result = auth.grantOwner(address, household);
    console.log(
      result.was === "owner"
        ? `${result.email} was already an owner of ${result.name}.`
        : `${result.email} is now an owner of ${result.name}${result.was ? ", having been a member" : ""}${result.created ? ", with a new account" : ""}. They sign in with an emailed link or \`node scripts/accounts.mjs link ${result.email}\`.`,
    );
  }
} catch (error) {
  if (!(error instanceof KooksError)) throw error;
  console.error(`Kooks could not ${doing}: ${error.message}`);
  process.exitCode = 1;
} finally {
  auth.close();
}
