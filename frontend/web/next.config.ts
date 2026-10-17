import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // drei <Html> labels in the 3D campus break under StrictMode's dev double-mount (React 19).
  reactStrictMode: false,
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
