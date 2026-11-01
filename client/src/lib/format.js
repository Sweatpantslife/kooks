// Dates are local calendar days written YYYY-MM-DD, as the server stores them.
export const localDay = (moment = new Date()) => {
  const d = new Date(moment);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const at = (day) => new Date(`${day}T12:00:00`);

export const addDays = (day, days) => {
  const d = at(day);
  d.setDate(d.getDate() + days);
  return localDay(d);
};

// Weeks start on Monday.
export const monday = (day = localDay()) =>
  addDays(day, -((at(day).getDay() + 6) % 7));

export const dateLabel = (day) =>
  at(day).toLocaleDateString(undefined, { month: "short", day: "numeric" });

// A day further back than this year says which year.
export const pastDayLabel = (day) =>
  day.slice(0, 4) === localDay().slice(0, 4)
    ? dateLabel(day)
    : at(day).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

export const weekLabel = (start) =>
  `${dateLabel(start)} – ${dateLabel(addDays(start, 6))}`;

export const plural = (n, word, words = `${word}s`) =>
  `${n} ${n === 1 ? word : words}`;

// A file's size, as people read it.
export const sizeLabel = (bytes) =>
  bytes >= 1024 * 1024 * 1024
    ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
    : bytes >= 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;

// A moment, such as when a backup was taken: "Oct 31, 9:59 PM".
export const momentLabel = (iso) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const weekdayLabel = (day) =>
  at(day).toLocaleDateString(undefined, { weekday: "long" });
