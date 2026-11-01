import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createAuth } from "../web/auth.js";

const script = fileURLToPath(
  new URL("../scripts/accounts.mjs", import.meta.url),
);
const quiet = { send: async () => {} };

// A server's database with Ada owning the first household and Ben in it,
// Ada's second household, and Cy, who has an account and no household.
function kitchen(t) {
  const dir = mkdtempSync(join(tmpdir(), "kooks-accounts-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "kooks.sqlite");
  const auth = createAuth({
    path,
    mailer: quiet,
    owner: "ada@example.com",
    members: ["ben@example.com"],
  });
  const ada = auth.session(auth.createSession("ada@example.com", "link"));
  const cabin = auth.createHousehold(ada, "Cabin");
  auth.createSession("cy@example.com", "link");
  auth.close();
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        KOOKS_DB_PATH: path,
        KOOKS_OWNER_EMAIL: "Ada@example.com",
        KOOKS_PUBLIC_ORIGIN: "https://kooks.example.com",
      },
    });
  return { dir, path, cabin, run };
}

test("the accounts script lists every household's members with their roles", (t) => {
  const { cabin, run } = kitchen(t);
  const listed = run("list");
  assert.equal(listed.status, 0, listed.stderr);
  const lines = listed.stdout.trim().split("\n");
  assert.equal(lines[0], "Our kitchen (home), 2 members");
  assert.match(
    lines[1],
    /^ {2}owner {3}ada@example\.com \(KOOKS_OWNER_EMAIL\): joined .+, last signed in .+, 0 passkeys$/,
  );
  assert.match(
    lines[2],
    /^ {2}member {2}ben@example\.com: .*last signed in never/,
  );
  assert.equal(lines[3], `Cabin (${cabin}), 1 member`);
  assert.match(lines[4], /^ {2}owner {3}ada@example\.com/);
  assert.equal(lines[5], "In no household: cy@example.com");
});

test("a sign-in link from the terminal works once, for an address with an account only", (t) => {
  const { path, run } = kitchen(t);
  const made = run("link", "BEN@example.com");
  assert.equal(made.status, 0, made.stderr);
  assert.match(made.stderr, /works once, in the next 15 minutes/);
  const link = made.stdout.trim();
  assert.match(link, /^https:\/\/kooks\.example\.com\/#\/signin\/[\w-]{43}$/);
  const token = link.split("/").pop();
  const auth = createAuth({ path, mailer: quiet });
  t.after(() => auth.close());
  assert.deepEqual(
    { ...auth.confirmLink(token) },
    { email: "ben@example.com", app: false },
  );
  assert.throws(() => auth.confirmLink(token), { code: "LINK_INVALID" });

  const stranger = run("link", "eve@example.com");
  assert.equal(stranger.status, 1);
  assert.equal(stranger.stdout, "");
  assert.match(
    stranger.stderr,
    /^Kooks could not make a sign-in link: eve@example\.com has no account\./,
  );
});

test("the accounts script makes an address an owner, with an account if need be", (t) => {
  const { path, cabin, run } = kitchen(t);
  const promoted = run("owner", "ben@example.com");
  assert.equal(promoted.status, 0, promoted.stderr);
  assert.match(
    promoted.stdout,
    /^ben@example\.com is now an owner of Our kitchen, having been a member\./,
  );
  const added = run("owner", "dee@example.com", "--household", cabin);
  assert.match(
    added.stdout,
    /^dee@example\.com is now an owner of Cabin, with a new account\./,
  );
  assert.equal(
    run("owner", "ada@example.com").stdout.trim(),
    "ada@example.com was already an owner of Our kitchen.",
  );

  const auth = createAuth({ path, mailer: quiet });
  t.after(() => auth.close());
  const roles = Object.fromEntries(
    auth
      .roster()
      .households.map((h) => [h.name, h.members.map((m) => [m.email, m.role])]),
  );
  assert.deepEqual(roles, {
    "Our kitchen": [
      ["ada@example.com", "owner"],
      ["ben@example.com", "owner"],
    ],
    Cabin: [
      ["ada@example.com", "owner"],
      ["dee@example.com", "owner"],
    ],
  });
  // Nobody was signed in by it.
  assert.equal(auth.sessions("dee@example.com").length, 0);

  const nowhere = run("owner", "ben@example.com", "--household", "nope");
  assert.equal(nowhere.status, 1);
  assert.match(nowhere.stderr, /There is no household nope\./);
  assert.equal(run("owner", "not an address").status, 1);
});

test("the accounts script refuses a wrong database path or a wrong command", (t) => {
  const { dir, run } = kitchen(t);
  const missing = join(dir, "elsewhere.sqlite");
  const wrong = spawnSync(process.execPath, [script, "list"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, KOOKS_DB_PATH: missing },
  });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /There is no Kooks database at/);
  assert.equal(existsSync(missing), false);
  for (const args of [
    [],
    ["link"],
    ["list", "extra"],
    ["link", "ben@example.com", "--household", "home"],
    ["owner", "ben@example.com", "--household"],
  ])
    assert.equal(run(...args).status, 2, args.join(" "));
});

