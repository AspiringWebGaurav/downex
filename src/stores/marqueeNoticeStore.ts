import { create } from 'zustand';

export type MarqueeNoticeTone =
  | 'info'
  | 'update'
  | 'alert'
  | 'tip'
  | 'warning'
  | 'event'
  | 'custom';

export type MarqueeNoticeColor =
  | 'zinc'
  | 'emerald'
  | 'rose'
  | 'sky'
  | 'amber'
  | 'violet'
  | 'indigo';

export type MarqueeNoticeDirection = 'ltr' | 'rtl';

export interface MarqueeNotice {
  id: string;
  text: string;
  tone: MarqueeNoticeTone;
  modeLabel?: string;
  modeColor?: MarqueeNoticeColor;
  direction: MarqueeNoticeDirection;
  speed?: number;
  showCountdown?: boolean;
  active: boolean;
  createdAt: number;
  updatedAt?: number;
  expiresAt: number | null;
}

export const DEFAULT_MARQUEE_SPEED = 1;

export function sanitizeNoticeSpeed(raw: unknown): number {
  const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(num) || num <= 0) return DEFAULT_MARQUEE_SPEED;
  return Math.min(2, Math.max(0.5, Math.round(num * 100) / 100));
}

export function computeMarqueeDurationSec(text: string, speed?: number): number {
  const safeSpeed = sanitizeNoticeSpeed(speed);
  const baseDuration = Math.min(34, Math.max(16, 14 + text.length * 0.14));
  return Math.round(Math.min(48, Math.max(8, baseDuration / safeSpeed)) * 10) / 10;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function stripDuplicateNoticePrefix(
  rawText: string,
  modeLabel?: string,
  tone?: MarqueeNoticeTone
): string {
  let clean = rawText.trim();
  const candidates = new Set<string>([
    'NOTICE',
    'NORMAL',
    'UPDATE',
    'ALERT',
    'TIP',
    'WARNING',
    'INFO',
    'CUSTOM',
  ]);
  if (modeLabel && modeLabel.trim()) {
    candidates.add(modeLabel.trim().toUpperCase());
  }
  if (tone && tone.trim()) {
    candidates.add(tone.trim().toUpperCase());
  }

  const pattern = new RegExp(
    `^(?:${Array.from(candidates).map(escapeRegExp).join('|')})\\s*(?::|—|–|-\\s+)\\s*`,
    'i'
  );

  for (let i = 0; i < 4; i++) {
    const next = clean.replace(pattern, '').trimStart();
    if (!next || next === clean) break;
    clean = next;
  }

  return clean;
}

const STORAGE_KEY = 'downex_marquee_notices';
const VALID_TONES = new Set<string>(['info', 'update', 'alert', 'tip', 'warning', 'event', 'custom']);
const VALID_COLORS = new Set<string>(['zinc', 'emerald', 'rose', 'sky', 'amber', 'violet', 'indigo']);

const DEFAULT_COLOR_BY_TONE: Record<MarqueeNoticeTone, MarqueeNoticeColor> = {
  info: 'zinc',
  update: 'emerald',
  alert: 'rose',
  tip: 'violet',
  warning: 'amber',
  event: 'sky',
  custom: 'indigo',
};

const DEFAULT_LABEL_BY_TONE: Record<MarqueeNoticeTone, string> = {
  info: 'NOTICE',
  update: 'UPDATE',
  alert: 'ALERT',
  tip: 'TIP',
  warning: 'WARNING',
  event: 'INFO',
  custom: 'CUSTOM',
};

export function resolveDesktopNoticeAppearance(notice: MarqueeNotice): {
  label: string;
  dotClass: string;
  dotRingClass: string;
  badgeClass: string;
  glassClass: string;
} {
  const color: MarqueeNoticeColor =
    notice.modeColor && VALID_COLORS.has(notice.modeColor)
      ? notice.modeColor
      : DEFAULT_COLOR_BY_TONE[notice.tone] || 'zinc';

  const label =
    (notice.modeLabel && notice.modeLabel.trim().toUpperCase()) ||
    DEFAULT_LABEL_BY_TONE[notice.tone] ||
    'NOTICE';

  const colorMap: Record<
    MarqueeNoticeColor,
    { dot: string; dotRing: string; badge: string; glass: string }
  > = {
    zinc: {
      dot: 'bg-zinc-600 dark:bg-zinc-300',
      dotRing: 'ring-2 ring-zinc-500/20',
      badge: 'bg-zinc-900/10 text-zinc-800 border-zinc-300/80 dark:bg-zinc-400/20 dark:text-zinc-200 dark:border-zinc-500/40',
      glass: 'bg-zinc-100/95 dark:bg-zinc-900/90 border-zinc-300/90 dark:border-zinc-600/80 text-zinc-950 dark:text-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.35)]',
    },
    emerald: {
      dot: 'bg-emerald-500',
      dotRing: 'ring-2 ring-emerald-500/25',
      badge: 'bg-emerald-500/15 text-emerald-800 border-emerald-500/30 dark:bg-emerald-400/20 dark:text-emerald-200 dark:border-emerald-400/35',
      glass: 'bg-emerald-50/95 dark:bg-emerald-950/60 border-emerald-300/90 dark:border-emerald-600/60 text-zinc-950 dark:text-white shadow-[0_1px_2px_rgba(16,185,129,0.12)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.35)]',
    },
    rose: {
      dot: 'bg-rose-500',
      dotRing: 'ring-2 ring-rose-500/25',
      badge: 'bg-rose-500/15 text-rose-700 border-rose-500/30 dark:bg-rose-400/20 dark:text-rose-200 dark:border-rose-400/35',
      glass: 'bg-rose-50/95 dark:bg-rose-950/60 border-rose-300/90 dark:border-rose-600/60 text-zinc-950 dark:text-white shadow-[0_1px_2px_rgba(244,63,94,0.12)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.35)]',
    },
    amber: {
      dot: 'bg-amber-500',
      dotRing: 'ring-2 ring-amber-500/25',
      badge: 'bg-amber-500/15 text-amber-800 border-amber-500/35 dark:bg-amber-400/20 dark:text-amber-200 dark:border-amber-400/35',
      glass: 'bg-amber-50/95 dark:bg-amber-950/60 border-amber-300/90 dark:border-amber-600/60 text-zinc-950 dark:text-white shadow-[0_1px_2px_rgba(245,158,11,0.12)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.35)]',
    },
    sky: {
      dot: 'bg-sky-500',
      dotRing: 'ring-2 ring-sky-500/25',
      badge: 'bg-sky-500/15 text-sky-800 border-sky-500/30 dark:bg-sky-400/20 dark:text-sky-200 dark:border-sky-400/35',
      glass: 'bg-sky-50/95 dark:bg-sky-950/60 border-sky-300/90 dark:border-sky-600/60 text-zinc-950 dark:text-white shadow-[0_1px_2px_rgba(14,165,233,0.12)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.35)]',
    },
    violet: {
      dot: 'bg-violet-500',
      dotRing: 'ring-2 ring-violet-500/25',
      badge: 'bg-violet-500/15 text-violet-800 border-violet-500/30 dark:bg-violet-400/20 dark:text-violet-200 dark:border-violet-400/35',
      glass: 'bg-violet-50/95 dark:bg-violet-950/60 border-violet-300/90 dark:border-violet-600/60 text-zinc-950 dark:text-white shadow-[0_1px_2px_rgba(139,92,246,0.14)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.35)]',
    },
    indigo: {
      dot: 'bg-indigo-500',
      dotRing: 'ring-2 ring-indigo-500/25',
      badge: 'bg-indigo-500/15 text-indigo-800 border-indigo-500/30 dark:bg-indigo-400/20 dark:text-indigo-200 dark:border-indigo-400/35',
      glass: 'bg-indigo-50/95 dark:bg-indigo-950/60 border-indigo-300/90 dark:border-indigo-600/60 text-zinc-950 dark:text-white shadow-[0_1px_2px_rgba(99,102,241,0.14)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.35)]',
    },
  };

  return {
    label,
    dotClass: colorMap[color].dot,
    dotRingClass: colorMap[color].dotRing,
    badgeClass: colorMap[color].badge,
    glassClass: colorMap[color].glass,
  };
}

let pulseTimer: ReturnType<typeof setTimeout> | null = null;

function sanitizeActiveNotices(list: unknown): MarqueeNotice[] {
  if (!Array.isArray(list)) return [];
  const now = Date.now();
  return list
    .filter((item): item is MarqueeNotice => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as MarqueeNotice;
      if (typeof candidate.text !== 'string' || !candidate.text.trim()) return false;
      if (candidate.active === false) return false;
      if (typeof candidate.expiresAt === 'number' && candidate.expiresAt <= now) return false;
      return true;
    })
    .map((item) => {
      const tone: MarqueeNoticeTone =
        typeof item.tone === 'string' && VALID_TONES.has(item.tone)
          ? (item.tone as MarqueeNoticeTone)
          : 'info';
      const modeLabel =
        typeof item.modeLabel === 'string' && item.modeLabel.trim()
          ? item.modeLabel.trim().toUpperCase().slice(0, 14)
          : DEFAULT_LABEL_BY_TONE[tone];
      const modeColor: MarqueeNoticeColor =
        typeof item.modeColor === 'string' && VALID_COLORS.has(item.modeColor)
          ? (item.modeColor as MarqueeNoticeColor)
          : DEFAULT_COLOR_BY_TONE[tone];
      const cleanText = stripDuplicateNoticePrefix(item.text, modeLabel, tone);
      const direction: MarqueeNoticeDirection = item.direction === 'rtl' ? 'rtl' : 'ltr';
      return {
        ...item,
        text: cleanText || item.text.trim(),
        tone,
        modeLabel,
        modeColor,
        direction,
        speed: sanitizeNoticeSpeed(item.speed),
        showCountdown: item.showCountdown === true,
        active: true,
        createdAt: Number(item.createdAt || now),
        updatedAt: Number(item.updatedAt || item.createdAt || now),
        expiresAt: typeof item.expiresAt === 'number' ? item.expiresAt : null,
      };
    })
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id)));
}

