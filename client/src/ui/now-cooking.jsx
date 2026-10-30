import { Flame } from "lucide";
import {
  activeSessions,
  clock,
  liveTimers,
  secondsLeft,
  useNow,
} from "../lib/cooking.js";
import { route } from "../lib/router.js";
import { Icon } from "./icon.jsx";

// What is on the stove, from any page: the dish and its step, or the timer
// that runs out first. One tap goes back to cooking.
export function NowCooking() {
  const sessions = activeSessions();
  const session = sessions[0];
  const timers = liveTimers(session).sort((a, b) =>
    a.deadline.localeCompare(b.deadline),
  );
  const now = useNow(timers.length > 0);
  // Finishing up is already about the stove.
  if (!session || route.value[0] === "cook") return null;
  const timer = timers[0];
  const dish = session.data.dishes.find((d) => {
    const p = session.data.progress.find((x) => x.dish_id === d.dish_id);
    return d.steps.length && !p?.completed_steps.includes(d.steps.length - 1);
  });
  const p =
    dish && session.data.progress.find((x) => x.dish_id === dish.dish_id);
  const status = timer
    ? `${timer.label} · ${secondsLeft(timer, now) ? clock(secondsLeft(timer, now)) : "time’s up"}`
    : dish
      ? `Step ${p.current_step + 1} of ${dish.steps.length}`
      : "Every step done";
  return (
    <a class="now-cooking" href={`#/cook/${encodeURIComponent(session.id)}`}>
      <Icon icon={Flame} />
      <span class="now-cooking-text">
        <span class="now-cooking-label">Now cooking</span>{" "}
        <span class="now-cooking-title">{session.data.title}</span>{" "}
        <span class="now-cooking-status">{status}</span>
      </span>
      {sessions.length > 1 && <span class="badge">+{sessions.length - 1}</span>}
    </a>
  );
}
