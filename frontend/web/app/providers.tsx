'use client';
import { ThemeProvider, useTheme } from 'next-themes';
import { Toaster } from 'sonner';
import type { ReactNode } from 'react';
import { DemoProvider } from '@/lib/store';

function Toasts() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      position="top-center"
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: 'stk-sm flex items-center gap-2 rounded-[16px] bg-butter px-4 py-3 text-[14px] font-bold text-dark-ink w-[min(92vw,380px)]',
        },
      }}
    />
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <DemoProvider>
        {children}
        <Toasts />
      </DemoProvider>
    </ThemeProvider>
  );
}
