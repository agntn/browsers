import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type { Static } from "@oh-my-pi/omptype/typebox";
import {
  browserProviderNames,
  browserToolDescriptions,
  browserToolLabels,
  DEFAULT_SCRAPE_MAX_CHARS,
  MAX_SCRAPE_MAX_CHARS,
} from "../../../src/tool-contract.ts";
import type * as BrowserTools from "../../../dist/tool-operations.d.mts";

const sourceModulePath = fileURLToPath(new URL("../../../src/tool-operations.ts", import.meta.url));
let toolOperationsPromise: Promise<typeof BrowserTools> | undefined;

/**
 * Loads the shared executors from source in a checkout and from dist in a package.
 *
 * @returns {Promise<typeof BrowserTools>} Shared browser tool module.
 */
function loadToolOperations(): Promise<typeof BrowserTools> {
  toolOperationsPromise ??= (
    existsSync(sourceModulePath)
      ? import("../../../src/tool-operations.ts")
      : import("../../../dist/tool-operations.mjs")
  ).catch((error: unknown) => {
    toolOperationsPromise = undefined;
    throw error;
  }) as Promise<typeof BrowserTools>;
  return toolOperationsPromise;
}

/**
 * Builds OMP schemas with the TypeBox facade injected by the host.
 *
 * @param pi - OMP extension API.
 * @returns {ParameterSchemas} Browser tool schemas created by the host TypeBox facade.
 */
