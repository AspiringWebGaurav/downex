import React, { useRef, useState, useEffect } from 'react';

export interface AutoScrollTextProps {
  text: string;
  className?: string;
  containerClassName?: string;
  placeholder?: string;
}

export const AutoScrollText: React.FC<AutoScrollTextProps> = ({
  text,
  className = '',
  containerClassName = '',
  placeholder = 'No URL provided',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [scrollDistance, setScrollDistance] = useState<number>(0);
  const [isOverflowing, setIsOverflowing] = useState<boolean>(false);

  useEffect(() => {
    const checkOverflow = () => {
      if (containerRef.current && textRef.current) {
        const containerWidth = containerRef.current.clientWidth;
        const textWidth = textRef.current.scrollWidth;
        if (textWidth > containerWidth + 4) {
          setIsOverflowing(true);
          setScrollDistance(textWidth - containerWidth + 16);
        } else {
          setIsOverflowing(false);
          setScrollDistance(0);
        }
      }
    };

    // Check after paint
    const timer = setTimeout(checkOverflow, 50);
    window.addEventListener('resize', checkOverflow);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', checkOverflow);
    };
  }, [text]);

  if (!text) {
    return (
      <div className={`w-full overflow-hidden ${containerClassName}`}>
        <span className="text-zinc-400 dark:text-zinc-500 italic font-sans text-xs">
          {placeholder}
        </span>
      </div>
    );
  }

  // Calculate dynamic duration: ~35px per second + 3s hold times
  const animDuration = Math.max(6, Math.min(18, (scrollDistance / 35) + 3));

  return (
    <div
      ref={containerRef}
      className={`w-full overflow-hidden relative group select-all ${containerClassName}`}
      title={text}
    >
      <style>{`
        @keyframes autoScrollPingPong {
          0%, 20% {
            transform: translateX(0);
          }
          50%, 70% {
            transform: translateX(calc(-1px * var(--scroll-dist)));
          }
          100% {
            transform: translateX(0);
          }
        }
        .animate-autoscroll-pingpong {
          animation: autoScrollPingPong var(--anim-duration) ease-in-out infinite;
        }
        .group:hover .animate-autoscroll-pingpong {
          animation-play-state: paused;
        }
      `}</style>
      <span
        ref={textRef}
        style={
          isOverflowing
            ? ({
                '--scroll-dist': `${scrollDistance}px`,
                '--anim-duration': `${animDuration}s`,
              } as React.CSSProperties)
            : undefined
        }
        className={`inline-block whitespace-nowrap will-change-transform ${
          isOverflowing ? 'animate-autoscroll-pingpong' : ''
        } ${className}`}
      >
        {text}
      </span>
    </div>
  );
};

