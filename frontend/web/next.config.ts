import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // drei <Html> labels in the 3D campus break under StrictMode's dev double-mount (React 19).
  reactStrictMode: false,
  // Real-mode listing photos come from Supabase Storage.
  images: { remotePatterns: [{ protocol: 'https', hostname: '**.supabase.co' }, { protocol: 'http', hostname: '127.0.0.1' }, { protocol: 'http', hostname: 'localhost' }] },
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
