'use client';

import { useEffect, useRef } from 'react';

const SPACING = 30;
const REACH = 170;
const AMBER: [number, number, number] = [245, 158, 11];

/**
 * A patch panel's worth of jacks behind the hero. Jacks near the pointer
 * light up amber and grow, like the logo's patch cords; a few twinkle on
 * their own. One canvas, redrawn only while something changes.
 */
export function JackField({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let pointer = { x: -9999, y: -9999 };
    let target = { ...pointer };
    let frame = 0;
    let visible = true;
    let running = false;
    // Each jack twinkles with its own phase.
    let phases: number[] = [];

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.ceil(width / SPACING + 1) * Math.ceil(height / SPACING + 1);
      phases = Array.from({ length: count }, () => Math.random() * Math.PI * 2);
      draw(performance.now());
    };

    const draw = (time: number) => {
      const dark = document.documentElement.classList.contains('dark');
      const base = dark ? [250, 250, 250] : [10, 10, 10];
      ctx.clearRect(0, 0, width, height);
      // Ease the glow towards the pointer so it trails a little.
      pointer.x += (target.x - pointer.x) * 0.18;
      pointer.y += (target.y - pointer.y) * 0.18;
      const cols = Math.ceil(width / SPACING) + 1;
      const rows = Math.ceil(height / SPACING) + 1;
      const offsetX = (width - (cols - 1) * SPACING) / 2;
      let i = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++, i++) {
          const x = offsetX + c * SPACING;
          const y = r * SPACING + SPACING / 2;
          const d = Math.hypot(x - pointer.x, y - pointer.y);
          const near = Math.max(0, 1 - d / REACH);
          const twinkle = reduced ? 0 : Math.max(0, Math.sin(time / 1700 + phases[i]!) - 0.994) * 70;
          const glow = Math.min(1, near * near + twinkle);
          const radius = 1.6 + glow * 2.4;
          const rgb = base.map((v, k) => Math.round(v + (AMBER[k]! - v) * glow));
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.12 + glow * 0.75})`;
          ctx.lineWidth = 1 + glow;
          ctx.stroke();
          if (glow > 0.35) {
            ctx.beginPath();
            ctx.arc(x, y, radius * 0.45, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${AMBER[0]},${AMBER[1]},${AMBER[2]},${glow * 0.8})`;
            ctx.fill();
          }
        }
      }
    };

    const loop = (time: number) => {
      draw(time);
      const settling = Math.abs(target.x - pointer.x) + Math.abs(target.y - pointer.y) > 0.5;
      if (visible && (settling || !reduced)) {
        frame = requestAnimationFrame(loop);
      } else {
        running = false;
      }
    };
    const start = () => {
      if (running || !visible) return;
      running = true;
      frame = requestAnimationFrame(loop);
    };

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      target = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (pointer.x < -1000) pointer = { ...target };
      start();
    };
    const onLeave = () => {
      target = { x: -9999, y: -9999 };
      start();
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = !!entry?.isIntersecting;
      if (visible) start();
    });
    observer.observe(canvas);
    const resizer = new ResizeObserver(resize);
    resizer.observe(canvas);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    resize();
    start();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      resizer.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className={className} />;
}
