import { Heart } from "lucide";
import { art } from "../lib/kitchen.js";
import { Icon } from "./icon.jsx";

// The picture at the top of a tile or a recipe page: the household's photo
// when there is one, otherwise the course's color and icon.
export function Art({ kind, data, class: className = "" }) {
  const photo = kind === "book" ? data.cover_id : (data.photo_ids?.[0] ?? null);
  if (photo)
    return (
      <span class={`art ${className}`}>
        <img src={`/api/assets/${encodeURIComponent(photo)}`} alt="" />
      </span>
    );
  const { tone, icon } = art(kind, data);
  return (
    <span class={`art tone-${tone} ${className}`}>
      <Icon icon={icon} class="art-icon" />
    </span>
  );
}

// One thing from the cookbook in a grid. The favorite toggle sits beside the
// link, not inside it, so each is its own stop for the keyboard.
export function Tile({ kind, record, href, meta, badge, onFavorite }) {
  const d = record.data;
  return (
    <li class="tile">
      <a class="tile-link" href={href}>
        <Art kind={kind} data={d} />
        <span class="tile-text">
          {badge && (
            <span class={`badge badge-${badge.tone}`}>{badge.label}</span>
          )}
          <span class="tile-title">{d.title}</span>
          {meta && <span class="tile-meta">{meta}</span>}
        </span>
      </a>
      {onFavorite && (
        <button
          type="button"
          class="tile-favorite"
          aria-pressed={d.favorite ? "true" : "false"}
          aria-label={`Favorite: ${d.title}`}
          onClick={onFavorite}
        >
          <Icon icon={Heart} />
        </button>
      )}
    </li>
  );
}
