import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Docker image builds a self-contained server in .next/standalone (BUILD_STANDALONE=1 in the
  // Dockerfile); everywhere else, `npm start` runs the normal build.
  output: process.env.BUILD_STANDALONE ? "standalone" : undefined,
  // Loaded by Node at runtime rather than bundled: PGlite ships WebAssembly and data files, and
  // the Cloud Storage client has optional native pieces. (pg, playwright, and sharp are external by default.)
  serverExternalPackages: ["@electric-sql/pglite", "@electric-sql/pglite-pgvector", "@google-cloud/storage"],
  outputFileTracingIncludes: {
    // The Chrome extension's source, read by its download route (which zips it up for each workspace).
    "/api/extension/download": ["./extension/**/*"],
    // Playwright reads files the tracer can't see (browsers.json, lazily required modules); without
    // all of it the screenshot browser fails to start in the production build.
    "/*": ["./node_modules/playwright/**/*", "./node_modules/playwright-core/**/*"],
  },
  // Uploads (logos, avatars, widget images) go through server actions, whose 1MB default is below
  // the 2–3MB the forms allow.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  // Keep the dev-only Next.js badge off the sidebar's account menu.
  // The Next.js badge would sit inside embedded frames (the widget) in development.
  devIndicators: false,
  // In development only: lets http://127.0.0.1 load the dev server's scripts too (handy for testing
  // two sign-ins side by side, since localhost and 127.0.0.1 keep separate cookies).
  allowedDevOrigins: ["127.0.0.1"],
  // The root shows the help center home itself (a 200, not a redirect), so health checks on "/" see the server as up.
  async rewrites() {
    return [{ source: "/", destination: "/help" }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
