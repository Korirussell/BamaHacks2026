import type { Metadata, Viewport } from 'next';
import { Archivo, Fredoka } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { Shell } from '@/components/Shell';

const fredoka = Fredoka({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-fredoka' });
const archivo = Archivo({ subsets: ['latin'], weight: ['400', '500', '700', '800'], variable: '--font-archivo' });

export const metadata: Metadata = {
  title: 'Handoff',
  description: "Buy, sell and trade with verified UA students.",
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#9E1B32' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${fredoka.variable} ${archivo.variable}`}>
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
