// Claude, played from a script: each call takes the next reply, or throws
// it, and keeps what it was sent.
export function fakeClaude(script) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        async create(params, options) {
          calls.push({ params: structuredClone(params), options });
          const next = script.shift();
          if (!next) throw new Error("The script ran out.");
          if (next instanceof Error) throw next;
          return typeof next === "function" ? next(params, options) : next;
        },
      },
    },
  };
}
export const usage = { input_tokens: 1000, output_tokens: 200 };
export const says = (text, extra = {}) => ({
  stop_reason: "end_turn",
  content: [
    { type: "thinking", thinking: "", signature: "s" },
    { type: "text", text },
  ],
  usage,
  ...extra,
});
export const uses = (...blocks) => ({
  stop_reason: "tool_use",
  content: [
    { type: "thinking", thinking: "", signature: "s" },
    ...blocks.map(([name, input], i) => ({
      type: "tool_use",
      id: `use-${name}-${i}`,
      name,
      input,
    })),
  ],
  usage,
});
