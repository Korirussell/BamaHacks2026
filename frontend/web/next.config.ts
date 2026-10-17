import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // drei <Html> labels in the 3D campus break under StrictMode's dev double-mount (React 19).
  reactStrictMode: false,
  // Real-mode listing photos come from Supabase Storage.
  images: { remotePatterns: [{ protocol: 'https', hostname: '**.supabase.co' }, { protocol: 'http', hostname: '127.0.0.1' }, { protocol: 'http', hostname: 'localhost' }] },
  // Phones open the dev server by the laptop's IP or a tunnel (DEV_LAN_HOST, comma-separated, e.g. 10.127.178.217,x.ngrok-free.dev).
  allowedDevOrigins: (process.env.DEV_LAN_HOST ?? '').split(',').map(h => h.trim()).filter(Boolean),
  // API_PROXY_TARGET (e.g. http://localhost:8787): serve the API at /api/v1 on this origin, so one tunnel carries both.
  async rewrites() {
    const target = process.env.API_PROXY_TARGET?.replace(/\/$/, '');
    return target ? [{ source: '/api/v1/:path*', destination: `${target}/api/v1/:path*` }] : [];
  },
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
