'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeftRight, BookOpen, Home, Plus, Search, Ticket, User, X } from 'lucide-react';
import { useTheme } from 'next-themes';
import { DemoLoginPicker } from './DemoLoginPicker';

const RAIL = [
  { href: '/feed', label: 'Feed', icon: Home },
  { href: '/explore', label: 'Explore', icon: Search },
  { href: '/post', label: 'Post', icon: Plus, hot: true },
  { href: '/activity', label: 'Activity', icon: ArrowLeftRight },
  { href: '/tickets', label: 'Tickets & rides', icon: Ticket },
  { href: '/tutoring', label: 'Tutoring', icon: BookOpen },
  { href: '/profile', label: 'Profile', icon: User },
];

const MENU = [
  ['Feed', '/feed'], ['Explore', '/explore'], ['Post', '/post'], ['Activity', '/activity'], ['Tickets', '/tickets'],
  ['Rides', '/rides'], ['Tutoring', '/tutoring'], ['Profile', '/profile'], ['History', '/history'], ['Demo panel', '/admin/demo'],
];

const isActive = (path: string, href: string) => path === href || (href !== '/' && path.startsWith(href + '/'));

export function Logo({ className = '', onAccent }: { className?: string; onAccent?: boolean }) {
  return (
    <Link href="/" aria-label="Handoff home" className={`font-display block text-[24px] font-bold leading-[0.85] ${onAccent ? 'text-on-accent' : 'text-ink'} ${className}`}>
      Hand<br />off
    </Link>
  );
}

