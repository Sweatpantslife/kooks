import { useEffect } from "preact/hooks";
import { signal } from "@preact/signals";
import { Smartphone } from "lucide";
import { native } from "../lib/device.js";
import { readOldCookbook, retireOldCookbook } from "../lib/native.js";
import { oldPhoneRecipes } from "../lib/old-phone.js";
import { change } from "../lib/store.js";
import { toast } from "../lib/toast.js";
import { plural } from "../lib/format.js";
import { FormError, useWork } from "./form.jsx";
import { Icon } from "./icon.jsx";

// The recipes the old phone app kept, looked for once per start.
const found = signal([]);
let looked = false;
async function look() {
  if (looked) return;
  looked = true;
  const text = await readOldCookbook();
  found.value = text ? oldPhoneRecipes(text) : [];
}

// "Not now" until the app starts again.
const later = signal(false);

// On a phone that had the earlier Kooks app: its own recipes, offered once
// to the household's kitchen.
export function OldPhoneRecipes() {
  const work = useWork();
  useEffect(() => {
    if (native) void look();
  }, []);
  const list = found.value;
  if (!list.length || later.value) return null;
  const bring = () =>
    work.run(async () => {
      // Each recipe's own key saves it once, so a bring-in that stopped
      // half way carries on without saving any twice.
      for (const { key, recipe } of list)
        await change("recipe_save", { request_id: key, recipe });
      await retireOldCookbook();
      found.value = [];
      toast(
        `${plural(list.length, "recipe")} from this phone ${list.length === 1 ? "is" : "are"} in your kitchen.`,
      );
    });
  return (
    <section class="card" aria-labelledby="old-phone">
      <h2 id="old-phone">
        <Icon icon={Smartphone} /> Recipes on this phone
      </h2>
      <p>
        The Kooks app you had before kept {plural(list.length, "recipe")} on
        this phone only:{" "}
        {list
          .slice(0, 3)
          .map((r) => r.recipe.title)
          .join(", ")}
        {list.length > 3 ? " and more" : ""}. Bring them into your kitchen so
        everyone at home has them.
      </p>
      <FormError>{work.error}</FormError>
      <div class="row">
        <button
          type="button"
          class="btn btn-primary"
          disabled={work.busy}
          onClick={bring}
        >
          {work.busy ? "Bringing them in…" : "Bring them in"}
        </button>
        <button
          type="button"
          class="btn btn-quiet"
          disabled={work.busy}
          onClick={() => (later.value = true)}
        >
          Not now
        </button>
      </div>
    </section>
  );
}
