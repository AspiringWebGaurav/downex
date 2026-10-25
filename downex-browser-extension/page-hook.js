/**
 * @file page-hook.js
 * @package Downex — Enterprise Download Accelerator Companion (MV3)
 * @author Gaurav Patil <AspiringWebGaurav>
 * @license MIT
 * @copyright Copyright (c) 2026 Gaurav Patil. All rights reserved.
 * @description Main-world media stream extractor. Sniffs YouTube ytInitialPlayerResponse,
 *              DASH/HLS adaptive manifests, and HTML5 video sources with deduplication.
 * @security Zero external network requests. Communicates exclusively via window.postMessage.
 */
(function () {
  'use strict';

  const seenMediaUrls = new Set();
  let lastInspectedVideoId = '';

  function emitStreamData(payload) {
    window.postMessage(
      {
        source: 'DOWNEX_PAGE_HOOK',
        type: 'MEDIA_METADATA',
        data: payload,
      },
      '*'
    );
  }

  /* =========================================================================
     1. YOUTUBE ADAPTIVE STREAM EXTRACTOR
     ========================================================================= */

  function extractYouTubeVideoId() {
    try {
      const url = new URL(location.href);
      return url.searchParams.get('v') || '';
    } catch {
      return '';
    }
  }

  function inspectYouTube() {
    if (!location.hostname.includes('youtube.com')) return;

    const currentVid = extractYouTubeVideoId();
    let playerResponse = null;

    if (window.ytInitialPlayerResponse && (!currentVid || window.ytInitialPlayerResponse.videoDetails?.videoId === currentVid)) {
      playerResponse = window.ytInitialPlayerResponse;
    } else {
      const playerEl = document.getElementById('movie_player');
      if (playerEl && typeof playerEl.getPlayerResponse === 'function') {
        playerResponse = playerEl.getPlayerResponse();
      }
    }

    if (!playerResponse || !playerResponse.streamingData) return;

    const streaming = playerResponse.streamingData;
    const videoDetails = playerResponse.videoDetails || {};
    const title = videoDetails.title || document.title.replace(' - YouTube', '');
    const formats = [];

    function resolveFormatUrl(fmt) {
      if (fmt.url) return fmt.url;
      const cipher = fmt.signatureCipher || fmt.cipher;
      if (cipher) {
        try {
          const params = new URLSearchParams(cipher);
          const url = params.get('url');
          if (url) {
            const sig = params.get('s') || params.get('sig') || params.get('signature');
            const sp = params.get('sp') || 'sig';
            if (sig) {
              const sep = url.includes('?') ? '&' : '?';
              return `${url}${sep}${sp}=${encodeURIComponent(sig)}`;
            }
            return url;
          }
        } catch (_) {}
      }
      return null;
    }

    // Progressive Formats (Video + Audio combined)
    if (streaming.formats) {
      for (const fmt of streaming.formats) {
        const url = resolveFormatUrl(fmt);
        if (url) {
          formats.push({
            itag: fmt.itag,
            quality: fmt.qualityLabel || `${fmt.height}p`,
            fps: fmt.fps || 30,
            mimeType: fmt.mimeType,
            hasAudio: true,
            hasVideo: true,
            url,
            isAdaptive: false,
          });
        }
      }
    }

    // Adaptive Formats (High-Res Video + High-Bitrate Audio separated)
    let bestAudioUrl = null;
    let bestAudioBitrate = 0;

    if (streaming.adaptiveFormats) {
      for (const fmt of streaming.adaptiveFormats) {
        const isAudio = fmt.mimeType && fmt.mimeType.startsWith('audio/');
        const isVideo = fmt.mimeType && fmt.mimeType.startsWith('video/');
        const url = resolveFormatUrl(fmt);

        if (isAudio && url) {
          if (fmt.bitrate > bestAudioBitrate) {
            bestAudioBitrate = fmt.bitrate;
            bestAudioUrl = url;
          }
        }

        if (isVideo && url) {
          formats.push({
            itag: fmt.itag,
            quality: fmt.qualityLabel || `${fmt.height}p`,
            fps: fmt.fps || 30,
            mimeType: fmt.mimeType,
            hasAudio: false,
            hasVideo: true,
            url,
            isAdaptive: true,
          });
        }
      }
    }

    // Sort formats from highest resolution (4K -> 1440p -> 1080p -> 720p)
    formats.sort((a, b) => {
      const getP = (q) => parseInt(q.replace(/\D/g, ''), 10) || 0;
      return getP(b.quality) - getP(a.quality);
    });

    lastInspectedVideoId = currentVid;

    emitStreamData({
      source: 'youtube',
      title,
      videoId: currentVid,
      duration: videoDetails.lengthSeconds,
      formats,
      bestAudioUrl,
    });
  }

  // Hook YouTube SPA Navigation Events
  window.addEventListener('yt-navigate-finish', () => {
    setTimeout(inspectYouTube, 600);
    setTimeout(inspectYouTube, 1500);
  });

  window.addEventListener('yt-page-data-updated', () => {
    setTimeout(inspectYouTube, 600);
  });

  // History Push/Replace State hook for client-side routing
  const origPushState = history.pushState;
  history.pushState = function (...args) {
    origPushState.apply(this, args);
    setTimeout(inspectYouTube, 500);
  };

  const origReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    origReplaceState.apply(this, args);
    setTimeout(inspectYouTube, 500);
  };

  // Initial runs
  setTimeout(inspectYouTube, 800);
  setTimeout(inspectYouTube, 2500);

  /* =========================================================================
     2. DEDUPLICATED NETWORK SNIFFER (HLS M3U8, DASH MPD, MP4/WebM)
     ========================================================================= */

  function checkMediaUrl(url) {
    if (!url || typeof url !== 'string' || seenMediaUrls.has(url)) return;

    // Filter out repetitive chunks and fragment segments
    if (url.includes('.ts?') || url.includes('/frag-') || url.includes('range=') || url.includes('sq/')) {
      return;
    }

    const cleanUrl = url.split('?')[0].toLowerCase();
    if (
      cleanUrl.endsWith('.m3u8') ||
      cleanUrl.endsWith('.mpd') ||
      cleanUrl.endsWith('.mp4') ||
      cleanUrl.endsWith('.webm') ||
      cleanUrl.endsWith('.mkv') ||
      cleanUrl.endsWith('.mp3') ||
      cleanUrl.endsWith('.m4a')
    ) {
      seenMediaUrls.add(url);
      emitStreamData({
        source: 'network_sniff',
        url: url,
        title: document.title,
      });
    }
  }

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      if (url) checkMediaUrl(url);
    } catch {}
    return response;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      if (typeof url === 'string') checkMediaUrl(url);
    } catch {}
    return origOpen.apply(this, [method, url, ...rest]);
  };
})();
