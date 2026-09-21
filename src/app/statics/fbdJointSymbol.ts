import type { FBDJointKind, FBDPoint } from './fbdState.ts';

export type JointStroke = { from: FBDPoint; to: FBDPoint };
export type JointCircle = { center: FBDPoint; radius: number; filled: boolean };

/** Planar drafting symbols relative to the student-selected joint point. */
export function fbdJointSymbol(kind: FBDJointKind = 'free'):
  { strokes: JointStroke[]; circles: JointCircle[] } {
  const strokes: JointStroke[] = [];
  const circles: JointCircle[] = [{ center: { x: 0, y: 0 }, radius: kind === 'free' ? 0.09 : 0.045,
    filled: true }];
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    strokes.push({ from: { x: x1, y: y1 }, to: { x: x2, y: y2 } });
  if (kind === 'pin' || kind === 'roller') {
    line(0, -0.04, -0.24, -0.39);
    line(0, -0.04, 0.24, -0.39);
    line(-0.24, -0.39, 0.24, -0.39);
    if (kind === 'roller') {
      circles.push({ center: { x: -0.14, y: -0.47 }, radius: 0.07, filled: false },
        { center: { x: 0.14, y: -0.47 }, radius: 0.07, filled: false });
      line(-0.32, -0.56, 0.32, -0.56);
      for (let x = -0.28; x <= 0.28; x += 0.14) line(x, -0.56, x - 0.08, -0.66);
    } else {
      line(-0.32, -0.43, 0.32, -0.43);
      for (let x = -0.28; x <= 0.28; x += 0.14) line(x, -0.43, x - 0.08, -0.53);
    }
  } else if (kind === 'fixed') {
    line(0, -0.35, 0, 0.35);
    for (let y = -0.3; y <= 0.3; y += 0.15) line(0, y, -0.14, y - 0.1);
  }
  return { strokes, circles };
}
