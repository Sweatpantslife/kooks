import { Icon } from "./icon.jsx";

// Every page opens with one of these. Its heading takes focus when the page
// changes, so a screen reader starts reading from the new page's title.
export function PageHeader({ eyebrow, title, children }) {
  return (
    <header class="page-header">
      <div>
        {eyebrow && <div class="eyebrow">{eyebrow}</div>}
        <h1 tabIndex={-1} data-page-title>
          {title}
        </h1>
      </div>
      {children && <div class="row">{children}</div>}
    </header>
  );
}

export function Empty({ icon, title, children, action, heading: H = "h2" }) {
  return (
    <section class="empty">
      <span class="empty-icon">
        <Icon icon={icon} class="icon-lg" />
      </span>
      <H>{title}</H>
      {children && <p>{children}</p>}
      {action}
    </section>
  );
}
