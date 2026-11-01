import test from "node:test";
import assert from "node:assert/strict";
import {
  markdown,
  questions,
  runTrial,
  scriptedClient,
  usageOf,
} from "../scripts/assistant-trial.mjs";

// The trial runs against the real API only by hand, with the owner's key.
// These check the trial itself: its kitchen, its checks and its arithmetic.

test("every trial question's expected answer passes its checks in the trial's kitchen", async () => {
  const report = await runTrial({ client: scriptedClient(), scripted: true });
  assert.ok(questions.length >= 20);
  assert.equal(report.asked, questions.length);
  assert.deepEqual(
    report.results.filter((r) => !r.ok).map((r) => [r.id, r.error, r.checks]),
    [],
  );
  // Each scripted call uses 600 input, 1,500 cache-write, 8,000 cache-read
  // and 250 output tokens of claude-opus-5-5.
  const one = (600 * 4 + 1500 * 5 + 8000 * 0.2 + 250 * 20) / 1e6;
  const tonight = report.results.find((r) => r.id === "tonight");
  assert.equal(tonight.model_calls, 2);
  assert.ok(Math.abs(tonight.cost - 2 * one) < 1e-12);
  assert.equal(tonight.allowance, 2 * (600 + 1500 + 250 + 800));
  assert.deepEqual(tonight.models, ["claude-opus-5-5"]);
  assert.match(markdown(report), /\*\*Scripted run\*\*/);
  assert.match(markdown(report), /\| What's for dinner tonight\? \| ✓ 2\/2 \|/);
});

test("the checks catch an assistant that answers nothing useful", async () => {
  // Every question gets the same shrug, and no proposal.
  const shrug = {
    beta: {
      messages: {
        create: async () => ({
          model: "claude-opus-5-5",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "I’m not sure." }],
          usage: { input_tokens: 100, output_tokens: 10 },
        }),
      },
    },
  };
  const report = await runTrial({ client: shrug, scripted: false });
  const failed = report.results.filter((r) => !r.ok).map((r) => r.id);
  for (const id of ["tonight", "plan-thursday", "allergy", "add-groceries"])
    assert.ok(failed.includes(id), `${id} fails`);
  // Questions whose only demand is restraint pass: nothing was proposed.
  assert.ok(!failed.includes("injection"));
});

test("the trial stops at its spending cap before the next model call", async () => {
  let calls = 0;
  const pricey = {
    beta: {
      messages: {
        async create() {
          calls++;
          return {
            model: "claude-opus-5-5",
            stop_reason: "tool_use",
            content: [
              {
                type: "tool_use",
                id: `u${calls}`,
                name: "kooks_list",
                input: { kind: "plan" },
              },
            ],
            // $0.40 a call.
            usage: { input_tokens: 100000, output_tokens: 0 },
          };
        },
      },
    },
  };
  const report = await runTrial({ client: pricey, maxUsd: 1 });
  assert.equal(calls, 3);
  assert.equal(report.results[0].error, "stopped at the spending cap");
  assert.equal(report.asked, 1);
  assert.equal(report.skipped, questions.length - 1);
  assert.ok(Math.abs(report.cost - 1.2) < 1e-9);
  assert.match(markdown(report), /skipped at the spending cap/);
});

test("a fallback is priced at the model that ran it, and an unknown model at the dearest rates", () => {
  const attempts = usageOf(
    {
      model: "claude-opus-5",
      usage: {
        input_tokens: 10,
        output_tokens: 10,
        iterations: [
          { type: "message", input_tokens: 1000000, output_tokens: 0 },
          {
            type: "fallback_message",
            input_tokens: 1000000,
            output_tokens: 1000000,
            cache_read_input_tokens: 1000000,
          },
        ],
      },
    },
    "claude-opus-5-5",
  );
  assert.deepEqual(
    attempts.map((a) => [a.model, a.cost]),
    [
      ["claude-opus-5-5", 4],
      ["claude-opus-5", 5 + 25 + 0.5],
    ],
  );
  const [unknown] = usageOf(
    { model: "claude-someday", usage: { input_tokens: 1000000 } },
    "claude-someday",
  );
  assert.equal(unknown.priced, false);
  assert.equal(unknown.cost, 10);
});
