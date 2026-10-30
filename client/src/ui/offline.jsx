import { CloudOff } from "lucide";
import { offline } from "../lib/store.js";
import { waitingCount } from "../lib/outbox.js";
import { localDay, pastDayLabel, plural } from "../lib/format.js";
import { Icon } from "./icon.jsx";

// When the kitchen does not answer, every page says so and since when, so
// nobody takes what they see for this minute's list.
export function Offline() {
  const since = offline.value;
  if (since == null) return null;
  const when = new Date(since);
  const time = when.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const day = localDay(when);
  const at = day === localDay() ? time : `${pastDayLabel(day)}, ${time}`;
  const ticks = waitingCount();
  return (
    <p class="offline" role="status">
      <Icon icon={CloudOff} />
      <span>
        <strong>Can’t reach the kitchen.</strong> This is how it was at {at}.
        {ticks > 0 &&
          ` ${plural(ticks, "tick")} on the grocery list will go when it answers.`}
      </span>
    </p>
  );
}
