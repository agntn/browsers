import { describe, it, expect } from "vitest";
import { normalizeMainArgs } from "../../src/cli-args";

describe("normalizeMainArgs", () => {
  it("preserves empty argv", () => {
    expect(normalizeMainArgs([])).toEqual([]);
  });
  it("preserves known subcommands", () => {
    expect(normalizeMainArgs(["scrape", "https://example.com"])).toEqual([
      "scrape",
      "https://example.com",
    ]);
    expect(normalizeMainArgs(["screenshot", "https://example.com"])).toEqual([
      "screenshot",
      "https://example.com",
    ]);
    expect(normalizeMainArgs(["crawl"])).toEqual(["crawl"]);
    expect(normalizeMainArgs(["pdf", "https://example.com"])).toEqual([
      "pdf",
      "https://example.com",
    ]);
    expect(normalizeMainArgs(["links"])).toEqual(["links"]);
    expect(normalizeMainArgs(["search", "query"])).toEqual(["search", "query"]);
    expect(normalizeMainArgs(["extract"])).toEqual(["extract"]);
    expect(normalizeMainArgs(["session"])).toEqual(["session"]);
    expect(normalizeMainArgs(["providers"])).toEqual(["providers"]);
    expect(normalizeMainArgs(["mcp"])).toEqual(["mcp"]);
  });
  it("preserves --help and --version", () => {
    expect(normalizeMainArgs(["--help"])).toEqual(["--help"]);
    expect(normalizeMainArgs(["--version"])).toEqual(["--version"]);
  });
  it("prepends scrape for URL", () => {
    expect(normalizeMainArgs(["https://example.com"])).toEqual(["scrape", "https://example.com"]);
  });
});
