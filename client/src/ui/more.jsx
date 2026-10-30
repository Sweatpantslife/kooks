import { ExternalLink } from "lucide";
import { describeLink, displayLinks } from "../../../shared/links.js";
import { Icon } from "./icon.jsx";

// A record's links and videos, then where it came from, as list items.
export function linkItems(d) {
  const links = displayLinks(d);
  return [
    ...links.map((link) => {
      const info = describeLink(link.url);
      return {
        href: link.url,
        external: true,
        title: link.title || info?.label || link.url,
        note: info?.provider
          ? `Video on ${info.label}`
          : (info?.site ?? "Link"),
      };
    }),
    ...(d.source_url && !links.some((link) => link.url === d.source_url)
      ? [
          {
            href: d.source_url,
            external: true,
            title: `From ${describeLink(d.source_url)?.site ?? d.source_url}`,
            note: "Where this recipe came from",
          },
        ]
      : []),
  ];
}

// A titled list of places to go from a page: related things in the kitchen
// and links that open in a new tab.
export function MoreList({ id, title, items }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby={id} class="stack">
      <h2 id={id}>{title}</h2>
      <ul class="more" role="list">
        {items.map((item) => (
          <li key={item.href}>
            <a
              href={item.href}
              {...(item.external
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
            >
              <span class="more-title">
                {item.title}
                {item.external && (
                  <Icon
                    icon={ExternalLink}
                    class="icon-sm"
                    label="opens in a new tab"
                  />
                )}
              </span>
              <span class="muted small">{item.note}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
