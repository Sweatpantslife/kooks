import { CircleAlert, CloudOff } from "lucide";
import { offline, waitingHere } from "../lib/store.js";
import { needsChoice, sizeOf } from "../lib/waiting.js";
import { route } from "../lib/router.js";
import { localDay, pastDayLabel, plural } from "../lib/format.js";
import { Icon } from "./icon.jsx";

// When the kitchen does not answer, every page says so and since when, so
// nobody takes what they see for this minute's list, and how much made here
// waits to be sent. When it answers again, a change it would not take stays
// in view until the member decides what becomes of it.
export function Offline() {
  const since = offline.value;
  const entries = waitingHere.value;
  const there = route.value[0] === "waiting";
  if (since == null) {
    if (there) return null;
    const choosing = entries.filter(needsChoice);
    const refused = entries.filter((e) => e.problem && !needsChoice(e));
    if (!choosing.length && !refused.length) return null;
    return (
      <p class="offline" role="status">
        <Icon icon={CircleAlert} />
        <span>
          {choosing.length > 0 && (
            <>
              <strong>
                {choosing.length === 1
                  ? "An edit made here met a change in the kitchen."
                  : `${choosing.length} edits made here met changes in the kitchen.`}
              </strong>{" "}
              <a
                href={
                  choosing.length === 1
                    ? `#/waiting/${encodeURIComponent(choosing[0].id)}`
                    : "#/waiting"
                }
              >
                Choose what to keep
              </a>
              {refused.length > 0 && " "}
            </>
          )}
          {refused.length > 0 && (
            <>
              <strong>
                The kitchen didn’t take {plural(refused.length, "change")} made
                here.
              </strong>{" "}
              <a href="#/waiting">See why</a>
            </>
          )}
        </span>
      </p>
    );
  }
  const when = new Date(since);
  const time = when.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const day = localDay(when);
  const at = day === localDay() ? time : `${pastDayLabel(day)}, ${time}`;
  const count = entries.reduce((n, entry) => n + sizeOf(entry), 0);
  return (
    <p class="offline" role="status">
      <Icon icon={CloudOff} />
      <span>
        <strong>Can’t reach the kitchen.</strong> This is how it was at {at}.
        {count > 0 &&
          (there ? (
            ` ${plural(count, "change")} made here will go when it answers.`
          ) : (
            <>
              {" "}
              <a href="#/waiting">
                {plural(count, "change")} made here will go when it answers.
              </a>
            </>
          ))}
      </span>
    </p>
  );
}
