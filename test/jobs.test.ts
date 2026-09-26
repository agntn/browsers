import { afterEach, describe, expect, it, vi } from "vitest";
import { resetDefaultClientForTests } from "../src/core/client";
import { create } from "../src/core/registry";
import { JOB_POLL_INTERVAL } from "../src/core/utils";
import { browserCrawl } from "../src/tool-operations";

interface Call {
  readonly method: string;
  readonly url: string;
  readonly body?: unknown;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(answer: (call: Call) => unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? "GET",
        url,
        body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
      };
      calls.push(call);
      return jsonResponse(answer(call));
    }),
  );
  resetDefaultClientForTests();
  return calls;
}

/**
 * Moves the fake clock until the job settles, yielding to I/O such as the lazy ofetch import.
 *
 * @param {Promise<T> | undefined} promise Job in flight.
 * @returns {Promise<T | undefined>} The job once it settles.
 */
async function settle<T>(promise: Promise<T> | undefined): Promise<T | undefined> {
  let settled = false;
  const markSettled = (): void => {
    settled = true;
  };
  void promise?.then(markSettled, markSettled);
  while (promise && !settled) {
    await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL);
  }
  return promise;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetDefaultClientForTests();
});

const CF_CRAWL =
  "https://api.cloudflare.com/client/v4/accounts/test-account/browser-rendering/crawl";

describe("cloudflare crawl job", () => {
  it("waits for the job and returns the pages it completed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    let statusReads = 0;
    const calls = stubFetch(({ method, url }) => {
      if (method === "POST") return { success: true, result: "job-1" };
      if (url.endsWith("?limit=1")) {
        statusReads += 1;
        return { success: true, result: { status: statusReads < 2 ? "running" : "completed" } };
      }
      if (url.endsWith("?cursor=1")) {
        return {
          success: true,
          result: {
            status: "completed",
            records: [
              { url: "https://example.test/b", status: "completed", markdown: "# B" },
              { url: "https://other.test/", status: "skipped" },
            ],
          },
        };
      }
      return {
        success: true,
        result: {
          status: "completed",
          cursor: 1,
          records: [
            {
              url: "https://example.test/",
              status: "completed",
              markdown: "# A",
              metadata: { title: "A", status: 200 },
            },
          ],
        },
      };
    });
    const provider = await create("cloudflare", { apiKey: "token", accountID: "test-account" });

    const crawl = provider.crawl?.("https://example.test/", { maxPages: 2 });

    await expect(settle(crawl)).resolves.toEqual({
      pages: [
        {
          url: "https://example.test/",
          title: "A",
          markdown: "# A",
          html: undefined,
          statusCode: 200,
        },
        {
          url: "https://example.test/b",
          title: undefined,
          markdown: "# B",
          html: undefined,
          statusCode: undefined,
        },
      ],
      totalFound: 2,
      jobId: "job-1",
      status: "completed",
    });
    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      `POST ${CF_CRAWL}`,
      `GET ${CF_CRAWL}/job-1?limit=1`,
      `GET ${CF_CRAWL}/job-1?limit=1`,
      `GET ${CF_CRAWL}/job-1`,
      `GET ${CF_CRAWL}/job-1?cursor=1`,
    ]);
    expect(calls[0]?.body).toEqual({
      url: "https://example.test/",
      formats: ["markdown"],
      limit: 2,
    });
  });

  it("returns the job ID of a crawl still running at the timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const calls = stubFetch(({ method }) =>
      method === "POST"
        ? { success: true, result: "job-2" }
        : { success: true, result: { status: "running" } },
    );
    const provider = await create("cloudflare", { apiKey: "token", accountID: "test-account" });

    const crawl = provider.crawl?.("https://example.test/", { timeout: 5_000 });

    await expect(settle(crawl)).resolves.toEqual({
      pages: [],
      totalFound: 0,
      jobId: "job-2",
      status: "running",
    });
    expect(calls).toHaveLength(4);
  });

  it("resumes a job by ID without starting another crawl", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    let statusReads = 0;
    const calls = stubFetch(({ url }) => {
      if (url.endsWith("?limit=1")) {
        statusReads += 1;
        return { success: true, result: { status: statusReads < 2 ? "running" : "errored" } };
      }
      return {
        success: true,
        result: {
          status: "errored",
          records: [{ url: "https://example.test/", status: "completed", markdown: "# A" }],
        },
      };
    });
    const provider = await create("cloudflare", { apiKey: "token", accountID: "test-account" });

    const resumed = provider.resumeCrawl?.("job-2");

    await expect(settle(resumed)).resolves.toEqual({
      pages: [
        {
          url: "https://example.test/",
          title: undefined,
          markdown: "# A",
          html: undefined,
          statusCode: undefined,
        },
      ],
      totalFound: 1,
      jobId: "job-2",
      status: "failed",
    });
    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      `GET ${CF_CRAWL}/job-2?limit=1`,
      `GET ${CF_CRAWL}/job-2?limit=1`,
      `GET ${CF_CRAWL}/job-2`,
    ]);
  });
});

