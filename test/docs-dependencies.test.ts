import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const docsDir = fileURLToPath(new URL("../docs/", import.meta.url));

/** Bare specifiers of real import statements, so the `from "@agntn/browsers"` snippet on the landing doesn't count. */
const SPECIFIER =
  /^\s*(?:import|export|\})\b[^"'\n]*?\bfrom\s*["']([@a-z][^"'\s]*)["']|\bimport\s*\(\s*["']([@a-z][^"'\s]*)["']/gmu;

/* The package a specifier names: `@scope/name` or `name`, subpath dropped. */
function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

/* Every package the site's own sources import, `node:` builtins left out. */
function importedPackages(): Set<string> {
  const files = globSync(["app/**/*.{ts,vue}", "modules/**/*.ts", "shared/**/*.ts", "*.ts"], {
    cwd: docsDir,
  });
  const names = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(`${docsDir}${file}`, "utf8").matchAll(SPECIFIER)) {
      const name = packageName(match[1] ?? match[2] ?? "");
      if (!name.startsWith("node:")) names.add(name);
    }
  }
  return names;
}

describe("docs dependencies", () => {
  it("declares every package the site imports, since the workspace hoists nothing", () => {
    const manifest = JSON.parse(readFileSync(`${docsDir}package.json`, "utf8")) as {
      readonly dependencies?: Readonly<Record<string, string>>;
      readonly devDependencies?: Readonly<Record<string, string>>;
    };
    const declared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ]);
    const imported = importedPackages();
    expect(imported).toContain("@nuxt/content");
    expect([...imported].filter((name) => !declared.has(name))).toEqual([]);
  });
});
