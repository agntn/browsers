import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

/** Packages Pi supplies to extensions, per `HOST_PROVIDED_EXTENSION_PACKAGES` in Pi 0.99. */
const hostProvidedPackages = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "@mariozechner/pi-agent-core",
  "@mariozechner/pi-ai",
  "@mariozechner/pi-coding-agent",
  "@mariozechner/pi-tui",
  "@sinclair/typebox",
  "typebox",
];

interface Manifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>;
}

const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as Manifest;

describe("packages the host supplies", () => {
  it("stay out of dependencies, so Pi loads the package without a warning", () => {
    expect(hostProvidedPackages.filter((name) => name in (manifest.dependencies ?? {}))).toEqual(
      [],
    );
  });

  it("leave typebox to @agntn/tools, which carries its own copy", () => {
    expect(manifest.peerDependencies?.typebox).toBeUndefined();
    expect(manifest.devDependencies?.typebox).toBeUndefined();
  });

  it("keep a bare typebox import out of dist, since OMP swaps it for a facade", () => {
    const importers = readdirSync(join(repoRoot, "dist"), { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".mjs") || file.endsWith(".d.mts"))
      .filter((file) =>
        /(?:from|import)\s*\(?\s*["']typebox(?:\/[^"']*)?["']/u.test(
          readFileSync(join(repoRoot, "dist", file), "utf8"),
        ),
      );

    expect(importers).toEqual([]);
  });
});
