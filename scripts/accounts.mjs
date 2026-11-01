// Accounts on the computer that keeps the kitchen, for whoever runs it, from
// its terminal while the server keeps running (see docs/recovery.md):
//
//   node scripts/accounts.mjs list                 households, members, roles
//   node scripts/accounts.mjs link <address>       print a sign-in link
//   node scripts/accounts.mjs owner <address> [--household <id>]
//                                                  make an address an owner
//   node scripts/accounts.mjs remove <address> [--leave-empty]
//                                                  delete an address's account
//
// link is for an owner whose sign-in email doesn't arrive or whose mailbox
// is gone. The link works once, for 15 minutes, and signs in whichever
// device opens it as that address, so it goes to this terminal only. owner
// gives an address an account if it has none and makes it an owner of the
// first household, or of the one --household names; it signs nobody in.
// remove deletes an account with its passkeys, sessions, invitations and
// memberships, for an old address whose mailbox may be someone else's now:
// taking it out of a household under Members leaves it an account that can
// still sign in and start a household of its own. It keeps a household's
// last owner, and the KOOKS_OWNER_EMAIL address, which the server would give
// a new account at its next start. A household the address alone is in, one
// someone else started with it say, stops it too, unless --leave-empty says
// to leave that household with nobody in it; owner --household gives it an
// owner again.
// KOOKS_DB_PATH selects the database and KOOKS_PUBLIC_ORIGIN the address
// links point at, as for the server.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KooksError } from "../mcp/store.js";
import { createAuth, HOME, normalizeEmail } from "../web/auth.js";

const usage =
  "Usage: node scripts/accounts.mjs list | link <address> | owner <address> [--household <id>] | remove <address> [--leave-empty]";
const [mode, ...given] = process.argv.slice(2);
const leaveEmpty = given.includes("--leave-empty");
const rest = given.filter((arg) => arg !== "--leave-empty");
const at = rest.indexOf("--household");
const household = at === -1 ? HOME : rest[at + 1];
const [address, ...extra] = rest.filter(
  (arg, i) => at === -1 || (i !== at && i !== at + 1),
);
if (
  !["list", "link", "owner", "remove"].includes(mode) ||
  (mode === "list" ? address : !address) ||
  extra.length ||
  (at !== -1 && (mode !== "owner" || !household)) ||
  (leaveEmpty && mode !== "remove")
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
  remove: "delete the account",
}[mode];
try {
  const owner = normalizeEmail(process.env.KOOKS_OWNER_EMAIL ?? "");
  if (mode === "list") {
    const { households, unhoused } = auth.roster();
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
  } else if (mode === "remove") {
    if (owner && normalizeEmail(address) === owner)
      throw new KooksError(
        "INVALID_INPUT",
        `${owner} is KOOKS_OWNER_EMAIL, and the server gives it a new account at every start. Set KOOKS_OWNER_EMAIL to the new address in Coolify and redeploy first.`,
      );
    let gone;
    try {
      gone = auth.deleteAccount(address, { leaveEmpty });
    } catch (error) {
      if (error.code === "LAST_MEMBER")
        error.message += ` Make another address an owner of it first (\`node scripts/accounts.mjs owner <address> --household <id>\`), or add --leave-empty to leave it with nobody in it.`;
      if (error.code === "LAST_OWNER")
        error.message += ` \`node scripts/accounts.mjs owner <address> --household <id>\` makes one.`;
      throw error;
    }
    const count = (n, what) => `${n} ${what}${n === 1 ? "" : "s"}`;
    const names = gone.households.map((h) => h.name).join(", ");
    console.log(
      `${gone.email} has no account any more. ${names ? `It was in ${names}` : "It was in no household"}; ${count(gone.passkeys, "passkey")}, ${count(gone.sessions, "signed-in device")} and ${count(gone.invites, "invitation")} went with it. Its devices are signed out at their next request.`,
    );
    for (const h of gone.households.filter((h) => h.empty))
      console.log(
        `${h.name} (${h.id}) has nobody in it now. \`node scripts/accounts.mjs owner <address> --household ${h.id}\` gives it an owner again.`,
      );
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
