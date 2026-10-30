import AxeBuilder from "@axe-core/playwright";

// The WCAG 2.2 A and AA rules plus axe's best practices (landmarks, heading
// order, one level-one heading per page): the set the accessibility baseline
// in docs/ia-ux.md was measured with.
const tags = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
  "best-practice",
];

// Checks the page as it stands, in the light and the dark theme, and returns
// one line per failing rule so a test can report every page at once. Reduced
// motion stops colour transitions from being measured halfway. Legacy mode runs
// axe in the page itself instead of collecting results in a second page; the
// apps embed no cross-origin frames until a video is played.
export async function scan(page, label) {
  const problems = [];
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    const { violations } = await new AxeBuilder({ page })
      .withTags(tags)
      .setLegacyMode(true)
      .analyze();
    for (const { id, help, nodes } of violations)
      problems.push(
        `${label} (${colorScheme}): ${id}, ${help}: ${nodes.map((node) => node.target.join(" ")).join(", ")}`,
      );
  }
  await page.emulateMedia({ colorScheme: null, reducedMotion: null });
  return problems;
}
