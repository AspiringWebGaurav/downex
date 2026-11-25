/**
 * Downex Production Reload & Refresh Lockdown Guard
 *
 * Requirements:
 * - Production / Base App: Completely locks down hard refresh and UI reload shortcuts:
 *   - Ctrl + F5 / Shift + F5 / Ctrl + Shift + F5
 *   - Ctrl + Shift + R / Cmd + Shift + R
 *   - F5
 *   - Ctrl + R / Cmd + R
 *   - BrowserRefresh / Refresh (multimedia keyboards)
 *   - DevTools: F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C
 *   - Browser Print (Ctrl+P), Save Page (Ctrl+S), View Source (Ctrl+U)
 *   - History Navigation: Alt+Left, Alt+Right
 *   - Page Context Menu containing "Reload" (while preserving input/textarea editing)
 * - Development: Keeps all shortcuts and reload mechanisms fully functional for debugging.
 * - Architecture: Attaches to window & document in capture phase to intercept before any DOM child
 *   or component can suppress or miss the event. Protects all windows (main, download_dialog,
 *   download_complete) from a single early root entry point.
 */

export function isProductionEnvironment(): boolean {
  if (typeof window === 'undefined') return false;

  // Explicit testing override for automated test suites
  if (typeof (window as any).__DOWNEX_FORCE_PRODUCTION__ === 'boolean') {
    return (window as any).__DOWNEX_FORCE_PRODUCTION__;
  }
  if (typeof (window as any).__DOWNEX_FORCE_DEV__ === 'boolean') {
    return !(window as any).__DOWNEX_FORCE_DEV__;
  }

  // Compile-time production bundle flag takes strict precedence over host/port heuristics
  if (import.meta.env.PROD) {
    return true;
  }

  // If running on Vite dev server port (1420, 5173, 3000), consider development mode
  try {
    if (window.location && window.location.port && ['1420', '5173', '3000'].includes(window.location.port)) {
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return false;
      }
    }
  } catch {}

  if (import.meta.env.DEV) {
    return false;
  }

  // Fallback checks: In desktop base app or production builds, defaults to true (locked)
  return import.meta.env.MODE !== 'development';
}

export function isDevEnvironment(): boolean {
  return !isProductionEnvironment();
}

export function isReloadLockActive(): boolean {
  if (typeof window === 'undefined') return false;

  if (typeof (window as any).__DOWNEX_LOCK_REFRESH__ === 'boolean') {
    return (window as any).__DOWNEX_LOCK_REFRESH__;
  }

  return isProductionEnvironment();
}

/**
 * Accurately determines if a keyboard event represents a browser reload or hard refresh action.
 */
export function isReloadKeyEvent(e: KeyboardEvent): boolean {
  const key = (e.key || '').toLowerCase();
  const code = e.code || '';
  const keyCode = e.keyCode || (e as any).which || 0;

  // 1. Any F5 key press (F5, Ctrl+F5, Shift+F5, Ctrl+Shift+F5)
  if (key === 'f5' || code === 'F5' || keyCode === 116) {
    return true;
  }

  // 2. Dedicated multimedia keyboard Refresh key
  if (key === 'browserrefresh' || key === 'refresh') {
    return true;
  }

  // 3. Ctrl+R / Ctrl+Shift+R / Cmd+R / Cmd+Shift+R
  // Note: Must exclude e.altKey to safeguard AltGr character typing on international keyboards
  const isCtrlOrMeta = (e.ctrlKey || e.metaKey) && !e.altKey;
  if (isCtrlOrMeta) {
    if (key === 'r' || code === 'KeyR' || keyCode === 82) {
      return true;
    }
  }

  return false;
}

/**
 * Accurately determines if a keyboard event represents a browser action that should be
 * locked down in production to prevent blank screens, devtools opening, or page unloads.
 * Preserves application shortcuts: Ctrl+K (Search), Ctrl+N (New Download), Ctrl+C/V/X/A/Z.
 */
