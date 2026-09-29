import { resolve } from "node:path";
import { browsersTheme } from "./shiki-theme";

/** Bundled from the checkout's sources: a deploy needs neither dist/ nor the root node_modules. */
const librarySource = resolve(import.meta.dirname, "../src");
/** `src/version.ts` reads `../package.json`, so dev has to be allowed the whole repo, not `src/` alone. */
const repoRoot = resolve(import.meta.dirname, "..");

export default defineNuxtConfig({
  extends: ["docus"],
  /** The repo root is its own pnpm workspace; Nuxt must not treat it as this site's. */
  workspaceDir: import.meta.dirname,
  alias: {
    /** Tool names, labels, descriptions and output bounds. The file imports nothing, so the page can. */
    "#tool-contract": resolve(librarySource, "tool-contract.ts"),
  },
  vite: {
    build: { target: "es2024" },
    server: {
      /** Dev serves the library from outside the workspace, which Vite refuses without this. */
      fs: { allow: [repoRoot] },
    },
  },
  devtools: { enabled: false },
  telemetry: false,
  site: {
    url: "https://browsers.agntn.dev",
    name: "@agntn/browsers",
  },
  llms: {
    domain: "https://browsers.agntn.dev",
    title: "@agntn/browsers",
    description:
      "One scrape call over Steel, Browserbase, Kernel, Browserless, Hyperbrowser, Anchor, Cloudflare and local Playwright, as a library, a CLI, an MCP server and Pi and OMP extensions.",
  },
  /** Docus pages define their own OG images; the alt text is the one thing they leave unset. */
  ogImage: {
    defaults: {
      alt: "@agntn/browsers: one scrape call over every browser backend",
    },
  },
  icon: {
    clientBundle: {
      icons: [
        "lucide:anchor",
        "lucide:anvil",
        "lucide:app-window",
        "lucide:arrow-down",
        "lucide:arrow-left",
        "lucide:arrow-right",
        "lucide:arrow-up",
        "lucide:arrow-up-right",
        "lucide:book-open",
        "lucide:bot",
        "lucide:camera",
        "lucide:check",
        "lucide:check-circle",
        "lucide:chevron-down",
        "lucide:chevron-left",
        "lucide:chevron-right",
        "lucide:chevrons-up-down",
        "lucide:circle-alert",
        "lucide:circle-check",
        "lucide:circle-x",
        "lucide:cloud",
        "lucide:container",
        "lucide:copy",
        "lucide:cpu",
        "lucide:drama",
        "lucide:expand",
        "lucide:external-link",
        "lucide:file-text",
        "lucide:keyboard",
        "lucide:layers",
        "lucide:link",
        "lucide:list-tree",
        "lucide:network",
        "lucide:plug",
        "lucide:plus",
        "lucide:rotate-ccw",
        "lucide:server",
        "lucide:terminal",
        "lucide:x",
        "lucide:zap",
        "simple-icons:github",
        "simple-icons:npm",
        "vscode-icons:file-type-js",
        "vscode-icons:file-type-json",
        "vscode-icons:file-type-shell",
        "vscode-icons:file-type-typescript",
      ],
    },
  },
  colorMode: {
    preference: "dark",
  },
  app: {
    head: {
      link: [
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
        { rel: "manifest", href: "/site.webmanifest" },
      ],
      meta: [
        { name: "theme-color", media: "(prefers-color-scheme: dark)", content: "#0b0d10" },
        { name: "theme-color", media: "(prefers-color-scheme: light)", content: "#eef1f4" },
        { name: "apple-mobile-web-app-title", content: "browsers" },
        { name: "author", content: "oritwoen" },
        { property: "og:locale", content: "en_US" },
      ],
    },
  },
  /** Docus ships an MCP endpoint that wants the Cloudflare Agents SDK on Workers. Not needed. */
  mcp: {
    enabled: false,
  },
  nitro: {
    preset: "cloudflare_module",
    compatibilityDate: "2026-09-03",
    prerender: {
      crawlLinks: true,
      routes: ["/", "/sitemap.xml", "/robots.txt", "/llms.txt", "/llms-full.txt"],
    },
    cloudflare: {
      deployConfig: true,
      nodeCompat: true,
    },
  },
  compatibilityDate: "2026-09-03",
  /** Fonts live in public/fonts and app/assets/fonts.css, where nuxt-og-image reads them from. */
  css: ["~/assets/fonts.css"],
  fonts: {
    families: [
      { name: "Figtree", provider: "local", weights: [400, 500] },
      { name: "Fira Code", provider: "local", weights: [400, 500] },
    ],
  },
  content: {
    database: {
      type: "d1",
      bindingName: "DB",
    },
    build: {
      markdown: {
        highlight: {
          theme: {
            default: browsersTheme,
            light: browsersTheme,
            dark: browsersTheme,
          },
        },
      },
    },
  },
});