describe("kitesurf crawl job", () => {
  const KITESURF_CRAWL =
    "https://api.cloudflare.com/client/v4/accounts/test-account/browser-run/crawl";

  it("names the browser the job has to be read with again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    vi.stubEnv("CF_API_TOKEN", "token");
    vi.stubEnv("CF_ACCOUNT_ID", "test-account");
    const calls = stubFetch(({ method }) =>
      method === "POST"
        ? { success: true, result: "job-4" }
        : { success: true, result: { status: "running" } },
    );

    const started = await settle(
      browserCrawl({ provider: "cloudflare", browser: "kitesurf", url: "https://example.test/" }),
    );
    calls.length = 0;
    await settle(browserCrawl({ provider: "cloudflare", browser: "kitesurf", jobId: "job-4" }));

    expect(started?.content).toEqual([
      {
        type: "text",
        text: [
          "[provider=cloudflare] Crawled 0 pages.",
          "Job ID: job-4 (status: running)",
          "The job is still running. Call browsers_crawl with this jobId, provider cloudflare and browser kitesurf to wait for it again.",
        ].join("\n"),
      },
    ]);
    expect(`${calls[0]?.method} ${calls[0]?.url}`).toBe(
      `GET ${KITESURF_CRAWL}/job-4?limit=1&browser=kitesurf`,
    );
    expect(calls.some(({ method }) => method === "POST")).toBe(false);
  });
});

describe("hyperbrowser crawl job", () => {
  it("waits for the job and reads every batch from 1", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    let statusReads = 0;
    const calls = stubFetch(({ method, url }) => {
      if (method === "POST") return { jobId: "job-3" };
      if (url.endsWith("/status")) {
        statusReads += 1;
        return { status: statusReads < 2 ? "pending" : "completed" };
      }
      const batch = Number(new URL(url).searchParams.get("page"));
      return {
        jobId: "job-3",
        status: "completed",
        totalPageBatches: 2,
        data: [
          batch === 1
            ? {
                url: "https://example.test/",
                status: "completed",
                markdown: "# A",
                metadata: { title: "A" },
              }
            : { url: "https://example.test/down", status: "failed", error: "timeout" },
        ],
      };
    });
    const provider = await create("hyperbrowser", {
      apiKey: "key",
      baseURL: "https://hyperbrowser.test",
    });

    const crawl = provider.crawl?.("https://example.test/");

    await expect(settle(crawl)).resolves.toEqual({
      pages: [{ url: "https://example.test/", title: "A", markdown: "# A", html: undefined }],
      totalFound: 1,
      jobId: "job-3",
      status: "completed",
    });
    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      "POST https://hyperbrowser.test/api/web/crawl",
      "GET https://hyperbrowser.test/api/web/crawl/job-3/status",
      "GET https://hyperbrowser.test/api/web/crawl/job-3/status",
      "GET https://hyperbrowser.test/api/web/crawl/job-3?page=1",
      "GET https://hyperbrowser.test/api/web/crawl/job-3?page=2",
    ]);
  });

  it("resumes a job by ID and reports one still running", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const calls = stubFetch(() => ({ status: "running" }));
    const provider = await create("hyperbrowser", {
      apiKey: "key",
      baseURL: "https://hyperbrowser.test",
    });

    const resumed = provider.resumeCrawl?.("job-3", { timeout: 5_000 });

    await expect(settle(resumed)).resolves.toEqual({
      pages: [],
      totalFound: 0,
      jobId: "job-3",
      status: "running",
    });
    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual(
      Array.from({ length: 3 }, () => "GET https://hyperbrowser.test/api/web/crawl/job-3/status"),
    );
  });
});

describe("hyperbrowser extract job", () => {
  const EXTRACT = "https://hyperbrowser.test/api/extract";

  it("waits for the job and returns its data", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    let reads = 0;
    const calls = stubFetch(({ method }) => {
      if (method === "POST") return { jobId: "job-4" };
      reads += 1;
      return reads < 2
        ? { jobId: "job-4", status: "running" }
        : {
            jobId: "job-4",
            status: "completed",
            metadata: { inputTokens: 286, outputTokens: 10, numPagesScraped: 1 },
            data: { pageHeading: "Example Domain" },
          };
    });
    const provider = await create("hyperbrowser", {
      apiKey: "key",
      baseURL: "https://hyperbrowser.test",
    });

    const extract = provider.extract?.("https://example.test/", { prompt: "Extract the heading" });

    await expect(settle(extract)).resolves.toEqual({
      url: "https://example.test/",
      data: { pageHeading: "Example Domain" },
    });
    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      `POST ${EXTRACT}`,
      `GET ${EXTRACT}/job-4`,
      `GET ${EXTRACT}/job-4`,
    ]);
    expect(calls[0]?.body).toEqual({
      urls: ["https://example.test/"],
      prompt: "Extract the heading",
    });
  });

  it("reports why a failed job failed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    stubFetch(({ method }) =>
      method === "POST"
        ? { jobId: "job-5" }
        : { jobId: "job-5", status: "failed", data: {}, error: "Error processing extract" },
    );
    const provider = await create("hyperbrowser", {
      apiKey: "key",
      baseURL: "https://hyperbrowser.test",
    });

    const extract = provider.extract?.("https://down.test/", { prompt: "Extract the heading" });

    await expect(settle(extract)).rejects.toThrow(
      "Hyperbrowser extract job job-5 failed: Error processing extract",
    );
  });

  it("returns the job ID of an extract still running at the timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const calls = stubFetch(({ method }) =>
      method === "POST" ? { jobId: "job-6" } : { jobId: "job-6", status: "pending" },
    );
    const provider = await create("hyperbrowser", {
      apiKey: "key",
      baseURL: "https://hyperbrowser.test",
    });

    const extract = provider.extract?.("https://example.test/", {
      prompt: "Extract the heading",
      timeout: 5_000,
    });

    await expect(settle(extract)).resolves.toEqual({
      url: "https://example.test/",
      data: { jobId: "job-6", status: "pending" },
    });
    expect(calls).toHaveLength(4);
  });
});
