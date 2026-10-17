'use client';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';

// Token = HO-{orderId}-{floor(now/60s)} (frontend-build.md §12)
export const tokenFor = (orderId: string, minute: number) => `HO-${orderId}-${minute}`;
export const codeFor = (token: string) => {
  let h = 0;
  for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) | 0;
  return String(Math.abs(h) % 1_000_000).padStart(6, '0');
};

export function useMinute() {
  const [now, setNow] = useState(0); // 0 until mounted, avoids SSR/client time mismatch
  useEffect(() => { setNow(Date.now()); const i = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(i); }, []);
  return { ready: now > 0, minute: Math.floor(now / 60000), secsLeft: 60 - Math.floor((now % 60000) / 1000), frac: (now % 60000) / 60000 };
}

export function RotatingQR({ orderId }: { orderId: string }) {
  const { ready, minute, secsLeft, frac } = useMinute();
  const token = tokenFor(orderId, minute);
  const code = codeFor(token);
  const R = 150, C = 2 * Math.PI * R;
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-[330px] w-[330px] max-w-full">
        <svg viewBox="0 0 330 330" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
          <circle cx="165" cy="165" r={R} fill="none" stroke="var(--sunk)" strokeWidth="10" />
          <circle cx="165" cy="165" r={R} fill="none" stroke="var(--accent)" strokeWidth="10" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={ready ? C * frac : C} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          {ready && <AnimatePresence mode="popLayout">
            <motion.div
              key={token}
              initial={{ rotateY: 90, opacity: 0 }}
              animate={{ rotateY: 0, opacity: 1 }}
              exit={{ rotateY: -90, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="rounded-[18px] border-[2.5px] border-[#1A1414] bg-white p-3 shadow-[4px_4px_0_var(--shadow)]"
            >
              <QRCodeSVG value={token} size={180} fgColor="#1A1414" bgColor="#FFFFFF" />
            </motion.div>
          </AnimatePresence>}
        </div>
      </div>
      <p className="font-display mt-2 text-[40px] font-bold tracking-[0.12em] tabular-nums">{ready ? `${code.slice(0, 3)} ${code.slice(3)}` : '··· ···'}</p>
      <p className="text-[12.5px] font-bold text-soft">{ready ? `New code in ${secsLeft}s` : '\u00a0'}</p>
    </div>
  );
}
