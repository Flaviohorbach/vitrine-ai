import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Packages that load WebAssembly or files at runtime: keep them out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "@electric-sql/pglite-pgvector"],
};

export default nextConfig;
