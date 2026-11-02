import React, { useEffect, useRef, useState } from 'react';
import { splitBytes, splitSpeed } from '../utils/format';

interface UseCountAnimationOptions {
  duration?: number;
  startValue?: number;
  triggerKey?: any;
}

/**
 * Hook for smooth, luxury ease-out digit interpolation (count up & count down).
 * On mount or triggerKey change, smoothly animates from 0 up to target.
 */
export function useCountAnimation(
  target: number,
  options?: UseCountAnimationOptions
): number {
  const duration = options?.duration ?? 1000;
  const initialStart = options?.startValue ?? 0;
  const triggerKey = options?.triggerKey;

  const [current, setCurrent] = useState<number>(initialStart);
  const currentRef = useRef<number>(initialStart);
  const animFrameRef = useRef<number | null>(null);
  const prevTriggerRef = useRef<any>(triggerKey);

  useEffect(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    const isTriggered = triggerKey !== undefined && triggerKey !== prevTriggerRef.current;
    prevTriggerRef.current = triggerKey;

    const endVal = Number.isFinite(target) ? target : 0;
    const startVal = isTriggered ? 0 : currentRef.current;

    if (isTriggered) {
      setCurrent(0);
      currentRef.current = 0;
    }

    if (startVal === endVal || duration <= 0) {
      setCurrent(endVal);
      currentRef.current = endVal;
      return;
    }

    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutCubic: snappy launch, gentle settling on final metric
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextVal = startVal + (endVal - startVal) * eased;

      setCurrent(nextVal);
      currentRef.current = nextVal;

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        setCurrent(endVal);
        currentRef.current = endVal;
        animFrameRef.current = null;
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [target, duration, triggerKey]);

  return current;
}

interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  triggerKey?: any;
  className?: string;
}

/**
 * Animated numeric counter with ease-out interpolation and fixed decimal precision.
 */
export const AnimatedNumber: React.FC<AnimatedNumberProps> = ({
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
  duration = 1000,
  triggerKey,
  className,
}) => {
  const animatedVal = useCountAnimation(value, { duration, triggerKey });
  const formatted =
    decimals > 0
      ? animatedVal.toFixed(decimals)
      : Math.round(animatedVal).toString();

  return (
    <span className={className}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
};

interface AnimatedBytesProps {
  bytes?: number | null;
  duration?: number;
  prefix?: string;
  suffix?: string;
  triggerKey?: any;
  className?: string;
}

/**
 * Smoothly animates storage and data sizes (e.g. 0.00 GB -> 11.64 GB) without unit jitter.
 */
export const AnimatedBytes: React.FC<AnimatedBytesProps> = ({
  bytes,
  duration = 1000,
  prefix = '',
  suffix = '',
  triggerKey,
  className,
}) => {
  const validBytes = bytes && bytes > 0 && Number.isFinite(bytes) ? bytes : 0;
  const target = splitBytes(validBytes);

  const animatedNum = useCountAnimation(target.value, { duration, triggerKey });
  const formattedNum =
    target.decimals > 0
      ? animatedNum.toFixed(target.decimals)
      : Math.round(animatedNum).toString();

  return (
    <span className={className}>
      {prefix}
      {formattedNum} {target.unit}
      {suffix}
    </span>
  );
};

interface AnimatedSpeedProps {
  bytesPerSec?: number | null;
  duration?: number;
  prefix?: string;
  suffix?: string;
  triggerKey?: any;
  className?: string;
}

/**
 * Smoothly animates throughput/bandwidth (e.g. 0.0 MB/s -> 14.5 MB/s).
 */
export const AnimatedSpeed: React.FC<AnimatedSpeedProps> = ({
  bytesPerSec,
  duration = 1000,
  prefix = '',
  suffix = '',
  triggerKey,
  className,
}) => {
  const validSpeed =
    bytesPerSec && bytesPerSec > 0 && Number.isFinite(bytesPerSec)
      ? bytesPerSec
      : 0;
  const target = splitSpeed(validSpeed);

  const animatedNum = useCountAnimation(target.value, { duration, triggerKey });
  const formattedNum =
    target.decimals > 0
      ? animatedNum.toFixed(target.decimals)
      : Math.round(animatedNum).toString();

  return (
    <span className={className}>
      {prefix}
      {formattedNum} {target.unit}
      {suffix}
    </span>
  );
};
