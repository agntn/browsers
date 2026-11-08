import { execSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import type { Browser } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  AuthError,
  BrowserError,
  InvalidInputError,
  NavigationError,
  UnsupportedOperationError,
} from "../src/core/errors";
import { create } from "../src/core/registry";
import { _keyless } from "../src/core/resolve";

/* Every variable the provider reads, cleared around each test and set only where a test says. */
const ENV_KEYS = [
  "LIGHTPANDA_API_KEY",
  "LPD_TOKEN",
  "LIGHTPANDA_EXECUTABLE_PATH",
  "BROWSERS_TEST_LIGHTPANDA_ARGS",
  "BROWSERS_TEST_LIGHTPANDA_CHROME",
  "BROWSERS_TEST_LIGHTPANDA_PROFILE",
] as const;

let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "browsers-lightpanda-"));
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

/* The argument lines the fake binary logged for each fetch, oldest first. */
async function fetchCalls(log: string): Promise<string[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text.split("\n").filter(Boolean);
}

describe("lightpanda provider", () => {
  it("needs no key, sits last in the registry and paints nothing", async () => {
    const provider = await create("lightpanda");

    expect(_keyless("lightpanda")).toBe(true);
    expect(provider.capabilities()).toMatchObject({
      scrape: true,
      statelessScrape: true,
      scrapeWaitFor: true,
      sessions: true,
      navigate: true,
      evaluate: true,
      cdp: true,
      links: true,
      screenshot: false,
      statelessScreenshot: false,
      pdf: false,
      crawl: false,
    });
    await expect(provider.screenshot({ url: "https://example.com" })).rejects.toBeInstanceOf(
      UnsupportedOperationError,
    );
  });
});

describe("lightpanda fetch, local", () => {
  let log: string;

  beforeEach(() => {
    log = join(scratch, `args-${Date.now()}-${Math.random()}`);
    process.env.BROWSERS_TEST_LIGHTPANDA_ARGS = log;
  });

  it("asks Lightpanda for markdown when that is all the caller wants", async () => {
    const provider = await create("lightpanda");
    const result = await provider.scrape("https://example.com", { formats: ["markdown"] });

    expect(result.statusCode).toBe(200);
    expect(result.html).toBeUndefined();
    expect(result.markdown).toContain("[Learn more](https://iana.org/help/example-domains)");
    expect(await fetchCalls(log)).toEqual([
      "fetch --json --dump markdown --wait-until load https://example.com/",
    ]);
  });

  it("dumps the DOM otherwise, and waits for network idle when asked", async () => {
    const provider = await create("lightpanda");
    const result = await provider.scrape("https://example.com", {
      formats: ["markdown", "html"],
      waitForNetworkIdle: true,
    });

    expect(result.html).toContain("<title>Example Domain</title>");
    expect(result.markdown).toBeUndefined();
    expect(await fetchCalls(log)).toEqual([
      "fetch --json --dump html --wait-until networkidle https://example.com/",
    ]);
  });

  it("returns the site's own 404 page with its status", async () => {
    const provider = await create("lightpanda");
    const result = await provider.scrape("https://example.com/missing", { formats: ["markdown"] });

    expect(result.statusCode).toBe(404);
    expect(result.markdown).toContain("This domain is for use in documentation examples");
  });

  it("throws NavigationError with Lightpanda's reason when the page never loaded", async () => {
    const provider = await create("lightpanda");
    const call = provider.scrape("https://nonexistent.invalid/");

    await expect(call).rejects.toBeInstanceOf(NavigationError);
    await expect(call).rejects.toMatchObject({
      message: "Lightpanda couldn't load the page: CouldntResolveHost",
      provider: "lightpanda",
      reason: "CouldntResolveHost",
    });
  });

  it("refuses an address that isn't http(s) before starting the binary", async () => {
    const provider = await create("lightpanda");

    for (const url of ["--cookie-jar=/tmp/jar.json", "file:///etc/passwd"]) {
      await expect(provider.scrape(url)).rejects.toBeInstanceOf(InvalidInputError);
    }
    expect(await fetchCalls(log)).toEqual([]);
  });

  it("says how to get the binary when there is none", async () => {
    process.env.LIGHTPANDA_EXECUTABLE_PATH = join(scratch, "no-such-lightpanda");
    const provider = await create("lightpanda");
    const call = provider.scrape("https://example.com");

    await expect(call).rejects.toBeInstanceOf(BrowserError);
    await expect(call).rejects.toThrow(/Lightpanda binary not found at .*no-such-lightpanda\. /u);
    await expect(provider.checkAvailability?.()).rejects.toThrow("Lightpanda binary not found");
  });
});

