import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A Cloudflare token or account exported on the host, or its cf login, would pick the provider
 * for every test that expects none, so the suite starts without them and a stand-in cf goes
 * first on PATH, logged out unless a test says otherwise.
 */
delete process.env.CLOUDFLARE_API_TOKEN;
delete process.env.CLOUDFLARE_ACCOUNT_ID;
delete process.env.AGNTN_CLOUDFLARE_ACCOUNT_ID;
delete process.env.BROWSERS_TEST_CF_WHOAMI;
delete process.env.LIGHTPANDA_API_KEY;
delete process.env.LPD_TOKEN;
delete process.env.LIGHTPANDA_EXECUTABLE_PATH;
delete process.env.ATTACH_URL;
process.env.PATH = `${fileURLToPath(new URL("fixtures/bin", import.meta.url))}${delimiter}${process.env.PATH ?? ""}`;
