import type { NextConfig } from "next";

const isExport = process.env.OUTPUT_EXPORT === "true";
const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() || "";
const basePath = rawBasePath
  ? `/${rawBasePath.replace(/^\/+|\/+$/g, "")}`
  : undefined;

const nextConfig: NextConfig = {
  output: isExport ? "export" : undefined,
  basePath: basePath,
  assetPrefix: basePath,
  trailingSlash: isExport,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
