// How much of a conversation the assistant hears with each question. The
// server refuses more, and the app sends the latest turns that fit, so a long
// conversation forgets its start rather than failing. A conversation it hears
// starts and ends with the member.

export const conversationTurns = 39;
export const conversationCharacters = 60000;

// turns: [{ role: "user" | "assistant", text }], oldest first, ending with
// the member's question.
export function fitting(turns) {
  const kept = turns.slice(-conversationTurns);
  let size = kept.reduce((sum, turn) => sum + turn.text.length, 0);
  while (
    kept.length > 1 &&
    (kept[0].role === "assistant" || size > conversationCharacters)
  )
    size -= kept.shift().text.length;
  return kept;
}
