'use client';
/**
 * Success celebrations: Touchdown! / It's good!
 * 🏈 Katelyn's idea. She came up with football moments only on success, so these are
 * the ONLY football graphics anywhere in Handoff. Keep it that way.
 * Spec: frontend-build.md §8.
 */
import { motion, useReducedMotion } from 'framer-motion';
import Image from 'next/image';
import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { copy } from '@/lib/copy';

export type CelebrationKind = 'touchdown' | 'fieldgoal';

const CONFETTI_COLORS = ['#FFD84D', '#B9F0D0', '#FFFFFF', '#FFE3D6'];

export function Celebration({ kind, title, line, onDone }: { kind: CelebrationKind; title: string; line: string; onDone: () => void }) {
  const reduce = useReducedMotion();
  const doneRef = useRef<HTMLButtonElement>(null);
  const confetti = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => ({
        left: Math.random() * 100,
        delay: 0.7 + Math.random() * 0.6,
        dur: 1.6 + Math.random() * 1.4,
        rot: (Math.random() - 0.5) * 720,
        drift: (Math.random() - 0.5) * 120,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      })),
    [],
  );

  useEffect(() => {
    const t = setTimeout(() => doneRef.current?.focus(), 1100);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDone();
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [onDone]);

  const d = (s: number) => (reduce ? 0 : s);

  const node = (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden px-6 text-center"
      style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
      initial={{ opacity: 0, scale: 1.04 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
    >
      {!reduce &&
        confetti.map((c, i) => (
          <motion.span
            key={i}
            className="pointer-events-none absolute top-0 block"
            style={{ left: `${c.left}%`, width: 9, height: 14, background: c.color, border: '2px solid #1A1414' }}
            initial={{ y: -40, x: 0, rotate: 0, opacity: 0 }}
            animate={{ y: '110vh', x: c.drift, rotate: c.rot, opacity: 1 }}
            transition={{ delay: c.delay, duration: c.dur, ease: 'easeIn' }}
          />
        ))}

      <div className="relative" style={{ width: 200, height: 220, transform: 'scale(1.25)' }}>
        <svg width="200" height="220" viewBox="0 0 200 220" aria-hidden>
          <g stroke="#FFD84D" strokeWidth="8" strokeLinecap="round" fill="none">
            <line x1="55" y1="10" x2="55" y2="120" />
            <line x1="145" y1="10" x2="145" y2="120" />
            <line x1="55" y1="120" x2="145" y2="120" />
            <line x1="100" y1="120" x2="100" y2="210" />
          </g>
        </svg>
        <motion.div
          className="absolute"
          style={{ left: 100 - 16, top: 58 - 10, width: 32, height: 20 }}
          initial={reduce ? false : { y: 380, scale: 1.6, rotate: 0 }}
          animate={{ y: 0, scale: 0.6, rotate: 720 }}
          transition={{ duration: d(0.95), ease: 'easeOut' }}
        >
          <svg width="32" height="20" viewBox="0 0 32 20" aria-hidden>
            <ellipse cx="16" cy="10" rx="14.75" ry="8.75" fill="#8A4B2A" stroke="#1A1414" strokeWidth="2.5" />
            <g stroke="#fff" strokeWidth="1.6" strokeLinecap="round">
              <line x1="10" y1="10" x2="22" y2="10" />
              <line x1="13" y1="7.5" x2="13" y2="12.5" />
              <line x1="16" y1="7.5" x2="16" y2="12.5" />
              <line x1="19" y1="7.5" x2="19" y2="12.5" />
            </g>
          </svg>
        </motion.div>
      </div>

      <motion.div
        initial={reduce ? false : { scale: 0.4, opacity: 0, rotate: -10 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ delay: d(0.75), type: 'spring', stiffness: 380, damping: 14 }}
      >
        <Image src="/brand/glyph-512.webp" alt="" width={72} height={72} priority />
      </motion.div>

      <motion.div
        className="relative mt-4"
        initial={reduce ? false : { scale: 0.3, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: d(0.8), type: 'spring', stiffness: 380, damping: 14 }}
      >
        <h2 className="font-display text-[46px] font-bold">{title}</h2>
        <span
          className="absolute -right-10 -top-4 rounded-full px-2.5 py-1 font-display text-lg font-bold"
          style={{ background: '#FFD84D', color: '#1A1414', border: '2.5px solid #1A1414', boxShadow: '3px 3px 0 #1A1414', transform: 'rotate(8deg)' }}
        >
          {kind === 'touchdown' ? '+6' : '+3'}
        </span>
      </motion.div>

      <motion.p
        className="mt-4 max-w-sm text-[17px] font-semibold"
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: d(0.95) }}
      >
        {line}
      </motion.p>

      <motion.button
        ref={doneRef}
        onClick={onDone}
        className="stk-btn label mt-8 rounded-full px-8 py-3.5"
        style={{ background: '#FFD84D', color: '#1A1414', borderColor: '#1A1414', boxShadow: '4px 4px 0 #1A1414' }}
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: d(1.05) }}
      >
        {copy.celebrate.done}
      </motion.button>
    </motion.div>
  );

  return typeof document !== 'undefined' ? createPortal(node, document.body) : null;
}