describe("lightpanda fetch, cloud", () => {
  let server: Server;
  let baseURL: string;
  const requests: { authorization?: string; url?: string; body: unknown }[] = [];
  let reply: { status: number; body: string } = { status: 200, body: "{}" };

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: string) => {
        body += chunk;
      });
      req.on("end", () => {
        requests.push({
          authorization: req.headers.authorization,
          url: req.url,
          body: JSON.parse(body || "null") as unknown,
        });
        res.statusCode = reply.status;
        res.setHeader("Content-Type", reply.status === 200 ? "application/json" : "text/plain");
        res.end(reply.body);
      });
    });
    /* The cloud's CDP socket turns a wrong token away before the upgrade. */
    server.on("upgrade", (req, socket) => {
      requests.push({ url: req.url, body: null });
      socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 12\r\n\r\nUnauthorized");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    requests.length = 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("posts to /api/fetch with the token and reads data and status", async () => {
    reply = {
      status: 200,
      body: JSON.stringify({ data: "# Example Domain\n", status: 200, headers: {} }),
    };
    const provider = await create("lightpanda", { apiKey: "lpd-test", baseURL });
    const result = await provider.scrape("https://example.com", { formats: ["markdown"] });

    expect(result).toEqual({
      url: "https://example.com",
      markdown: "# Example Domain\n",
      statusCode: 200,
    });
    expect(requests).toEqual([
      {
        authorization: "Bearer lpd-test",
        url: "/api/fetch",
        body: { url: "https://example.com", output_format: "markdown", wait_event: "load" },
      },
    ]);
  });

  it("takes the token from LPD_TOKEN, the name Lightpanda's docs use", async () => {
    process.env.LPD_TOKEN = "lpd-alias";
    reply = { status: 200, body: JSON.stringify({ data: "<p>hi</p>", status: 200 }) };
    const provider = await create("lightpanda", { baseURL });

    expect((await provider.scrape("https://example.com")).html).toBe("<p>hi</p>");
    expect(requests[0]?.authorization).toBe("Bearer lpd-alias");
  });

  it("refuses a cloud base URL without a token instead of running locally", async () => {
    await expect(create("lightpanda", { baseURL })).rejects.toBeInstanceOf(AuthError);
  });

  it("throws AuthError on the cloud's 401", async () => {
    reply = { status: 401, body: "Unauthorized" };
    const provider = await create("lightpanda", { apiKey: "wrong", baseURL });

    await expect(provider.scrape("https://example.com")).rejects.toBeInstanceOf(AuthError);
  });

  it("throws AuthError when the cloud's CDP socket refuses the token", async () => {
    const provider = await create("lightpanda", { apiKey: "wrong", baseURL });
    const call = provider.createSession();

    await expect(call).rejects.toBeInstanceOf(AuthError);
    await expect(call).rejects.toThrow("Authentication failed for lightpanda: Unauthorized");
    expect(requests.map(({ url }) => url)).toContain("/ws?token=wrong&browser=lightpanda");
  });

  it("checks an attached server at its /json/version, whatever path its socket has", async () => {
    const paths: (string | undefined)[] = [];
    const cdp = createServer((req, res) => {
      paths.push(req.url);
      res.statusCode = req.url === "/json/version" ? 200 : 404;
      res.end(req.url === "/json/version" ? "{}" : "not found");
    });
    await new Promise<void>((resolve) => cdp.listen(0, "127.0.0.1", resolve));
    const { port } = cdp.address() as AddressInfo;
    const provider = await create("lightpanda", {
      baseURL: `ws://127.0.0.1:${port}/devtools/browser/abc`,
    });

    await expect(provider.checkAvailability?.()).resolves.toBeUndefined();
    expect(paths).toEqual(["/json/version"]);
    await new Promise<void>((resolve) => cdp.close(() => resolve()));
  });

  it("throws NavigationError when the cloud got no status from the site", async () => {
    reply = { status: 200, body: JSON.stringify({ data: "", status: 0 }) };
    const provider = await create("lightpanda", { apiKey: "lpd-test", baseURL });

    await expect(provider.scrape("https://example.com")).rejects.toBeInstanceOf(NavigationError);
  });
});

