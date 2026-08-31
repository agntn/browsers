import { browserProviderNames } from "../tool-contract";

export { browserProviderNames as builtinProviders };

export type BrowserProviderName = (typeof browserProviderNames)[number];
