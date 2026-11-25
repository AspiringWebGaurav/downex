import React, { useState } from 'react';
import { FileText, Shield, Mail, Lock, ArrowRight, Copy, Check } from 'lucide-react';
import { openExternalUrl, getDownexWebBaseUrl } from '../services/tauriService';

interface HardwareBannedViewProps {
  hwid?: string;
  reason?: string;
}

export const HardwareBannedView: React.FC<HardwareBannedViewProps> = ({
  hwid,
  reason,
}) => {
  const baseUrl = getDownexWebBaseUrl();
  const termsUrl = `${baseUrl}/terms#dos-and-donts`;
  const policiesUrl = `${baseUrl}/privacy`;
  const hardwarePatchUrl = `${baseUrl}/terms#hardware-enforcement`;

  const handleOpenTerms = (e: React.MouseEvent) => {
    e.preventDefault();
    openExternalUrl(termsUrl);
  };

  const handleOpenPolicies = (e: React.MouseEvent) => {
    e.preventDefault();
    openExternalUrl(policiesUrl);
  };

  const handleOpenHardwarePatch = (e: React.MouseEvent) => {
    e.preventDefault();
    openExternalUrl(hardwarePatchUrl);
  };

  const [copied, setCopied] = useState(false);

  const handleCopyId = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!hwid) return;
    try {
      await navigator.clipboard.writeText(hwid);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = hwid;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Plain-English subtitle without buzzwords matching exact user requirement
  const displaySubtitle =
    reason &&
    reason !== 'Administrative hardware ban enforced.' &&
    reason !== 'You have been banned from App Owner' &&
    reason !== 'You have been banned from ADMIN'
      ? reason
      : 'This is hardware patched. Formatting System and reinstalling App will not bypass this.';

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 select-none overflow-hidden justify-between">
      {/* 1. Full-Width Top Header Bar (Centered status strip) */}
      <div className="h-11 px-6 flex items-center justify-center border-b border-zinc-200/80 dark:border-zinc-800/80 shrink-0 bg-zinc-50/50 dark:bg-zinc-900/30">
        <div className="flex items-center gap-2 font-mono-tabular text-[10.5px] uppercase tracking-wider">
          <span className="text-red-600 dark:text-red-400 font-bold flex items-center gap-1.5">
            <Lock className="w-3 h-3 stroke-[2.5]" />
            DEVICE STATUS
          </span>
          <span className="text-zinc-300 dark:text-zinc-700">&bull;</span>
          <span className="text-zinc-400 dark:text-zinc-500 font-medium">ACCESS RESTRICTED</span>
        </div>
      </div>

      {/* 2. Spacious Full-Space Canvas (Even vertical distribution, matching Downex 2-column flat hairline symmetry) */}
      <div className="flex-1 flex flex-col items-center justify-evenly py-4 px-6 text-center relative overflow-hidden">
        {/* Soft subtle ambient background glow in dark theme */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[380px] h-[380px] rounded-full bg-red-500/[0.03] dark:bg-red-500/[0.05] blur-3xl" />
        </div>

        {/* Group 1: BAN! Badge + Title + Highlighted Subtitle with Inline Read More */}
        <div className="relative flex flex-col items-center max-w-[650px]">
          <div className="mb-3 flex items-center justify-center">
            <span className="inline-flex items-center px-6 py-1.5 bg-red-500 text-white font-mono-tabular text-[12px] font-black uppercase tracking-widest rounded-xs shadow-xs select-none">
              BAN!
            </span>
          </div>

          <h1 className="text-[17px] sm:text-[18px] font-bold text-zinc-950 dark:text-zinc-50 tracking-tight mb-2 font-sans">
            You have been banned from ADMIN
          </h1>

          <p className="text-[12px] sm:text-[12.5px] font-sans text-zinc-800 dark:text-zinc-200 font-medium leading-relaxed text-center">
            {displaySubtitle === 'This is hardware patched. Formatting System and reinstalling App will not bypass this.' ? (
              <>
                <span className="font-semibold text-zinc-950 dark:text-white">This is hardware patched.</span>{' '}
                Formatting System and reinstalling App will not bypass this.
              </>
            ) : (
              <span>{displaySubtitle}</span>
            )}{' '}
            <a
              href={hardwarePatchUrl}
              onClick={handleOpenHardwarePatch}
              className="text-zinc-950 dark:text-white hover:text-red-600 dark:hover:text-red-400 font-semibold underline underline-offset-3 cursor-pointer font-mono-tabular text-[11px] inline-flex items-center gap-0.5 transition-colors whitespace-nowrap ml-0.5"
              title="Learn why formatting will not bypass this ban"
            >
              <span>Read more</span>
              <ArrowRight className="w-3 h-3 stroke-[2.2]" />
            </a>
          </p>
        </div>

        {/* Group 2: Symmetric 2-Column Flat Hairline Info Strip (Native Downex Table Geometry) */}
        <div className="relative w-full max-w-[540px] grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200/80 dark:divide-zinc-800/80 border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/60 dark:bg-zinc-900/40 rounded-xs text-left">
          <div className="px-4 py-3 space-y-1">
            <div className="text-[9.5px] font-mono-tabular font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              App Access
            </div>
            <p className="text-[11.5px] font-sans text-zinc-700 dark:text-zinc-300 leading-snug">
              Downloads and queue are paused. Files already saved on your PC remain safe.
            </p>
          </div>
          <div className="px-4 py-3 space-y-1">
            <div className="text-[9.5px] font-mono-tabular font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              How to Appeal
            </div>
            <p className="text-[11.5px] font-sans text-zinc-700 dark:text-zinc-300 leading-snug">
              Copy your ID in the footer below and email it to Owner Contact for review.
            </p>
          </div>
        </div>

        {/* Group 3: Legal Links (Terms & Policies - Evenly spaced independently) */}
        <div className="relative flex items-center justify-center gap-3 text-xs font-mono-tabular">
          <a
            href={termsUrl}
            onClick={handleOpenTerms}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xs bg-zinc-100 hover:bg-zinc-200/80 dark:bg-zinc-900 dark:hover:bg-zinc-850 text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-zinc-50 transition-colors cursor-pointer border border-zinc-200 dark:border-zinc-800 text-[11px] font-mono-tabular font-medium"
          >
            <FileText className="w-3 h-3" />
            <span>Terms</span>
          </a>
          <span className="text-zinc-300 dark:text-zinc-700">&bull;</span>
          <a
            href={policiesUrl}
            onClick={handleOpenPolicies}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xs bg-zinc-100 hover:bg-zinc-200/80 dark:bg-zinc-900 dark:hover:bg-zinc-850 text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-zinc-50 transition-colors cursor-pointer border border-zinc-200 dark:border-zinc-800 text-[11px] font-mono-tabular font-medium"
          >
            <Shield className="w-3 h-3" />
            <span>Policies</span>
          </a>
        </div>

        {/* Group 4: Owner Contact (Evenly spaced independently) */}
        <div className="relative text-[11.5px] font-mono-tabular text-zinc-600 dark:text-zinc-400 flex items-center justify-center gap-1.5">
          <Mail className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" />
          <span>Owner Contact:</span>
          <a
            href="mailto:hello@gauravpatil.site"
            className="text-zinc-950 dark:text-zinc-100 hover:text-red-600 dark:hover:text-red-400 hover:underline font-semibold transition-colors font-mono-tabular"
          >
            hello@gauravpatil.site
          </a>
        </div>
      </div>

      {/* 3. Dedicated Bottom Footer Strip (Centered ID with Copy Action) */}
      <div className="h-10 px-6 border-t border-zinc-200/80 dark:border-zinc-800/80 flex items-center justify-center text-xs font-mono-tabular text-zinc-400 dark:text-zinc-500 shrink-0 bg-zinc-50/50 dark:bg-zinc-900/30 select-none">
        <div className="flex items-center gap-2 select-text">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase font-semibold text-zinc-400 dark:text-zinc-500 tracking-wider">ID:</span>
            <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300 font-mono-tabular tracking-wide">{hwid || 'N/A'}</span>
          </div>
          {hwid && (
            <button
              type="button"
              onClick={handleCopyId}
              title={copied ? 'Copied to clipboard!' : 'Copy ID'}
              className={`p-1 rounded-xs transition-colors cursor-pointer border ${
                copied
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                  : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 bg-transparent hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 border-transparent hover:border-zinc-300 dark:hover:border-zinc-700'
              }`}
            >
              {copied ? (
                <Check className="w-3 h-3 stroke-[2.2] text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3 stroke-[1.8]" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