function buildParameterSchemas(pi: ExtensionAPI) {
  const { Type } = pi.typebox;
  const provider = Type.Optional(
    Type.String({
      description: `Provider name. One of: ${browserProviderNames.join(", ")}. Auto-detected from env.`,
    }),
  );
  return {
    scrape: Type.Object(
      {
        url: Type.String({ description: "URL to scrape" }),
        provider,
        waitFor: Type.Optional(
          Type.String({ description: "CSS selector to wait for before extraction" }),
        ),
        maxChars: Type.Optional(
          Type.Integer({
            description: `Maximum page content characters to return. Defaults to ${DEFAULT_SCRAPE_MAX_CHARS}; accepted range: 1-${MAX_SCRAPE_MAX_CHARS}.`,
            minimum: 1,
            maximum: MAX_SCRAPE_MAX_CHARS,
          }),
        ),
      },
      { additionalProperties: false },
    ),
    session: Type.Object(
      {
        provider,
        region: Type.Optional(
          Type.String({ description: "Preferred region (e.g. us-east-1, eu-west-1)" }),
        ),
      },
      { additionalProperties: false },
    ),
    release: Type.Object(
      {
        sessionId: Type.String({ description: "Session ID to release" }),
        provider,
      },
      { additionalProperties: false },
    ),
    providers: Type.Object({}, { additionalProperties: false }),
    screenshot: Type.Object(
      {
        url: Type.String({ description: "URL to screenshot" }),
        provider,
        format: Type.Optional(
          Type.String({ description: "Image format: png, jpeg, webp. Default: png." }),
        ),
        fullPage: Type.Optional(Type.Boolean({ description: "Capture full page. Default: true." })),
      },
      { additionalProperties: false },
    ),
    extract: Type.Object(
      {
        url: Type.String({ description: "URL to extract data from" }),
        provider: Type.Optional(
          Type.String({ description: "Provider. One of: cloudflare, hyperbrowser." }),
        ),
        prompt: Type.String({
          description: "What to extract (e.g. 'Extract product name, price, and description')",
        }),
        schema: Type.Optional(
          Type.Record(Type.String(), Type.Unknown(), {
            description: "JSON schema that constrains the extracted result",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    crawl: Type.Object(
      {
        url: Type.String({ description: "Starting URL" }),
        provider: Type.Optional(
          Type.String({ description: "Provider. One of: cloudflare, hyperbrowser, playwright." }),
        ),
        maxPages: Type.Optional(Type.Number({ description: "Max pages to crawl. Default: 10." })),
      },
      { additionalProperties: false },
    ),
    pdf: Type.Object(
      {
        url: Type.String({ description: "URL to convert to PDF" }),
        provider: Type.Optional(
          Type.String({ description: "Provider. One of: cloudflare, browserless, playwright." }),
        ),
      },
      { additionalProperties: false },
    ),
    links: Type.Object(
      {
        url: Type.String({ description: "URL to extract links from" }),
        provider,
      },
      { additionalProperties: false },
    ),
    search: Type.Object(
      { query: Type.String({ description: "Search query" }) },
      { additionalProperties: false },
    ),
    capabilities: Type.Object(
      { provider: Type.String({ description: "Provider name to check" }) },
      { additionalProperties: false },
    ),
  };
}

type ParameterSchemas = ReturnType<typeof buildParameterSchemas>;
type ScrapeParams = Static<ParameterSchemas["scrape"]>;
type SessionParams = Static<ParameterSchemas["session"]>;
type ReleaseParams = Static<ParameterSchemas["release"]>;
type ProvidersParams = Static<ParameterSchemas["providers"]>;
type ScreenshotParams = Static<ParameterSchemas["screenshot"]>;
type ExtractParams = Static<ParameterSchemas["extract"]>;
type CrawlParams = Static<ParameterSchemas["crawl"]>;
type PdfParams = Static<ParameterSchemas["pdf"]>;
type LinksParams = Static<ParameterSchemas["links"]>;
type SearchParams = Static<ParameterSchemas["search"]>;
type CapabilitiesParams = Static<ParameterSchemas["capabilities"]>;

/**
 * Registers the browser tools with OMP.
 *
 * @param pi - OMP extension API.
 * @returns {void} Nothing.
 */
export default function browsersOmpExtension(pi: ExtensionAPI): void {
  const { Text } = pi.pi;
  const schemas = buildParameterSchemas(pi);
  pi.setLabel("Browsers");

  pi.registerTool<typeof schemas.scrape, BrowserTools.BrowserScrapeDetails>({
    name: "browsers_scrape",
    label: browserToolLabels.browsers_scrape,
    description: browserToolDescriptions.browsers_scrape,
    approval: "read",
    parameters: schemas.scrape,
    renderCall: (args, _options, theme) =>
      new Text(
        `${theme.fg("toolTitle", theme.bold("browsers_scrape"))} ${theme.fg("dim", sanitizeTerminalText(args.url))}`,
        0,
        0,
      ),
    async execute(_toolCallId, params: ScrapeParams) {
      return (await loadToolOperations()).browserScrape(params);
    },
  });

  pi.registerTool<typeof schemas.session, BrowserTools.BrowserSessionDetails>({
    name: "browsers_session",
    label: browserToolLabels.browsers_session,
    description: browserToolDescriptions.browsers_session,
    approval: "write",
    parameters: schemas.session,
    async execute(_toolCallId, params: SessionParams) {
      return (await loadToolOperations()).browserSession(params);
    },
  });

  pi.registerTool<typeof schemas.release, { released: boolean }>({
    name: "browsers_release",
    label: browserToolLabels.browsers_release,
    description: browserToolDescriptions.browsers_release,
    approval: "write",
    parameters: schemas.release,
    async execute(_toolCallId, params: ReleaseParams) {
      return (await loadToolOperations()).releaseBrowserSession(params);
    },
  });

  pi.registerTool<typeof schemas.providers, { providers: BrowserTools.BrowserProviderStatus[] }>({
    name: "browsers_providers",
    label: browserToolLabels.browsers_providers,
    description: browserToolDescriptions.browsers_providers,
    approval: "read",
    parameters: schemas.providers,
    async execute(_toolCallId: string, _params: ProvidersParams) {
      return (await loadToolOperations()).listBrowserProviders();
    },
  });

  pi.registerTool<typeof schemas.screenshot, { url: string; provider: string; saved: boolean }>({
    name: "browsers_screenshot",
    label: browserToolLabels.browsers_screenshot,
    description: browserToolDescriptions.browsers_screenshot,
    approval: "read",
    parameters: schemas.screenshot,
    async execute(_toolCallId, params: ScreenshotParams) {
      return (await loadToolOperations()).browserScreenshot(params);
    },
  });

  pi.registerTool<typeof schemas.extract, { url: string; provider: string; data: unknown }>({
    name: "browsers_extract",
    label: browserToolLabels.browsers_extract,
    description: browserToolDescriptions.browsers_extract,
    approval: "read",
    parameters: schemas.extract,
    async execute(
      _toolCallId,
      params: Readonly<Omit<ExtractParams, "schema">> & {
        readonly schema?: Readonly<Record<string, unknown>>;
      },
    ) {
      return (await loadToolOperations()).browserExtract(params);
    },
  });

  pi.registerTool<typeof schemas.crawl, { jobId?: string; pages: number }>({
    name: "browsers_crawl",
    label: browserToolLabels.browsers_crawl,
    description: browserToolDescriptions.browsers_crawl,
    approval: "read",
    parameters: schemas.crawl,
    async execute(_toolCallId, params: CrawlParams) {
      return (await loadToolOperations()).browserCrawl(params);
    },
  });

  pi.registerTool<typeof schemas.pdf, { url: string; provider: string; pdfLength: number }>({
    name: "browsers_pdf",
    label: browserToolLabels.browsers_pdf,
    description: browserToolDescriptions.browsers_pdf,
    approval: "read",
    parameters: schemas.pdf,
    async execute(_toolCallId, params: PdfParams) {
      return (await loadToolOperations()).browserPdf(params);
    },
  });

  pi.registerTool<typeof schemas.links, { url: string; links: string[] }>({
    name: "browsers_links",
    label: browserToolLabels.browsers_links,
    description: browserToolDescriptions.browsers_links,
    approval: "read",
    parameters: schemas.links,
    async execute(_toolCallId, params: LinksParams) {
      return (await loadToolOperations()).browserLinks(params);
    },
  });

  pi.registerTool<
    typeof schemas.search,
    { results: Array<{ url: string; title: string; snippet: string }> }
  >({
    name: "browsers_search",
    label: browserToolLabels.browsers_search,
    description: browserToolDescriptions.browsers_search,
    approval: "read",
    parameters: schemas.search,
    async execute(_toolCallId, params: SearchParams) {
      return (await loadToolOperations()).browserSearch(params);
    },
  });

  pi.registerTool<
    typeof schemas.capabilities,
    { provider: string; capabilities: BrowserTools.ProviderCapabilities }
  >({
    name: "browsers_capabilities",
    label: browserToolLabels.browsers_capabilities,
    description: browserToolDescriptions.browsers_capabilities,
    approval: "read",
    parameters: schemas.capabilities,
    async execute(_toolCallId, params: CapabilitiesParams) {
      return (await loadToolOperations()).browserCapabilities(params);
    },
  });
}

/**
 * Removes terminal control bytes from OMP call previews.
 *
 * @param value - Untrusted preview value.
 * @returns {string} Terminal safe single-line text.
 */
function sanitizeTerminalText(value: unknown): string {
  return (
    String(value)
      /* oxlint-disable-next-line no-control-regex */
      .replaceAll(/[\u0000-\u001F\u007F-\u009F]/gu, " ")
      .replaceAll(/ +/g, " ")
      .trim()
  );
}
