import { useState } from "preact/hooks";
import { Flame } from "lucide";
import { startCooking } from "../lib/cooking.js";
import { navigate } from "../lib/router.js";
import { toast } from "../lib/toast.js";
import { Icon } from "./icon.jsx";

// Start cooking a recipe, meal or planned day, or pick it up again.
export function CookButton({
  source,
  label = "Cook",
  name,
  primary = false,
  compact = false,
}) {
  const [busy, setBusy] = useState(false);
  const cook = async () => {
    setBusy(true);
    try {
      navigate(`cook/${encodeURIComponent(await startCooking(source))}`);
    } catch (error) {
      toast(error.message, { error: true });
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      class={`btn${primary ? " btn-primary" : ""}${compact ? " btn-quiet btn-small" : ""}`}
      disabled={busy}
      aria-label={name}
      onClick={cook}
    >
      <Icon icon={Flame} class={compact ? "icon-sm" : undefined} />
      {label}
    </button>
  );
}
