import { describe, expect, it } from "vitest";
import { browserToolDescriptions, browserToolNames } from "../src/tool-contract";

describe("browser tool advertising", () => {
  it("does not expose navigate or evaluate tools", () => {
    expect(browserToolNames).not.toContain("browsers_navigate");
    expect(browserToolNames).not.toContain("browsers_evaluate");
  });

  it("does not advertise CDP navigate/evaluate on scrape", () => {
    expect(browserToolDescriptions.browsers_scrape).not.toMatch(/CDP navigate\/evaluate/);
  });

  it("does not promise later operations for an undrivable session", () => {
    expect(browserToolDescriptions.browsers_session).not.toMatch(/for later operations/);
  });

  it("names browsers_release as the only consumer of a created session id", () => {
    expect(browserToolDescriptions.browsers_session).toMatch(/browsers_release/);
  });

  it("does not imply screenshot is waiting on a navigate tool", () => {
    expect(browserToolDescriptions.browsers_screenshot).not.toMatch(/without navigate support/);
  });
});
