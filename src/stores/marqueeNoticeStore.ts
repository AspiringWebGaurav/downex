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
  showCountdown?: boolean;
  active: boolean;
  createdAt: number;
  updatedAt?: number;
  expiresAt: number | null;
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

  const colorMap: Record<MarqueeNoticeColor, { dot: string; glass: string }> = {
    zinc: {
      dot: 'bg-zinc-400 dark:bg-zinc-500',
      glass: 'bg-zinc-100/80 dark:bg-zinc-900/80 border-zinc-200/90 dark:border-zinc-700/75 text-zinc-700 dark:text-zinc-200',
    },
    emerald: {
      dot: 'bg-emerald-500',
      glass: 'bg-zinc-100/80 dark:bg-zinc-900/80 border-zinc-200/90 dark:border-zinc-700/75 text-zinc-700 dark:text-zinc-200',
    },
    rose: {
      dot: 'bg-rose-500',
      glass: 'bg-rose-50/75 dark:bg-rose-950/35 border-rose-200/80 dark:border-rose-800/60 text-zinc-800 dark:text-zinc-100',
    },
    amber: {
      dot: 'bg-amber-500',
      glass: 'bg-amber-50/75 dark:bg-amber-950/30 border-amber-200/80 dark:border-amber-800/60 text-zinc-800 dark:text-zinc-100',
    },
    sky: {
      dot: 'bg-sky-500',
      glass: 'bg-sky-50/70 dark:bg-sky-950/30 border-sky-200/80 dark:border-sky-800/60 text-zinc-800 dark:text-zinc-100',
    },
    violet: {
      dot: 'bg-violet-500',
      glass: 'bg-violet-50/70 dark:bg-violet-950/30 border-violet-200/80 dark:border-violet-800/60 text-zinc-800 dark:text-zinc-100',
    },
    indigo: {
      dot: 'bg-indigo-500',
      glass: 'bg-indigo-50/70 dark:bg-indigo-950/30 border-indigo-200/80 dark:border-indigo-800/60 text-zinc-800 dark:text-zinc-100',
    },
  };

  return {
    label,
    dotClass: colorMap[color].dot,
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
      const modeColor: MarqueeNoticeColor =
        typeof item.modeColor === 'string' && VALID_COLORS.has(item.modeColor)
          ? (item.modeColor as MarqueeNoticeColor)
          : DEFAULT_COLOR_BY_TONE[tone];
      return {
        ...item,
        text: item.text.trim(),
        tone,
        modeLabel:
          typeof item.modeLabel === 'string' && item.modeLabel.trim()
            ? item.modeLabel.trim().toUpperCase().slice(0, 14)
            : DEFAULT_LABEL_BY_TONE[tone],
        modeColor,
        direction: item.direction === 'rtl' ? 'rtl' : 'ltr',
        showCountdown: item.showCountdown === true,
        active: true,
        expiresAt: typeof item.expiresAt === 'number' ? item.expiresAt : null,
      };
    });
}

function loadCachedNotices(): MarqueeNotice[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return sanitizeActiveNotices(JSON.parse(raw));
  } catch {
    return [];
  }
}

interface MarqueeNoticeState {
  notices: MarqueeNotice[];
  noticePulse: boolean;
  setNotices: (list: unknown, isLivePush?: boolean) => void;
  pruneExpired: () => void;
}

export const useMarqueeNoticeStore = create<MarqueeNoticeState>((set, get) => ({
  notices: loadCachedNotices(),
  noticePulse: false,

  setNotices: (list: unknown, isLivePush = false) => {
    const clean = sanitizeActiveNotices(list);
    const prevIds = new Set(get().notices.map((n) => n.id));
    const hasNewNotice = clean.some((n) => !prevIds.has(n.id));

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    } catch {}

    set({ notices: clean });

    if (isLivePush && hasNewNotice) {
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
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
      } catch {}
      set({ notices: clean });
    }
  },
}));
