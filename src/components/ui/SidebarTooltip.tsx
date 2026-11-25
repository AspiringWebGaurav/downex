import React, {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

interface SidebarTooltipProps {
  label: string;
  subLabel?: string;
  shortcut?: string;
  badge?: string | number;
  badgeTone?: 'emerald' | 'amber' | 'zinc';
  side?: 'right' | 'top' | 'bottom';
  disabled?: boolean;
  darkMode?: boolean;
  children: ReactNode;
  className?: string;
}

interface Position {
  top: number;
  left: number;
  positioned: boolean;
}

export const SidebarTooltip: React.FC<SidebarTooltipProps> = ({
  label,
  subLabel,
  shortcut,
  badge,
  badgeTone = 'zinc',
  side = 'right',
  disabled = false,
  darkMode = false,
  children,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Position>({ top: 0, left: 0, positioned: false });
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const pointerSuppressedRef = useRef(false);

  const updatePosition = useCallback(() => {
    const tr = triggerRef.current?.getBoundingClientRect();
    const tp = tipRef.current?.getBoundingClientRect();
    if (!tr || !tp) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 8;
    const margin = 8;

    let left = 0;
    let top = 0;

    if (side === 'right') {
      left = tr.right + gap;
      top = tr.top + (tr.height - tp.height) / 2;
      // Clamp horizontally if overflowing right
      if (left + tp.width > vw - margin) {
        left = tr.left - tp.width - gap;
      }
    } else if (side === 'top') {
      top = tr.top - gap - tp.height;
      left = tr.left + (tr.width - tp.width) / 2;
    } else {
      top = tr.bottom + gap;
      left = tr.left + (tr.width - tp.width) / 2;
    }

    top = Math.min(Math.max(margin, top), Math.max(margin, vh - margin - tp.height));
    left = Math.min(Math.max(margin, left), Math.max(margin, vw - margin - tp.width));

    setPos({ top, left, positioned: true });
  }, [side]);

  useLayoutEffect(() => {
    if (!open) {
      setPos((prev) => (prev.positioned ? { top: 0, left: 0, positioned: false } : prev));
      return;
    }
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, label, subLabel, updatePosition]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleMouseEnter = () => {
    if (disabled) return;
    pointerSuppressedRef.current = false;
    clearTimer();
    // Fast 120ms micro-delay for smooth hover experience
    timerRef.current = window.setTimeout(() => setOpen(true), 120);
  };

  const handleMouseLeave = () => {
    pointerSuppressedRef.current = false;
    clearTimer();
    setOpen(false);
  };

  const handleMouseDown = () => {
    // Dismiss instantly on click
    pointerSuppressedRef.current = true;
    clearTimer();
    setOpen(false);
  };

  const badgeBgClass =
    badgeTone === 'emerald'
      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
      : badgeTone === 'amber'
      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
      : 'bg-zinc-700/60 text-zinc-300 border border-zinc-600/50';

  const tooltipElement =
    !disabled && open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            style={{
              top: `${pos.top}px`,
              left: `${pos.left}px`,
              visibility: pos.positioned ? 'visible' : 'hidden',
            }}
            className={`pointer-events-none fixed z-[9999] select-none rounded-md px-2.5 py-1.5 shadow-xl backdrop-blur-md text-left transition-opacity duration-150 animate-in fade-in-0 zoom-in-95 border ${
              darkMode
                ? 'bg-zinc-900/95 text-zinc-100 border-zinc-700/80 shadow-black/40'
                : 'bg-zinc-900/95 text-white border-zinc-800 shadow-black/20'
            }`}
          >
            <div className="flex items-center gap-2 whitespace-nowrap">
              <span className="text-[11.5px] font-semibold tracking-tight font-mono-tabular">{label}</span>
              {badge !== undefined && (
                <span
                  className={`text-[9.5px] font-mono-tabular font-bold px-1.5 py-0.5 rounded-full leading-none ${badgeBgClass}`}
                >
                  {badge}
                </span>
              )}
              {shortcut && (
                <kbd className="text-[9.5px] font-mono-tabular px-1.5 py-0.5 rounded bg-zinc-800/90 text-zinc-300 border border-zinc-700/80 leading-none">
                  {shortcut}
                </kbd>
              )}
            </div>
            {subLabel && (
              <div className="text-[10px] font-mono-tabular text-zinc-400 mt-0.5 whitespace-nowrap leading-tight">
                {subLabel}
              </div>
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <div
      ref={triggerRef}
      className={`${className.includes('absolute') || className.includes('fixed') ? '' : 'relative'} ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
    >
      {children}
      {tooltipElement}
    </div>
  );
};
