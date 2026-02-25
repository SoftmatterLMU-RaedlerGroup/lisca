import { useCallback, useEffect, useRef } from "react";

export function HexBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);

  const draw = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const spacing = 48;
    const baseRect = 10;
    const rotation = time * 0.00004;

    const cos0 = Math.cos(rotation);
    const sin0 = Math.sin(rotation);
    const angle2 = rotation + Math.PI / 3;
    const cos2 = Math.cos(angle2);
    const sin2 = Math.sin(angle2);

    const v1x = spacing * cos0;
    const v1y = spacing * sin0;
    const v2x = spacing * cos2;
    const v2y = spacing * sin2;

    const pulse = 1 + 0.15 * Math.sin(time * 0.0008);
    const rw = baseRect * pulse;
    const rh = baseRect * pulse;

    const cx = width / 2;
    const cy = height / 2;
    const maxDim = Math.max(width, height) * 1.5;
    const range = Math.ceil(maxDim / spacing) + 2;

    const rippleSpeed = 0.002;
    const rippleFreq = 0.012;

    for (let i = -range; i <= range; i += 1) {
      for (let j = -range; j <= range; j += 1) {
        const x = cx + i * v1x + j * v2x;
        const y = cy + i * v1y + j * v2y;
        if (x < -rw || x > width + rw || y < -rh || y > height + rh) continue;

        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ripple = Math.sin(dist * rippleFreq - time * rippleSpeed);
        const alpha = 0.045 + 0.035 * ripple;

        ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation);
        ctx.fillRect(-rw / 2, -rh / 2, rw, rh);
        ctx.restore();
      }
    }

    animRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  return <canvas ref={canvasRef} className="fixed inset-0 z-0 pointer-events-none" aria-hidden />;
}

