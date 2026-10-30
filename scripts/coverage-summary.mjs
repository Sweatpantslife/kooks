import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Turns the LCOV file that `npm run test:coverage` writes into a Markdown
// table with one row per top-level directory and a total, for the GitHub
// Actions job summary. Usage: node scripts/coverage-summary.mjs [lcov.info]
const keys = ["LF", "LH", "BRF", "BRH", "FNF", "FNH"];
const empty = () => Object.fromEntries(keys.map((key) => [key, 0]));
const percent = (hit, found) =>
  found ? `${((100 * hit) / found).toFixed(1)}%` : "–";
const row = (name, c) =>
  `| ${name} | ${percent(c.LH, c.LF)} | ${percent(c.BRH, c.BRF)} | ${percent(c.FNH, c.FNF)} |`;

export function summarize(lcov) {
  const groups = new Map();
  const total = empty();
  for (const record of lcov.split("end_of_record")) {
    const file = record.match(/^SF:(.+)$/m)?.[1].replaceAll("\\", "/");
    if (!file) continue;
    const group = file.includes("/") ? `${file.split("/")[0]}/` : file;
    if (!groups.has(group)) groups.set(group, empty());
    for (const [, key, value] of record.matchAll(
      /^(LF|LH|BRF|BRH|FNF|FNH):(\d+)$/gm,
    )) {
      groups.get(group)[key] += Number(value);
      total[key] += Number(value);
    }
  }
  return [
    "| Files | Lines | Branches | Functions |",
    "| --- | --- | --- | --- |",
    ...[...groups.keys()].sort().map((name) => row(name, groups.get(name))),
    row("**All files**", total),
  ].join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lcov = readFileSync(process.argv[2] ?? "coverage/lcov.info", "utf8");
  console.log(`### Unit test coverage\n\n${summarize(lcov)}`);
}
