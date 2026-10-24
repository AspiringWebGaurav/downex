import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { DownloadDialogWindow } from './windows/DownloadDialogWindow';
import { DownloadCompleteWindow } from './windows/DownloadCompleteWindow';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

function Root() {
  const [windowLabel, setWindowLabel] = useState<string>(() => {
    if (window.location.search.includes('window=download_dialog')) {
      return 'download_dialog';
    }
    if (window.location.search.includes('window=download_complete')) {
      return 'download_complete';
    }
    return 'main';
  });

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

  if (windowLabel === 'download_dialog' || window.location.search.includes('window=download_dialog')) {
    return <DownloadDialogWindow />;
  }

  if (windowLabel === 'download_complete' || window.location.search.includes('window=download_complete')) {
    return <DownloadCompleteWindow />;
  }

  return <App />;
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
