export function parseSliceString(input: string, length: number): number[] {
  const s = input.trim();
  if (s.toLowerCase() === "all") {
    return Array.from({ length }, (_, i) => i);
  }

  const indices = new Set<number>();
  const segments = s.split(",");
  const parseInteger = (value: string, segment: string): number => {
    if (!/^[+-]?\d+$/.test(value)) {
      throw new Error(`Invalid slice segment: ${JSON.stringify(segment)}`);
    }
    return Number.parseInt(value, 10);
  };

  for (const rawSegment of segments) {
    const segment = rawSegment.trim();
    if (!segment) continue;

    if (segment.includes(":")) {
      const parts = segment.split(":").map((p) => {
        const trimmed = p.trim();
        if (!trimmed) return null;
        return parseInteger(trimmed, segment);
      });
      if (parts.length > 3) {
        throw new Error(`Invalid slice segment: ${JSON.stringify(segment)}`);
      }

      const startRaw = parts[0] ?? null;
      const stopRaw = parts[1] ?? null;
      const stepRaw = parts[2] ?? null;
      if (stepRaw === 0) {
        throw new Error(`Slice step cannot be zero: ${JSON.stringify(segment)}`);
      }
      const step = stepRaw ?? 1;
      let start: number;
      let stop: number;

      if (step > 0) {
        start = startRaw == null ? 0 : normalizeSliceIndex(startRaw, length, false);
        stop = stopRaw == null ? length : normalizeSliceIndex(stopRaw, length, false);
        for (let i = start; i < stop; i += step) indices.add(i);
      } else {
        start = startRaw == null ? length - 1 : normalizeSliceIndex(startRaw, length, true);
        stop = stopRaw == null ? -1 : normalizeSliceIndex(stopRaw, length, true);
        for (let i = start; i > stop; i += step) {
          if (i >= 0 && i < length) indices.add(i);
        }
      }
      continue;
    }

    const idx = parseInteger(segment, segment);
    if (idx < -length || idx >= length) {
      throw new Error(`Index ${idx} out of range for length ${length}`);
    }
    indices.add(((idx % length) + length) % length);
  }

  const result = [...indices].sort((a, b) => a - b);
  if (result.length === 0) {
    throw new Error(`Slice string ${JSON.stringify(input)} produced no indices`);
  }
  return result;
}

function normalizeSliceIndex(value: number, length: number, negativeStep: boolean): number {
  let out = value < 0 ? value + length : value;
  if (negativeStep) {
    if (out < 0) out = -1;
    if (out >= length) out = length - 1;
    return out;
  }
  if (out < 0) out = 0;
  if (out > length) out = length;
  return out;
}

export function parseSliceStringOverValues(input: string, values: number[]): number[] {
  if (values.length === 0) return [];
  if (input.trim().toLowerCase() === "all") {
    return Array.from({ length: values.length }, (_, i) => i);
  }

  const maxValue = Math.max(...values);
  const selectedValues = new Set(parseSliceString(input, maxValue + 1));
  const selectedIndices = values
    .map((value, index) => (selectedValues.has(value) ? index : -1))
    .filter((index) => index >= 0);

  if (selectedIndices.length === 0) {
    throw new Error(`Slice string ${JSON.stringify(input)} produced no positions`);
  }
  return selectedIndices;
}
