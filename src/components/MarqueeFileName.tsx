import React, { useEffect, useState, useRef } from 'react';

interface MarqueeFileNameProps {
  name: string;
  className?: string;
}

export const MarqueeFileName: React.FC<MarqueeFileNameProps> = ({ name, className = '' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);

  useEffect(() => {
    const update = () => {
      if (containerRef.current && textRef.current) {
        const diff = textRef.current.scrollWidth - containerRef.current.clientWidth;
        setDistance(diff > 4 ? diff : 0);
      }
    };
    update();
    const t = setTimeout(update, 100);
    return () => clearTimeout(t);
  }, [name]);

  // Slow smooth reading speed: 10s - 24s depending on length, slow comfortable slide
  const duration = Math.max(10, Math.min(26, distance / 12 + 6));

  return (
    <div
      ref={containerRef}
      className={`flex-1 overflow-hidden relative whitespace-nowrap min-w-0 text-left ${className}`}
      style={{ textAlign: 'left' }}
      title={name}
    >
      <span
        ref={textRef}
        key={`${name}-${distance > 0 ? 'anim' : 'static'}`}
        style={
          distance > 0
            ? ({
                display: 'inline-block',
                textAlign: 'left',
                transformOrigin: 'left center',
                animation: `marqueePingPong ${duration}s ease-in-out infinite`,
                '--marquee-dist': `-${distance}px`,
              } as React.CSSProperties)
            : { display: 'inline-block', textAlign: 'left' }
        }
        className="text-zinc-700 dark:text-zinc-300 font-medium text-left"
      >
        {name}
      </span>
    </div>
  );
};
