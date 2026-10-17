import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Handoff',
    short_name: 'Handoff',
    description: 'Buy, sell and trade with verified UA students.',
    start_url: '/',
    display: 'standalone',
    background_color: '#FDF4EC',
    theme_color: '#9E1B32',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