function systemChromium(): string | undefined {
  for (const name of ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser"]) {
    try {
      const path = execSync(`which ${name}`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
      if (path) return path;
    } catch {
      /* not found */
    }
  }
  return undefined;
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/* Whether anything still answers CDP on the address a session handed out. */
async function serving(cdpUrl: string): Promise<boolean> {
  const { host } = new URL(cdpUrl);
  return fetch(`http://${host}/json/version`).then(
    (response) => response.ok,
    () => false,
  );
}

/* A cold Chrome launch on a CI runner takes longer than the vitest defaults. */
const chromeTimeout = 30_000;

describe("lightpanda over CDP", { timeout: chromeTimeout }, () => {
  let site: Server;
  let page: string;
  let attached: Browser | undefined;

  beforeAll(async () => {
    site = createServer((req, res) => {
      res.statusCode = req.url === "/page" ? 200 : 404;
      res.setHeader("Content-Type", "text/html");
      res.end('<title>Panda page</title><p>bamboo</p><a href="/next" rel="next">Next</a>');
    });
    await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
    page = `http://127.0.0.1:${(site.address() as AddressInfo).port}/page`;
  });

  beforeEach(() => {
    process.env.BROWSERS_TEST_LIGHTPANDA_CHROME = systemChromium() ?? chromium.executablePath();
    process.env.BROWSERS_TEST_LIGHTPANDA_PROFILE = scratch;
  });

  afterAll(async () => {
    await attached?.close();
    await new Promise<void>((resolve) => site.close(() => resolve()));
  });

  it("starts lightpanda serve for a session and stops it on release", async () => {
    const provider = await create("lightpanda");
    const session = await provider.createSession();

    expect(session.metadata).toEqual({ mode: "launch" });
    expect(provider.getCdpUrl?.(session)).toBe(session.cdpUrl);
    await provider.navigate(page, session);
    expect(await provider.evaluate("document.title", session)).toEqual({ value: "Panda page" });
    const missing = await provider.scrape(page.replace("/page", "/gone"), {}, session);
    expect(missing.statusCode).toBe(404);

    const other = await create("lightpanda");
    expect((await other.listSessions()).map(({ id }) => id)).toEqual([session.id]);
    await other.releaseSession(session.id);
    expect(await provider.listSessions()).toEqual([]);
    await expect.poll(() => serving(session.cdpUrl ?? ""), { timeout: 10_000 }).toBe(false);
  });

  it("scrapes with waitFor and reads links on a server of their own", async () => {
    const provider = await create("lightpanda");
    const result = await provider.scrape(page, { waitFor: "p" });

    expect(result).toMatchObject({ title: "Panda page", statusCode: 200 });
    expect(result.text).toContain("bamboo");
    expect(result.links).toEqual([page.replace("/page", "/next")]);
    expect((await provider.links?.(page))?.links).toEqual([
      { href: page.replace("/page", "/next"), text: "Next", rel: "next" },
    ]);
  });

  it("attaches to a running CDP server and leaves it running", async () => {
    const port = await freePort();
    attached = await chromium.launch({
      executablePath: process.env.BROWSERS_TEST_LIGHTPANDA_CHROME,
      args: [`--remote-debugging-port=${port}`],
    });
    const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as {
      webSocketDebuggerUrl: string;
    };
    process.env.LPD_TOKEN = "cloud-token-left-in-env";
    const provider = await create("lightpanda", { baseURL: version.webSocketDebuggerUrl });
    const session = await provider.createSession();

    expect(session.metadata).toEqual({ mode: "attach" });
    expect((await provider.scrape(page, {}, session)).title).toBe("Panda page");
    await provider.releaseSession(session.id);
    expect(await serving(version.webSocketDebuggerUrl)).toBe(true);
    expect((await provider.scrape(page)).title).toBe("Panda page");
  });
});
