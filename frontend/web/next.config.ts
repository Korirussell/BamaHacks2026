import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // drei <Html> labels in the 3D campus break under StrictMode's dev double-mount (React 19).
  reactStrictMode: false,
  // Real-mode listing photos come from Supabase Storage.
  images: { remotePatterns: [{ protocol: 'https', hostname: '**.supabase.co' }, { protocol: 'http', hostname: '127.0.0.1' }, { protocol: 'http', hostname: 'localhost' }] },
  // Phones on the same Wi-Fi open the dev server by the laptop's IP (DEV_LAN_HOST, e.g. 10.127.178.217).
  allowedDevOrigins: process.env.DEV_LAN_HOST ? [process.env.DEV_LAN_HOST] : [],
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
