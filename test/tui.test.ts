import stringWidth from "string-width";
import { describe, expect, it } from "vitest";
import { renderToolCall, renderToolResult, sanitizeTerminalText } from "../packages/shared/tui.ts";

const plainTheme = {};

function controlCharacter(codePoint: number): string {
  return String.fromCodePoint(codePoint);
}

describe("shared browser tool TUI", () => {
  it("keeps call subjects bounded and safe for the terminal", () => {
    const escape = controlCharacter(0x1b);
    const bell = controlCharacter(0x07);
    const bidiOverride = controlCharacter(0x202e);
    const text = sanitizeTerminalText(
      `${escape}]8;;https://evil.test${bell}https://example.test${escape}]8;;${bell}${bidiOverride}${"x".repeat(200)}`,
    );

    expect(text.startsWith("https://example.test")).toBe(true);
    expect(text.endsWith("…")).toBe(true);
    expect(text).not.toContain(escape);
    expect(text).not.toContain("evil.test");
    expect(text).not.toContain(bidiOverride);
    expect(Array.from(text)).toHaveLength(72);
  });

  it("clips CJK, combining marks, and emoji by terminal width", () => {
    const cases = [
      { input: "界".repeat(20), expected: "界界界界…" },
      { input: "é".repeat(20), expected: "ééééééééé…" },
      { input: "👨‍👩‍👧‍👦".repeat(20), expected: "👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦…" },
    ];

    for (const { input, expected } of cases) {
      const clipped = sanitizeTerminalText(input, 10);
      expect(clipped).toBe(expected);
      expect(stringWidth(clipped)).toBeLessThanOrEqual(10);
    }
  });

  it("shows the scrape target and options without raw argument noise", () => {
    const line = renderToolCall(
      "browsers_scrape",
      {
        url: "https://example.test/products",
        provider: "steel",
        waitFor: "#catalog",
        maxChars: 50_000,
      },
      { executionStarted: true, isPartial: true },
      plainTheme,
    );

    expect(line).toBe(
      "◌ 🌐 Browser Scrape https://example.test/products steel · wait #catalog · 50,000 chars",
    );
  });

  it("maps both harness state contracts onto readable call status", () => {
    expect(
      renderToolCall("browsers_providers", {}, {}, plainTheme).startsWith("· 🔌 Browser Providers"),
    ).toBe(true);
    expect(
      renderToolCall(
        "browsers_providers",
        {},
        { isPartial: true, spinnerFrame: 2 },
        plainTheme,
      ).startsWith("⠹ 🔌 Browser Providers"),
    ).toBe(true);
    expect(
      renderToolCall("browsers_providers", {}, { isPartial: false }, plainTheme).startsWith(
        "✓ 🔌 Browser Providers",
      ),
    ).toBe(true);
  });

  it("summarizes provider and collection results in the collapsed row", () => {
    const providers = renderToolResult(
      "browsers_providers",
      {
        content: [{ type: "text", text: "provider rows" }],
        details: {
          providers: [
            { name: "steel", configured: true },
            { name: "kernel", configured: false },
            { name: "playwright", configured: true },
          ],
        },
      },
      false,
      {},
      plainTheme,
    );
    const links = renderToolResult(
      "browsers_links",
      {
        content: [{ type: "text", text: "https://a.test\nhttps://b.test" }],
        details: { links: ["https://a.test", "https://b.test"] },
      },
      false,
      {},
      plainTheme,
    );

    expect(providers).toBe("✓ 2/3 configured (expand to view)");
    expect(links).toBe("✓ 2 links (expand to view)");
  });

  it("uses structured browser facts instead of repeating the output", () => {
    const crawl = renderToolResult(
      "browsers_crawl",
      {
        content: [{ type: "text", text: "Crawled 3 pages.\nJob ID: job-1" }],
        details: { pages: 3, jobId: "job-1" },
      },
      false,
      {},
      plainTheme,
    );
    const capabilities = renderToolResult(
      "browsers_capabilities",
      {
        content: [{ type: "text", text: "capabilities" }],
        details: {
          provider: "playwright",
          capabilities: { scrape: true, screenshot: true, cdp: false },
        },
      },
      false,
      {},
      plainTheme,
    );

    expect(crawl).toBe("✓ 3 pages · job job-1 (expand to view)");
    expect(capabilities).toBe("✓ playwright · 2/3 supported (expand to view)");
  });

  it("sanitizes hostile multiline output without losing meaningful layout", () => {
    const tab = controlCharacter(0x09);
    const c1Csi = controlCharacter(0x9b);
    const zwnj = controlCharacter(0x200c);
    const lineSeparator = controlCharacter(0x2028);
    const bidiOverride = controlCharacter(0x202e);
    const text = `row\r\n${tab}indented 👨‍👩‍👧‍👦 فارسی${zwnj}text\n${c1Csi}31mred${c1Csi}0m\n${bidiOverride}safe${lineSeparator}next`;

    const expanded = renderToolResult(
      "browsers_links",
      {
        content: [{ type: "text", text }],
        details: { links: ["https://a.test", "https://b.test"] },
      },
      false,
      { expanded: true },
      plainTheme,
    );

    expect(expanded).toBe(
      `✓ 2 links\n  row\n  ${tab}indented 👨‍👩‍👧‍👦 فارسی${zwnj}text\n  red\n   safe next`,
    );
    expect(expanded).not.toContain(c1Csi);
    expect(expanded).not.toContain(lineSeparator);
    expect(expanded).not.toContain(bidiOverride);
  });

  it("bounds expanded output and repairs malformed surrogates", () => {
    const malformed = "\uD800";
    const expanded = renderToolResult(
      "browsers_scrape",
      { content: [{ type: "text", text: `${malformed}${"x".repeat(20_000)}` }] },
      false,
      { expanded: true },
      plainTheme,
    );

    expect(expanded).toContain("�");
    expect(expanded).not.toContain(malformed);
    expect(expanded.endsWith("… output truncated")).toBe(true);
    expect(expanded.length).toBeLessThan(16_100);
  });

  it("puts a safe failure message in the result row", () => {
    const escape = controlCharacter(0x1b);
    const line = renderToolResult(
      "browsers_scrape",
      { content: [{ type: "text", text: `Unknown${escape}[31m provider\nbad` }] },
      true,
      {},
      plainTheme,
    );

    expect(line).toBe("✗ Unknown provider (failed)");
  });
});
