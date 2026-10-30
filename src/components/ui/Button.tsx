import React, { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 
  | 'primary'            // High-contrast inverted (Brand: black in light, white in dark)
  | 'primary-emerald'    // Success / Primary Action (Emerald green)
  | 'secondary'          // Neutral surface action (Later, Open with...)
  | 'outline'            // Bordered neutral action (Browse, View...)
  | 'warning'            // Amber caution action (Reset to base, rollback)
  | 'destructive'        // Rose dangerous action (Uninstall, delete)
  | 'destructive-outline'// Bordered rose outline
  | 'neutral-dark'       // Slate dark action (Stop engine)
  | 'ghost'              // Transparent background, hover tint (Cancel, close X)
  | 'link';              // Underline text link

export type ButtonSize = 
  | 'sm'      // 28px height (compact, table chips, tight bars)
  | 'md'      // 32px height (standard flagship, matches "+ New Download")
  | 'lg'      // 36px height (dialog primaries, recovery cards)
  | 'icon'    // 32x32px square
  | 'icon-sm' // 28x28px square
  | 'icon-xs';// 24x24px square

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingText?: string;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
  shimmer?: boolean;
}

export function getButtonClassName({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
} = {}): string {
  // Base interaction & geometry contract (shared across all buttons)
  const baseClasses = 
    'inline-flex items-center justify-center font-sans font-semibold tracking-normal whitespace-nowrap ' +
    'select-none cursor-pointer transition-all duration-150 ease-out ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-offset-1 ' +
    'disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none disabled:active:scale-100 ' +
    'active:scale-[0.98] shadow-xs';

  // Sizing definitions
  const sizeClasses: Record<ButtonSize, string> = {
    sm: 'h-7 px-2.5 text-[11px] rounded-md gap-1.5',
    md: 'h-8 px-3.5 text-xs rounded-lg gap-1.5',
    lg: 'h-9 px-4 text-xs rounded-lg gap-2',
    icon: 'w-8 h-8 p-0 rounded-lg shrink-0',
    'icon-sm': 'w-7 h-7 p-0 rounded-md shrink-0',
    'icon-xs': 'w-6 h-6 p-0 rounded-md shrink-0',
  };

  // Semantic Variant palettes
  const variantClasses: Record<ButtonVariant, string> = {
    primary:
      'bg-zinc-900 text-white hover:bg-zinc-800 active:bg-black ' +
      'dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100 dark:active:bg-zinc-200 border border-transparent',

    'primary-emerald':
      'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white ' +
      'border border-emerald-500/30 dark:border-emerald-500/40',

    secondary:
      'bg-zinc-100 hover:bg-zinc-200/80 active:bg-zinc-300/80 text-zinc-700 ' +
      'dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:active:bg-zinc-750 text-zinc-700 dark:text-zinc-200 ' +
      'border border-zinc-200/80 dark:border-zinc-700/80',

    outline:
      'bg-white hover:bg-zinc-50 active:bg-zinc-100 text-zinc-700 ' +
      'dark:bg-zinc-900 dark:hover:bg-zinc-800 dark:active:bg-zinc-750 dark:text-zinc-200 ' +
      'border border-zinc-300/90 dark:border-zinc-700',

    warning:
      'bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white ' +
      'border border-amber-500/30',

    destructive:
      'bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white ' +
      'border border-rose-500/30',

    'destructive-outline':
      'bg-rose-50/60 hover:bg-rose-100 text-rose-700 border border-rose-200 ' +
      'dark:bg-rose-950/40 dark:hover:bg-rose-900/50 dark:text-rose-300 dark:border-rose-900/60',

    'neutral-dark':
      'bg-zinc-700 hover:bg-zinc-800 active:bg-zinc-900 text-white ' +
      'dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:active:bg-zinc-650 border border-zinc-600/30 dark:border-zinc-700/50',

    ghost:
      'bg-transparent hover:bg-zinc-100 active:bg-zinc-200 text-zinc-600 hover:text-zinc-900 ' +
      'dark:hover:bg-zinc-800 dark:active:bg-zinc-750 dark:text-zinc-400 dark:hover:text-zinc-100 border border-transparent shadow-none',

    link:
      'bg-transparent text-emerald-600 dark:text-emerald-400 hover:underline p-0 h-auto shadow-none active:scale-100 font-normal',
  };

  const widthClass = fullWidth ? 'w-full' : '';

  return `${baseClasses} ${sizeClasses[size] || sizeClasses.md} ${variantClasses[variant] || variantClasses.primary} ${widthClass} ${className}`.trim();
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      loadingText,
      icon,
      iconRight,
      fullWidth = false,
      shimmer = false,
      disabled = false,
      className = '',
      children,
      ...props
    },
    ref
  ) => {
    const isActuallyDisabled = disabled || loading;
    const computedClass = `${getButtonClassName({ variant, size, fullWidth, className })} ${shimmer ? 'relative overflow-hidden' : ''}`.trim();

    return (
      <button
        ref={ref}
        disabled={isActuallyDisabled}
        className={computedClass}
        {...props}
      >
        {shimmer && !isActuallyDisabled && (
          <span className="absolute inset-0 overflow-hidden rounded-[inherit] pointer-events-none z-0">
            <span className="animate-btn-shimmer" />
          </span>
        )}
        {loading ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 relative z-10" />
            <span className="whitespace-nowrap relative z-10">{loadingText || children}</span>
          </>
        ) : (
          <>
            {icon && <span className="shrink-0 flex items-center justify-center relative z-10">{icon}</span>}
            {children && <span className="whitespace-nowrap relative z-10">{children}</span>}
            {iconRight && <span className="shrink-0 flex items-center justify-center relative z-10">{iconRight}</span>}
          </>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';