function clearLegacyCachedNotices(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

interface MarqueeNoticeState {
  notices: MarqueeNotice[];
  noticePulse: boolean;
  setNotices: (list: unknown, isLivePush?: boolean) => void;
  pruneExpired: () => void;
}

clearLegacyCachedNotices();

export const useMarqueeNoticeStore = create<MarqueeNoticeState>((set, get) => ({
  // Always start empty on boot so notices only reflect AFTER APP VERSION fetches, verifies & patches a live server packet
  notices: [],
  noticePulse: false,

  setNotices: (list: unknown, isLivePush = false) => {
    const clean = sanitizeActiveNotices(list);
    const prevSig = get()
      .notices.map((n) => `${n.id}:${n.updatedAt || n.createdAt}:${n.text}:${n.expiresAt ?? ''}`)
      .join('|');
    const nextSig = clean
      .map((n) => `${n.id}:${n.updatedAt || n.createdAt}:${n.text}:${n.expiresAt ?? ''}`)
      .join('|');
    const hasChanges = clean.length > 0 && nextSig !== prevSig;

    set({ notices: clean });

    if (isLivePush && hasChanges) {
      if (pulseTimer) clearTimeout(pulseTimer);
      set({ noticePulse: true });
      pulseTimer = setTimeout(() => {
        set({ noticePulse: false });
        pulseTimer = null;
      }, 2600);
    }
  },

  pruneExpired: () => {
    const clean = sanitizeActiveNotices(get().notices);
    if (clean.length !== get().notices.length) {
      set({ notices: clean });
    }
  },
}));

if (typeof window !== 'undefined' && (import.meta as any).env?.DEV) {
  (window as any).__DOWNEX_MARQUEE_STORE__ = useMarqueeNoticeStore;
}
