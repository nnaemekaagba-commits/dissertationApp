export type FBDGridSpec = { step: number; xValues: number[]; yValues: number[] };

const round = (value: number) => Number(value.toPrecision(12));

/** Produces an adaptive engineering grid with roughly ten readable divisions. */
export function fbdGridSpec(center: { x: number; y: number }, span: number): FBDGridSpec {
  const safeSpan = Number.isFinite(span) && span > 0 ? span : 1;
  const raw = safeSpan / 8;
  const power = 10 ** Math.floor(Math.log10(raw));
  const ratio = raw / power;
  const step = round((ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10) * power);
  const radius = Math.max(safeSpan * 0.75, step * 4);
  const values = (middle: number) => {
    const start = Math.floor((middle - radius) / step) * step;
    const end = Math.ceil((middle + radius) / step) * step;
    const output: number[] = [];
    for (let value = start; value <= end + step / 2 && output.length < 30; value += step)
      output.push(round(value));
    return output;
  };
  return { step, xValues: values(center.x), yValues: values(center.y) };
}

export function fbdGridReading(value: number): string {
  return Math.abs(value) < 1e-10 ? '0' : Number(value.toFixed(6)).toString();
}

export type FBDGridSegment = { start: { x: number; y: number }; end: { x: number; y: number } };

/** Hides a full gridline when it would visually merge with student geometry. */
export function fbdGridLineConflicts(axis: 'x' | 'y', value: number,
  segments: FBDGridSegment[], tolerance: number): boolean {
  return segments.some(({ start, end }) => axis === 'x'
    ? Math.abs(start.x - end.x) <= tolerance && Math.abs(start.x - value) <= tolerance
    : Math.abs(start.y - end.y) <= tolerance && Math.abs(start.y - value) <= tolerance);
}
