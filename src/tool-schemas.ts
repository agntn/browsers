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

const browser = Type.Optional(
  Type.Literal("kitesurf", {
    description: "Use Cloudflare's Kitesurf engine instead of the default Chromium browser.",
  }),
);

/** TypeBox schemas shared by the Pi extension and MCP server. */
export const browserToolSchemas = {
  browsers_scrape: Type.Object(
    {
      url: Type.String({ description: "URL to scrape" }),
      provider,
      browser,
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
      browser,
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
      browser,
    },
    { additionalProperties: false },
  ),
  browsers_providers: Type.Object({}, { additionalProperties: false }),
  browsers_screenshot: Type.Object(
    {
      url: Type.String({ description: "URL to screenshot" }),
      provider,
      browser,
      format: Type.Optional(
        Type.String({ description: "Image format: png, jpeg, webp. Default: png." }),
      ),
      fullPage: Type.Optional(Type.Boolean({ description: "Capture full page. Default: true." })),
      path: Type.Optional(
        Type.String({
          description:
            "File to write the image to instead of returning it. A relative path resolves against the working directory of the process running the tool. The file must not exist yet.",
        }),
      ),
    },
    { additionalProperties: false },
  ),
  browsers_extract: Type.Object(
    {
      url: Type.String({ description: "URL to extract data from" }),
      provider: Type.Optional(
        Type.String({ description: "Provider. One of: cloudflare, hyperbrowser." }),
      ),
      browser,
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
      browser,
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
      browser,
    },
    { additionalProperties: false },
  ),
  browsers_links: Type.Object(
    {
      url: Type.String({ description: "URL to extract links from" }),
      provider,
      browser,
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
