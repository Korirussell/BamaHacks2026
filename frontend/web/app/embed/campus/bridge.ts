// JS <-> Swift bridge contract for the iOS WKWebView embed (map-plan.md §3).
export type Pin = { id: string; placeId: string; label: string; count?: number; emoji?: string };
export type Pillar = { id: string; placeId: string; rank: number; label: string; selected?: boolean };

export type HandoffMapAPI = {
  setTheme(theme: 'light' | 'dark'): void;
  setPillars(pillars: Pillar[]): void;
  selectPillar(id: string): void;
  setPins(pins: Pin[]): void;
  focusPlace(placeId: string): void;
  replay(fromPlaceId: string, toPlaceId: string): void;
  setInteractive(on: boolean): void;
};

declare global {
  interface Window {
    handoffMap?: HandoffMapAPI;
    webkit?: { messageHandlers?: { handoff?: { postMessage: (message: unknown) => void } } };
  }
}

/** Fires every bridge event both to the native WKWebView handler and to window.parent (map-plan.md §3). */
export function sendToHost(type: string, payload: Record<string, unknown> = {}) {
  const message = { type, ...payload };
  try { window.webkit?.messageHandlers?.handoff?.postMessage(message); } catch { /* no native handler attached */ }
  try { window.parent?.postMessage(message, '*'); } catch { /* no embedding parent */ }
}
