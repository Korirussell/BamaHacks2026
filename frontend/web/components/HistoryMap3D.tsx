'use client';
import { motion, useReducedMotion } from 'framer-motion';
import { places } from '@/lib/data';

export type MapPin = { id: string; placeId: string; count: number; label: string };

const Y = 96 / Math.max(...places.map(p => p.map.y + p.map.h));
const center = (id: string) => { const p = places.find(x => x.id === id)!; return { x: p.map.x + p.map.w / 2, y: (p.map.y + p.map.h / 2) * Y }; };
const height = (kind: string) => (kind === 'library' ? 26 : kind === 'class' ? 22 : kind === 'student_center' ? 18 : kind === 'locker' ? 8 : 14);

/** Pure-CSS "3D" sticker map (features-v2 §5.5). Plane tilted with perspective; buildings are stacked layers. */
export function HistoryMap3D({ pins, focus, replay, onReplayEnd }: { pins: MapPin[]; focus?: string | null; replay?: { from: string; to: string; key: number } | null; onReplayEnd?: () => void }) {
  const reduce = useReducedMotion();
  const f = focus ? center(focus) : null;
  const a = replay ? center(replay.from) : null, b = replay ? center(replay.to) : null;
  return (
    <div className="stk relative h-full min-h-[420px] w-full overflow-hidden rounded-[24px] bg-sunk" style={{ perspective: 1200 }}>
      <motion.div
        className="absolute left-1/2 top-1/2 h-[78%] w-[86%]"
        style={{ transformStyle: 'preserve-3d', x: '-50%', y: '-46%', rotateX: 55 }}
        animate={reduce ? { rotateZ: -20 } : {
          rotateZ: f ? -20 + (f.x - 50) * 0.08 : [-26, -14, -26],
          scale: f ? 1.12 : 1,
        }}
        transition={f || reduce ? { type: 'spring', stiffness: 80, damping: 18 } : { duration: 16, repeat: Infinity, ease: 'easeInOut' }}
      >
        <div className="map-ground absolute inset-0 rounded-[22px] border-[2.5px] border-ink" style={{ transformStyle: 'preserve-3d' }}>
          {places.map(p => {
            const h = height(p.kind);
            return (
              <div key={p.id} className="absolute" style={{ left: `${p.map.x}%`, top: `${p.map.y * Y}%`, width: `${p.map.w}%`, height: `${p.map.h * Y}%`, transformStyle: 'preserve-3d' }}>
                {Array.from({ length: Math.ceil(h / 3) }, (_, i) => (
                  <div key={i} className="absolute inset-0 rounded-[6px] border-2 border-ink" style={{ transform: `translateZ(${i * 3}px)`, background: i === Math.ceil(h / 3) - 1 ? 'var(--card)' : 'var(--sunk)' }} />
                ))}
                <div className="absolute inset-0 flex items-center justify-center" style={{ transform: `translateZ(${h + 1}px)` }}>
                  <span className="truncate px-1 text-[7px] font-extrabold uppercase sm:text-[8.5px]">{p.kind === 'locker' ? '🔐 ' : ''}{p.name}</span>
                </div>
              </div>
            );
          })}
          {pins.map((pin, i) => {
            const c = center(pin.placeId);
            const p = places.find(x => x.id === pin.placeId)!;
            const on = focus === pin.placeId;
            return (
              <div key={pin.id} className="absolute" style={{ left: `${c.x}%`, top: `${c.y}%`, transformStyle: 'preserve-3d', transform: `translateZ(${height(p.kind) + 2}px)` }}>
                <motion.div
                  style={{ transformOrigin: 'bottom center', x: '-50%', y: '-100%', rotateX: -90 }}
                  animate={{ z: on ? [0, 24, 0] : [0, 6, 0], scale: on ? 1.25 : 1 }}
                  transition={{ duration: on ? 0.7 : 2.4, repeat: Infinity, delay: i * 0.2 }}
                  className="relative"
                >
                  <svg width="30" height="40" viewBox="0 0 34 44" aria-hidden>
                    <path d="M17 42 C17 42 3 26 3 16 A14 14 0 1 1 31 16 C31 26 17 42 17 42 Z" fill={on ? 'var(--butter)' : 'var(--accent)'} stroke="var(--ink)" strokeWidth="2.5" />
                    <circle cx="17" cy="16" r="5" fill="#fff" />
                  </svg>
                  {pin.count > 1 && <span className="absolute -right-3 -top-2 rounded-full border-2 border-ink bg-butter px-1 text-[9px] font-extrabold text-dark-ink">×{pin.count}</span>}
                </motion.div>
              </div>
            );
          })}
          {replay && a && b && (
            <motion.div
              key={replay.key}
              className="absolute"
              style={{ transformStyle: 'preserve-3d' }}
              initial={{ left: `${a.x}%`, top: `${a.y}%`, z: 20, rotate: 0 }}
              animate={{ left: [`${a.x}%`, `${(a.x + b.x) / 2}%`, `${b.x}%`], top: [`${a.y}%`, `${(a.y + b.y) / 2}%`, `${b.y}%`], z: [20, 160, 20], rotate: 720 }}
              transition={{ duration: 1.3, ease: 'easeInOut' }}
              onAnimationComplete={onReplayEnd}
            >
              <svg width="34" height="22" viewBox="0 0 32 20" style={{ transform: 'translate(-50%,-50%) rotateX(-55deg)' }} aria-hidden>
                <ellipse cx="16" cy="10" rx="14.75" ry="8.75" fill="#8A4B2A" stroke="#1A1414" strokeWidth="2.5" />
                <g stroke="#fff" strokeWidth="1.6" strokeLinecap="round"><line x1="10" y1="10" x2="22" y2="10" /><line x1="13" y1="7.5" x2="13" y2="12.5" /><line x1="16" y1="7.5" x2="16" y2="12.5" /><line x1="19" y1="7.5" x2="19" y2="12.5" /></g>
              </svg>
            </motion.div>
          )}
        </div>
      </motion.div>
      <span className="absolute bottom-3 left-4 rounded-full border-2 border-ink bg-card px-2.5 py-1 text-[10.5px] font-extrabold uppercase">University of Alabama</span>
    </div>
  );
}
