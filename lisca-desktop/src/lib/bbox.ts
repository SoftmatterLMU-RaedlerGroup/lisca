export interface RegisterShape {
  shape: "square" | "hex";
  a: number;
  alpha: number;
  b: number;
  beta: number;
  w: number;
  h: number;
  dx: number;
  dy: number;
}

export function buildBboxCsv(
  canvasSize: { width: number; height: number },
  params: RegisterShape,
): string {
  const w = canvasSize.width;
  const h = canvasSize.height;

  const alphaRad = (params.alpha * Math.PI) / 180;
  const betaRad = (params.beta * Math.PI) / 180;

  const vec1 = {
    x: params.a * Math.cos(alphaRad),
    y: params.a * Math.sin(alphaRad),
  };
  const vec2 = {
    x: params.b * Math.cos(betaRad),
    y: params.b * Math.sin(betaRad),
  };

  const cx = w / 2 + params.dx;
  const cy = h / 2 + params.dy;
  const halfW = params.w / 2;
  const halfH = params.h / 2;

  const minLen = Math.max(
    1,
    Math.min(
      Math.sqrt(vec1.x * vec1.x + vec1.y * vec1.y),
      Math.sqrt(vec2.x * vec2.x + vec2.y * vec2.y),
    ),
  );
  const maxDim = Math.max(w, h) * 2;
  const maxRange = Math.ceil(maxDim / minLen) + 2;

  const rows: string[] = ["crop,x,y,w,h"];
  let crop = 0;

  for (let i = -maxRange; i <= maxRange; i += 1) {
    for (let j = -maxRange; j <= maxRange; j += 1) {
      const px = cx + i * vec1.x + j * vec2.x;
      const py = cy + i * vec1.y + j * vec2.y;
      const bx = px - halfW;
      const by = py - halfH;

      if (bx >= 0 && by >= 0 && bx + params.w <= w && by + params.h <= h) {
        rows.push(
          `${crop},${Math.round(bx)},${Math.round(by)},${Math.round(params.w)},${Math.round(params.h)}`,
        );
        crop += 1;
      }
    }
  }

  return rows.join("\n");
}
