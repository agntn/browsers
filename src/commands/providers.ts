import { defineCommand } from "citty";
import { providers as listProviders, create } from "../core/registry";
import { _hasKey, providerEnvHint } from "../core/resolve";
import type { ProviderCapabilities } from "../core/types";

const simpleCapabilityLabels = [
  ["navigate", "navigate"],
  ["evaluate", "evaluate"],
  ["sessions", "sessions"],
  ["cdp", "cdp"],
  ["crawl", "crawl"],
  ["pdf", "pdf"],
  ["links", "links"],
  ["search", "search"],
  ["extract", "extract"],
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
  try {
    const provider = create(name);
    const available = provider.isAvailable ? await provider.isAvailable() : true;
    console.log(`${available ? "✓" : "✗"} ${name}`);
  } catch {
    console.log(`✗ ${name} (not configured)`);
  }
}

function printCapabilities(name: string): void {
  const hasKey = _hasKey(name);
  const envHint = providerEnvHint(name);

  let tags = "";
  try {
    tags = capabilityTags(create(name).capabilities());
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
    for (const name of all) printCapabilities(name);
  },
});