function Rail({ path }: { path: string }) {
  return (
    <nav aria-label="Main" className="fixed left-[18px] top-1/2 z-40 hidden -translate-y-1/2 flex-col gap-[10px] min-[900px]:flex">
      {RAIL.map(({ href, label, icon: Icon, hot }) => {
        const active = isActive(path, href);
        const base = hot ? 'bg-accent text-on-accent' : active ? 'bg-ink text-bg' : 'bg-sunk text-soft';
        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            className={`group relative flex h-12 w-12 items-center justify-center rounded-[14px] transition-all duration-150 ${base} hover:bg-card hover:text-ink hover:shadow-[inset_0_0_0_2px_var(--ink),3px_3px_0_var(--shadow)] focus-visible:bg-card focus-visible:text-ink focus-visible:shadow-[inset_0_0_0_2px_var(--ink),3px_3px_0_var(--shadow)] ${hot ? 'hover:!bg-accent hover:!text-on-accent' : ''}`}
          >
            <Icon size={20} strokeWidth={2.2} />
            <span className="pointer-events-none absolute left-[calc(100%+12px)] top-1/2 -translate-x-2 -translate-y-1/2 rotate-[-3deg] whitespace-nowrap rounded-full border-2 border-[#1A1414] bg-butter px-3 py-1 text-[12px] font-extrabold text-dark-ink opacity-0 shadow-[3px_3px_0_var(--shadow)] transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100">
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

export function ThemeSwitch({ onAccent }: { onAccent?: boolean }) {
  const { theme, setTheme } = useTheme();
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return (
    <div role="radiogroup" aria-label="Theme" className={`inline-flex rounded-full border-[2.5px] p-1 ${onAccent ? 'border-white' : 'border-ink bg-card'}`}>
      {(['system', 'light', 'dark'] as const).map(t => {
        const on = m && theme === t;
        return (
          <button
            key={t}
            role="radio"
            aria-checked={on}
            onClick={() => setTheme(t)}
            className={`label rounded-full px-4 py-2 capitalize ${on ? (onAccent ? 'bg-white text-[#9E1B32]' : 'bg-ink text-bg') : onAccent ? 'text-white' : 'text-ink'}`}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}

function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className="fixed inset-0 z-[90] overflow-y-auto bg-accent px-6 py-8 text-on-accent sm:px-12"
          initial={{ clipPath: 'circle(0% at 40px calc(100% - 40px))' }}
          animate={{ clipPath: 'circle(150% at 40px calc(100% - 40px))' }}
          exit={{ clipPath: 'circle(0% at 40px calc(100% - 40px))' }}
          transition={{ duration: 0.45, ease: [0.7, 0, 0.2, 1] }}
        >
          <div className="flex items-start justify-between">
            <span className="font-display text-[24px] font-bold leading-[0.85]">Hand<br />off</span>
            <button onClick={onClose} aria-label="Close menu" className="flex h-12 w-12 items-center justify-center rounded-full border-[2.5px] border-white">
              <X strokeWidth={2.6} />
            </button>
          </div>
          <nav className="mt-8 grid gap-1 sm:grid-cols-2">
            {MENU.map(([l, h], i) => (
              <motion.div key={h} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.035 }}>
                <Link href={h} onClick={onClose} className="font-display inline-block py-1 text-[44px] font-bold hover:underline sm:text-[56px]">
                  {l}
                </Link>
              </motion.div>
            ))}
          </nav>
          <div className="mt-10"><ThemeSwitch onAccent /></div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ScrollLine() {
  const [p, setP] = useState(0);
  useEffect(() => {
    const on = () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      setP(h > 0 ? Math.min(1, window.scrollY / h) : 0);
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => { window.removeEventListener('scroll', on); window.removeEventListener('resize', on); };
  }, []);
  return (
    <div aria-hidden className="fixed right-7 top-1/2 z-30 hidden h-[38vh] w-[1.5px] -translate-y-1/2 bg-ink/25 min-[900px]:block">
      <div className="absolute left-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink" style={{ top: `${p * 100}%` }} />
    </div>
  );
}

function CampusClock() {
  const [t, setT] = useState('');
  useEffect(() => {
    const f = () => setT(new Date().toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }));
    f();
    const i = setInterval(f, 10_000);
    return () => clearInterval(i);
  }, []);
  return (
    <div className="label fixed bottom-6 right-7 z-30 hidden text-[11.5px] text-soft min-[900px]:block" suppressHydrationWarning>
      Tuscaloosa, AL <span className="ml-1 text-ink tabular-nums">{t}</span>
    </div>
  );
}

function MobileTabBar({ path }: { path: string }) {
  const items = [
    { href: '/feed', label: 'Feed', icon: Home },
    { href: '/explore', label: 'Explore', icon: Search },
    { href: '/post', label: 'Post', icon: Plus, hot: true },
    { href: '/activity', label: 'Activity', icon: ArrowLeftRight },
    { href: '/profile', label: 'Profile', icon: User },
  ];
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 flex h-[68px] items-center justify-around border-t-[2.5px] border-ink bg-card pb-[env(safe-area-inset-bottom)] min-[900px]:hidden">
      {items.map(({ href, label, icon: Icon, hot }) =>
        hot ? (
          <Link key={href} href={href} aria-label={label} className="press -mt-7 flex h-14 w-14 items-center justify-center rounded-full border-[2.5px] border-ink bg-accent text-on-accent shadow-[3px_3px_0_var(--shadow)]">
            <Icon size={26} strokeWidth={2.6} />
          </Link>
        ) : (
          <Link key={href} href={href} aria-current={isActive(path, href) ? 'page' : undefined} className={`flex flex-col items-center gap-0.5 text-[10.5px] font-extrabold ${isActive(path, href) ? 'text-ink' : 'text-soft'}`}>
            <Icon size={21} strokeWidth={2.2} />
            {label}
          </Link>
        ),
      )}
    </nav>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname() || '/';
  const [menu, setMenu] = useState(false);
  // Claim page is a standalone, mobile-first page for sellers coming from an IG DM.
  // Embed routes are loaded inside the iOS WKWebView and must be full-viewport chrome (map-plan.md §3).
  if (path.startsWith('/claim') || path.startsWith('/embed')) return <>{children}</>;
  return (
    <>
      <DemoLoginPicker />
      <div className="fixed left-[18px] top-5 z-40 hidden min-[900px]:block"><Logo /></div>
      <Rail path={path} />
      <button onClick={() => setMenu(true)} className="label fixed bottom-6 left-[18px] z-40 hidden text-[12px] text-ink hover:text-accent-text min-[900px]:block">
        Menu <span className="tracking-[0.2em]">···</span>
      </button>
      <ScrollLine />
      <CampusClock />
      {/* mobile header */}
      <div className="flex items-center justify-between px-4 pt-4 min-[900px]:hidden">
        <Logo className="!text-[20px]" />
        <button onClick={() => setMenu(true)} className="label text-[12px]">Menu ···</button>
      </div>
      <main className="min-h-screen px-4 pb-28 pt-4 min-[900px]:pb-16 min-[900px]:pl-[100px] min-[900px]:pr-[72px] min-[900px]:pt-8">{children}</main>
      <MobileTabBar path={path} />
      <MenuSheet open={menu} onClose={() => setMenu(false)} />
    </>
  );
}
