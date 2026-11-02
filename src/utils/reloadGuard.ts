/**
 * Downex Production Reload & Refresh Lockdown Guard
 *
 * Requirements:
 * - Production: Completely locks down hard refresh and UI reload shortcuts:
 *   - Ctrl + Shift + R / Cmd + Shift + R
 *   - Ctrl + F5 / Shift + F5 / Ctrl + Shift + F5
 *   - F5
 *   - Ctrl + R / Cmd + R
 *   - BrowserRefresh (multimedia keyboards)
 *   - Built-in page context menu containing "Reload" (while preserving input/textarea editing)
 * - Development: Keeps all shortcuts and reload mechanisms fully functional for debugging.
 * - Architecture: Attaches to window in the capture phase to intercept before any DOM child
 *   or component can suppress or miss the event. Protects all windows (main, download_dialog,
 *   download_complete) from a single early root entry point.
 */

export function isProductionEnvironment(): boolean {
  if (typeof window === 'undefined') return false;

  // Explicit testing override for automated test suites
  if (typeof (window as any).__DOWNEX_FORCE_PRODUCTION__ === 'boolean') {
    return (window as any).__DOWNEX_FORCE_PRODUCTION__;
  }

  const env = (import.meta as any).env;

  // Vite compile-time environment flags
  if (env?.PROD) {
    return true;
  }
  if (env?.DEV) {
    return false;
  }

  // Fallback checks
  return env?.MODE === 'production';
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
  // 1. Any F5 key press (F5, Ctrl+F5, Shift+F5, Ctrl+Shift+F5)
  if (e.key === 'F5' || e.code === 'F5' || e.keyCode === 116) {
    return true;
  }

  // 2. Dedicated multimedia keyboard Refresh key
  if (e.key === 'BrowserRefresh' || e.key === 'Refresh') {
    return true;
  }

  // 3. Ctrl+R / Ctrl+Shift+R / Cmd+R / Cmd+Shift+R
  // Note: Must exclude e.altKey to safeguard AltGr character typing on international keyboards
  const isCtrlOrMeta = (e.ctrlKey || e.metaKey) && !e.altKey;
  if (isCtrlOrMeta) {
    const isR =
      e.key === 'r' ||
      e.key === 'R' ||
      e.code === 'KeyR' ||
      e.keyCode === 82;
    if (isR) {
      return true;
    }
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
  return false;
}

export interface ReloadGuardOptions {
  force?: boolean;
}

/**
 * Initializes the reload guard on the current window.
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

    if (isReloadKeyEvent(e)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
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
    }
  };

  // Register in capture phase so listeners intercept before any DOM tree children
  window.addEventListener('keydown', handleKeyEvent, { capture: true, passive: false });
  window.addEventListener('keyup', handleKeyEvent, { capture: true, passive: false });
  window.addEventListener('contextmenu', handleContextMenu, { capture: true, passive: false });

  // Expose status helpers globally for tests & diagnostic verification
  (window as any).__DOWNEX_IS_PRODUCTION__ = isProductionEnvironment;
  (window as any).__DOWNEX_IS_RELOAD_LOCK_ACTIVE__ = isReloadLockActive;

  return () => {
    window.removeEventListener('keydown', handleKeyEvent, { capture: true });
    window.removeEventListener('keyup', handleKeyEvent, { capture: true });
    window.removeEventListener('contextmenu', handleContextMenu, { capture: true });
    delete (window as any).__DOWNEX_RELOAD_GUARD_INITIALIZED__;
  };
}
