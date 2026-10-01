import { defineCommand } from "citty";
import { providers as listProviders, create } from "../core/registry.ts";
import { _hasKey, providerEnvHint } from "../core/resolve.ts";
import type { BrowserProvider, ProviderCapabilities } from "../core/types.ts";

const simpleCapabilityLabels = [
  ["elementScreenshot", "element"],
  ["navigate", "navigate"],
  ["evaluate", "evaluate"],
  ["sessions", "sessions"],
  ["cdp", "cdp"],
  ["crawl", "crawl"],
  ["pdf", "pdf"],
  ["links", "links"],
  ["search", "search"],
  ["extract", "extract"],
  ["accessibilityTree", "accessibility"],
] as const satisfies readonly (readonly [keyof ProviderCapabilities, string])[];

function scrapeCapability(capabilities: Readonly<ProviderCapabilities>): string | null {
  if (capabilities.statelessScrape) return "scrape";
  if (capabilities.scrape) return "scrape(sess)";
  return null;
}

function screenshotCapability(capabilities: Readonly<ProviderCapabilities>): string | null {
  if (capabilities.statelessScreenshot) return "screenshot";
  if (capabilities.screenshot) return "screenshot(sess)";
  return null;
}

function capabilityTags(capabilities: Readonly<ProviderCapabilities>): string {
  const simple = simpleCapabilityLabels
    .filter(([key]) => capabilities[key])
    .map(([, label]) => label);
  return [scrapeCapability(capabilities), screenshotCapability(capabilities), ...simple]
    .filter((tag): tag is string => tag !== null)
    .join(" ");
}

async function printAvailability(name: string): Promise<void> {
  let provider: BrowserProvider;
  try {
    provider = await create(name);
  } catch {
    console.log(`✗ ${name} (not configured)`);
    return;
  }
  try {
    await provider.checkAvailability?.();
    console.log(`✓ ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`✗ ${name} (${message.split("\n", 1)[0]})`);
  }
}

async function printCapabilities(name: string): Promise<void> {
  const hasKey = _hasKey(name);
  const envHint = providerEnvHint(name);

  let tags = "";
  try {
    tags = capabilityTags((await create(name)).capabilities());
  } catch {
    tags = "(cannot instantiate)";
  }

  console.log(
    `${hasKey ? "●" : "○"} ${name.padEnd(14)} ${hasKey ? "" : `(${envHint})`.padEnd(35)} ${tags}`,
  );
}

export default defineCommand({
  meta: {
    name: "providers",
    description: "List available browser providers with capabilities",
  },
  args: {
    check: {
      type: "boolean",
      alias: "c",
      description: "Check provider availability (requires API keys)",
      default: false,
    },
  },
  async run({ args }) {
    const all = listProviders();
    if (args.check) {
      for (const name of all) await printAvailability(name);
      return;
    }
    for (const name of all) await printCapabilities(name);
  },
});
