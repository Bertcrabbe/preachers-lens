import { useEffect, useRef, useState } from "react";

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  className?: string;
  prefix?: string;
  suffix?: string;
}

export const AnimatedCounter = ({ 
  value, 
  duration = 1500, 
  className = "", 
  prefix = "",
  suffix = "" 
}: AnimatedCounterProps) => {
  const [displayValue, setDisplayValue] = useState(0);
  const [hasAnimated, setHasAnimated] = useState(false);
  const prevValue = useRef(0);
  const rafRef = useRef<number>();
  const elementRef = useRef<HTMLSpanElement>(null);

  // Trigger animation when element becomes visible
  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated) {
          setHasAnimated(true);
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasAnimated]);

  // Run animation when visible or value changes after first animation
  useEffect(() => {
    if (!hasAnimated) return;

    const start = prevValue.current;
    const end = value;
    if (start === end) {
      setDisplayValue(end);
      return;
    }

    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + (end - start) * eased);
      setDisplayValue(current);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        prevValue.current = end;
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration, hasAnimated]);

  return (
    <span ref={elementRef} className={className}>
      {prefix}{displayValue}{suffix}
    </span>
  );
};