export function isBlockedBrowserAction(e: KeyboardEvent): boolean {
  if (isReloadKeyEvent(e)) return true;

  const key = (e.key || '').toLowerCase();
  const code = e.code || '';
  const isCtrlOrMeta = (e.ctrlKey || e.metaKey) && !e.altKey;

  // 1. DevTools: F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C
  if (key === 'f12' || code === 'F12') return true;
  if (
    isCtrlOrMeta &&
    e.shiftKey &&
    ['i', 'j', 'c'].includes(key)
  ) {
    return true;
  }

  // 2. Browser Page Actions: Ctrl+P (Print), Ctrl+S (Save), Ctrl+U (View Source)
  if (
    isCtrlOrMeta &&
    !e.shiftKey &&
    ['p', 's', 'u'].includes(key)
  ) {
    return true;
  }

  // 3. Caret & Find: F7, F3
  if (key === 'f7' || key === 'f3') return true;

  // 4. Browser History Navigation: Alt+LeftArrow, Alt+RightArrow
  if (
    e.altKey &&
    (key === 'arrowleft' || key === 'arrowright' || code === 'ArrowLeft' || code === 'ArrowRight')
  ) {
    return true;
  }

  return false;
}

/**
 * Checks if a context menu event is targeted at a user-editable text field
 * (where cut, copy, paste, select all are legitimate and should remain accessible).
 */
export function isEditableElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toUpperCase();
  if (tagName === 'INPUT') {
    const inputType = (target as HTMLInputElement).type?.toLowerCase();
    const nonTextTypes = ['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image'];
    return !nonTextTypes.includes(inputType);
  }
  if (tagName === 'TEXTAREA') return true;
  if (target.isContentEditable) return true;
  if (typeof (target as any).closest === 'function' && Boolean((target as any).closest('[contenteditable="true"]'))) {
    return true;
  }
  return false;
}

export interface ReloadGuardOptions {
  force?: boolean;
}

/**
 * Initializes the reload guard on the current window and document.
 * Returns an unbind cleanup function.
 */
export function setupReloadGuard(options?: ReloadGuardOptions): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  // Prevent duplicate event listener registration
  if ((window as any).__DOWNEX_RELOAD_GUARD_INITIALIZED__) {
    return () => {};
  }
  (window as any).__DOWNEX_RELOAD_GUARD_INITIALIZED__ = true;

  const shouldLock = (): boolean => {
    if (options?.force !== undefined) {
      return options.force;
    }
    return isReloadLockActive();
  };

  const handleKeyEvent = (e: KeyboardEvent) => {
    if (!shouldLock()) {
      return;
    }

    if (isBlockedBrowserAction(e)) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }
    }
  };

  const handleContextMenu = (e: MouseEvent) => {
    if (!shouldLock()) {
      return;
    }

    // In production, block the page context menu (which exposes the built-in "Reload" option)
    // while preserving the standard text editing context menu inside input / textarea elements.
    if (!isEditableElement(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }
    }
  };

  // Register in capture phase on BOTH window and document so listeners intercept before any DOM tree children
  window.addEventListener('keydown', handleKeyEvent, { capture: true, passive: false });
  window.addEventListener('keyup', handleKeyEvent, { capture: true, passive: false });
  document.addEventListener('keydown', handleKeyEvent, { capture: true, passive: false });
  document.addEventListener('keyup', handleKeyEvent, { capture: true, passive: false });

  window.addEventListener('contextmenu', handleContextMenu, { capture: true, passive: false });
  document.addEventListener('contextmenu', handleContextMenu, { capture: true, passive: false });

  // Expose status helpers globally for tests & diagnostic verification
  (window as any).__DOWNEX_IS_PRODUCTION__ = isProductionEnvironment;
  (window as any).__DOWNEX_IS_DEV__ = isDevEnvironment;
  (window as any).__DOWNEX_IS_RELOAD_LOCK_ACTIVE__ = isReloadLockActive;

  return () => {
    window.removeEventListener('keydown', handleKeyEvent, { capture: true });
    window.removeEventListener('keyup', handleKeyEvent, { capture: true });
    document.removeEventListener('keydown', handleKeyEvent, { capture: true });
    document.removeEventListener('keyup', handleKeyEvent, { capture: true });

    window.removeEventListener('contextmenu', handleContextMenu, { capture: true });
    document.removeEventListener('contextmenu', handleContextMenu, { capture: true });

    delete (window as any).__DOWNEX_RELOAD_GUARD_INITIALIZED__;
  };
}
