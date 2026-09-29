import type { ProviderCapabilities } from "../../../src/core/types.ts";

export type { ProviderCapabilities };

/** One provider as the pages see it: manifest data, its flags and what the agent tool says about them. */
export interface ProviderRecord {
  /** Registry key, as `create()` takes it. */
  key: string;
  /** Endpoint `create()` uses without a `baseURL`; `local` for Playwright. */
  defaultURL: string;
  /** The environment the provider needs, as `browsers providers` would name it. */
  env: string;
  /** Whether it needs no environment at all. */
  keyless: boolean;
  /** `capabilities()` of an instance. */
  capabilities: ProviderCapabilities;
  /** The text `browsers_capabilities` hands a model for this provider. */
  capabilitiesText: string;
}

export interface BrowsersRegistry {
  version: string;
  providers: ProviderRecord[];
}

import type { browserProviderNames } from "../../../src/tool-contract.ts";

/** A built-in provider key. */
export type BrowserProviderName = (typeof browserProviderNames)[number];
