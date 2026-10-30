import test from "node:test";
import assert from "node:assert/strict";
import { summarize } from "../scripts/coverage-summary.mjs";

test("coverage summary totals LCOV records by top-level directory", () => {
  const lcov = [
    "TN:\nSF:mcp/a.js\nFNF:2\nFNH:1\nBRF:4\nBRH:4\nLF:10\nLH:9\nend_of_record",
    "TN:\nSF:mcp/b.js\nFNF:0\nFNH:0\nBRF:0\nBRH:0\nLF:10\nLH:5\nend_of_record",
    "TN:\nSF:web\\c.js\nFNF:2\nFNH:2\nBRF:0\nBRH:0\nLF:0\nLH:0\nend_of_record",
    "",
  ].join("\n");
  assert.equal(
    summarize(lcov),
    [
      "| Files | Lines | Branches | Functions |",
      "| --- | --- | --- | --- |",
      "| mcp/ | 70.0% | 100.0% | 50.0% |",
      "| web/ | – | – | 100.0% |",
      "| **All files** | 70.0% | 100.0% | 75.0% |",
    ].join("\n"),
  );
});
