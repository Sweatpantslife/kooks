// Lucide icons, imported one by one so the bundle carries only those used.
// Decorative by default; pass a label to make one meaningful to assistive
// technology.
export function Icon({ icon, label, class: className = "" }) {
  return (
    <svg
      class={`icon ${className}`.trim()}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": "true" })}
    >
      {icon.map(([Tag, attrs], index) => (
        <Tag key={index} {...attrs} />
      ))}
    </svg>
  );
}
