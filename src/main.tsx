import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { DownloadDialogWindow } from './windows/DownloadDialogWindow';
import { DownloadCompleteWindow } from './windows/DownloadCompleteWindow';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import './App.css';

function getInitialWindowLabel(): string {
  if (typeof window !== 'undefined' && (window as any).__DOWNEX_WINDOW_LABEL__) {
    return (window as any).__DOWNEX_WINDOW_LABEL__;
  }
  const search = window.location.search;
  const path = window.location.pathname;
  if (
    search.includes('window=download_dialog') ||
    search.includes('modal=download') ||
    search.includes('view=dialog') ||
    path.includes('/download-dialog')
  ) {
    return 'download_dialog';
  }
  if (
    search.includes('window=download_complete') ||
    search.includes('modal=complete') ||
    search.includes('view=complete') ||
    path.includes('/download-complete')
  ) {
    return 'download_complete';
  }
  try {
    const internalLabel =
      (window as any).__TAURI_INTERNALS__?.metadata?.currentWebview?.label ||
      (window as any).__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
    if (internalLabel) return internalLabel;
    const current = getCurrentWebviewWindow();
    if (current && current.label) return current.label;
  } catch {}
  return 'main';
}

function Root() {
  const [windowLabel, setWindowLabel] = useState<string>(getInitialWindowLabel);

  useEffect(() => {
    try {
      const current = getCurrentWebviewWindow();
      if (current && current.label) {
        setWindowLabel(current.label);
      }
    } catch {
      // Browser preview fallback
    }
  }, []);

  const search = window.location.search;
  const path = window.location.pathname;

  if (
    windowLabel === 'download_dialog' ||
    search.includes('window=download_dialog') ||
    search.includes('modal=download') ||
    search.includes('view=dialog') ||
    path.includes('/download-dialog')
  ) {
    return <DownloadDialogWindow />;
  }

  if (
    windowLabel === 'download_complete' ||
    search.includes('window=download_complete') ||
    search.includes('modal=complete') ||
    search.includes('view=complete') ||
    path.includes('/download-complete')
  ) {
    return <DownloadCompleteWindow />;
  }

  return <App />;
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
