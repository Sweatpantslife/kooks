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

export const weekLabel = (start) =>
  `${dateLabel(start)} – ${dateLabel(addDays(start, 6))}`;

export const plural = (n, word, words = `${word}s`) =>
  `${n} ${n === 1 ? word : words}`;
