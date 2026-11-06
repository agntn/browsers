import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");

const workflow = read(".github/workflows/release.yml");

/** The jobs of the release workflow, each with the lines under it, keyed by job name. */
const jobs = new Map(
  [...workflow.matchAll(/^ {2}(?<name>[a-z]+):\n(?<body>(?: {4}.*\n|\n)*)/gmu)].map((match) => [
    match.groups?.["name"] ?? "",
    match.groups?.["body"] ?? "",
  ]),
);

const runSteps = (job: string) =>
  [...(jobs.get(job) ?? "").matchAll(/^\s*- run: (.+)$/gmu)].map((match) => match[1] ?? "");

describe("a release", () => {
  it("builds before the tests on the tag, which read `dist/`", () => {
    const steps = runSteps("test");
    expect(steps).toContain("pnpm build");
    expect(steps.indexOf("pnpm build")).toBeLessThan(steps.indexOf("pnpm test:run"));
  });

  it("packs only after the tag passed its tests", () => {
    expect(jobs.get("pack")).toMatch(/^ {4}needs: test$/mu);
    expect(jobs.get("publish")).toMatch(/^ {4}needs: pack$/mu);
  });
});