test("the accounts script deletes an old address's account and everything that signs it in", async (t) => {
  const { path, run } = kitchen(t);
  let auth = createAuth({ path, mailer: quiet });
  const benToken = auth.createSession("ben@example.com", "link");
  const ben = auth.session(benToken);
  const ada = auth.session(auth.createSession("ada@example.com", "link"));
  const origin = "https://kooks.example.com";
  await auth.invite(ben, { email: "dee@example.com", origin });
  await auth.invite(ada, { email: "cy@example.com", origin });
  // Cy starts a household of their own, as whoever holds a lost mailbox can.
  const takeover = auth.createHousehold(
    auth.session(auth.createSession("cy@example.com", "link")),
    "Takeover",
  );
  auth.close();

  const gone = run("remove", "Ben@example.com");
  assert.equal(gone.status, 0, gone.stderr);
  assert.equal(
    gone.stdout.trim(),
    "ben@example.com has no account any more. It was in Our kitchen; 0 passkeys, 1 signed-in device and 1 invitation went with it. Its devices are signed out at their next request.",
  );
  // A household only Cy is in stops it, unless it may be left empty.
  const alone = run("remove", "cy@example.com");
  assert.equal(alone.status, 1);
  assert.match(
    alone.stderr,
    new RegExp(
      `only member of Takeover \\(${takeover}\\), so nobody could open it again\\. Make another address an owner of it first .*, or add --leave-empty`,
    ),
  );
  const emptied = run("remove", "cy@example.com", "--leave-empty");
  assert.equal(emptied.status, 0, emptied.stderr);
  assert.deepEqual(emptied.stdout.trim().split("\n"), [
    "cy@example.com has no account any more. It was in Takeover; 0 passkeys, 2 signed-in devices and 1 invitation went with it. Its devices are signed out at their next request.",
    `Takeover (${takeover}) has nobody in it now. \`node scripts/accounts.mjs owner <address> --household ${takeover}\` gives it an owner again.`,
  ]);
  // Nothing is left that signs either in, or names them.
  assert.equal(run("link", "ben@example.com").status, 1);
  auth = createAuth({ path, mailer: quiet });
  t.after(() => auth.close());
  assert.equal(auth.session(benToken), null);
  assert.deepEqual(
    auth.roster().households.map((h) => h.members.map((m) => m.email)),
    [["ada@example.com"], ["ada@example.com"], []],
  );
  assert.deepEqual(auth.roster().unhoused, []);
  assert.equal(auth.members(ada).invites.length, 0);
  assert.equal(run("remove", "ben@example.com").status, 1);
  assert.equal(run("link", "ada@example.com", "--leave-empty").status, 2);

  // KOOKS_OWNER_EMAIL would come back at the next start.
  const kept = run("remove", "ada@example.com");
  assert.equal(kept.status, 1);
  assert.match(kept.stderr, /is KOOKS_OWNER_EMAIL/);
});

test("deleting an account keeps a household's last owner, and its last member unless told", (t) => {
  const { path, cabin } = kitchen(t);
  const auth = createAuth({ path, mailer: quiet });
  t.after(() => auth.close());
  // Ada owns Our kitchen, where Ben is a member, and is alone in Cabin.
  for (const leaveEmpty of [false, true])
    assert.throws(() => auth.deleteAccount("ada@example.com", { leaveEmpty }), {
      code: "LAST_OWNER",
      message: /only owner of Our kitchen \(home\)/,
    });
  auth.grantOwner("ben@example.com");
  assert.throws(() => auth.deleteAccount("ada@example.com"), {
    code: "LAST_MEMBER",
    message: new RegExp(`only member of Cabin \\(${cabin}\\)`),
  });
  assert.deepEqual(
    auth.deleteAccount("ada@example.com", { leaveEmpty: true }).households,
    [
      { id: "home", name: "Our kitchen", empty: false },
      { id: cabin, name: "Cabin", empty: true },
    ],
  );
  // The household left empty can be given an owner again.
  auth.grantOwner("dee@example.com", cabin);
  assert.deepEqual(
    auth.roster().households.map((h) => h.members.map((m) => m.email)),
    [["ben@example.com"], ["dee@example.com"]],
  );
  // No table keeps the address, not even as who made a household.
  const db = new DatabaseSync(path, { readOnly: true });
  t.after(() => db.close());
  for (const { name } of db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all())
    assert.doesNotMatch(
      JSON.stringify(db.prepare(`SELECT * FROM ${name}`).all()),
      /ada@example\.com/,
      name,
    );
  assert.throws(() => auth.deleteAccount("nobody"), { code: "INVALID_INPUT" });
});
