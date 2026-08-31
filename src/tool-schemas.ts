import { Type } from "typebox";
import {
  browserProviderNames,
  DEFAULT_SCRAPE_MAX_CHARS,
  MAX_SCRAPE_MAX_CHARS,
} from "./tool-contract.ts";

const provider = Type.Optional(
  Type.String({
    description: `Provider name. One of: ${browserProviderNames.join(", ")}. Auto-detected from env.`,
  }),
);

/** TypeBox schemas shared by the Pi extension and MCP server. */
export const browserToolSchemas = {
  browsers_scrape: Type.Object(
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
  browsers_session: Type.Object(
    {
      provider,
      region: Type.Optional(
        Type.String({ description: "Preferred region (e.g. us-east-1, eu-west-1)" }),
      ),
    },
    { additionalProperties: false },
  ),
  browsers_release: Type.Object(
    {
      sessionId: Type.String({ description: "Session ID to release" }),
      provider,
    },
    { additionalProperties: false },
  ),
  browsers_providers: Type.Object({}, { additionalProperties: false }),
  browsers_screenshot: Type.Object(
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
  browsers_extract: Type.Object(
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
  browsers_crawl: Type.Object(
    {
      url: Type.String({ description: "Starting URL" }),
      provider: Type.Optional(
        Type.String({ description: "Provider. One of: cloudflare, hyperbrowser, playwright." }),
      ),
      maxPages: Type.Optional(Type.Number({ description: "Max pages to crawl. Default: 10." })),
    },
    { additionalProperties: false },
  ),
  browsers_pdf: Type.Object(
    {
      url: Type.String({ description: "URL to convert to PDF" }),
      provider: Type.Optional(
        Type.String({ description: "Provider. One of: cloudflare, browserless, playwright." }),
      ),
    },
    { additionalProperties: false },
  ),
  browsers_links: Type.Object(
    {
      url: Type.String({ description: "URL to extract links from" }),
      provider,
    },
    { additionalProperties: false },
  ),
  browsers_search: Type.Object(
    { query: Type.String({ description: "Search query" }) },
    { additionalProperties: false },
  ),
  browsers_capabilities: Type.Object(
    { provider: Type.String({ description: "Provider name to check" }) },
    { additionalProperties: false },
  ),
} as const;
