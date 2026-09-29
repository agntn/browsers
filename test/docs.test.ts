import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import * as library from "../src/index.ts";
import { create } from "../src/core/registry.ts";
import { browserProviderNames } from "../src/tool-contract.ts";

const docs = new URL("../docs/", import.meta.url);

interface RecordedScrape {
  provider: string;
  ok: boolean;
  text?: string;
}

describe("docs site", () => {
  it("has a page for every built-in provider, in registry order", () => {
    const pages = readdirSync(new URL("content/2.providers/", docs))
      .filter((file) => /^\d{2}\..+\.md$/u.test(file) && !file.startsWith("00."))
      .sort();
    expect(pages).toEqual(
      browserProviderNames.map((name, index) => `${String(index + 1).padStart(2, "0")}.${name}.md`),
    );
    for (const [index, name] of browserProviderNames.entries()) {
      const page = readFileSync(new URL(`content/2.providers/${pages[index]}`, docs), "utf8");
      expect(page).toContain(`::provider-facts{name="${name}"}`);
    }
  });

  it("has one recorded scrape per provider, refused only where capabilities() has no scrape", async () => {
    const recording = JSON.parse(
      readFileSync(new URL("app/data/scrape-sample.json", docs), "utf8"),
    ) as { out: RecordedScrape[] };
    expect(recording.out.map((row) => row.provider)).toEqual([...browserProviderNames]);
    for (const row of recording.out) {
      const provider = await create(row.provider, { apiKey: "docs-test", accountID: "docs-test" });
      expect({ provider: row.provider, ok: row.ok }).toEqual({
        provider: row.provider,
        ok: provider.capabilities().scrape,
      });
      if (row.ok) expect(row.text?.startsWith(`[provider=${row.provider}] `)).toBe(true);
    }
  });

  it("imports only what the package exports in the landing's custom provider file", () => {
    /* The file is a literal in the component; its value imports have to exist in src/index.ts. */
    const component = readFileSync(
      new URL("app/components/content/LandingCustom.vue", docs),
      "utf8",
    );
    const imports = /import \{ ([^}]+) \} from \\"@agntn\/browsers\\"/u.exec(component)?.[1];
    expect(imports).toBeDefined();
    for (const name of imports!.split(",").map((part) => part.trim())) {
      expect(library).toHaveProperty(name);
    }
  });
});
