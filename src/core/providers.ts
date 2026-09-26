import { browserProviderNames } from "../tool-contract.ts";

export { browserProviderNames as builtinProviders };

export type BrowserProviderName = (typeof browserProviderNames)[number];
