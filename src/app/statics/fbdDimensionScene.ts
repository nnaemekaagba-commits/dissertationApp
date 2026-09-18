import * as THREE from 'three';
import type { FBDDimension } from './fbdState.ts';

export function dimensionLayout(dimension: FBDDimension, span: number) {
  const start = new THREE.Vector3(dimension.start.x, dimension.start.y, 0.2);
  const end = new THREE.Vector3(dimension.end.x, dimension.end.y, 0.2);
  const direction = end.clone().sub(start).normalize();
  const normal = new THREE.Vector3(-direction.y, direction.x, 0);
  const offset = Math.max(0.32, span * 0.1);
  const extension = Math.max(0.09, span * 0.025);
  const dimensionStart = start.clone().addScaledVector(normal, offset);
  const dimensionEnd = end.clone().addScaledVector(normal, offset);
  return { start, end, normal, dimensionStart, dimensionEnd,
    extensionStart: dimensionStart.clone().addScaledVector(normal, extension),
    extensionEnd: dimensionEnd.clone().addScaledVector(normal, extension),
    labelPosition: dimensionStart.clone().add(dimensionEnd).multiplyScalar(0.5)
      .addScaledVector(normal, Math.max(0.2, span * 0.045)) };
}

/** Main line, two extension lines, and endpoint ticks; the text is rendered by the viewer. */
export function buildFBDDimensionLines(dimension: FBDDimension, span: number,
  selected = false): THREE.Group {
  const layout = dimensionLayout(dimension, span);
  const group = new THREE.Group();
  group.userData.fbdDimensionId = dimension.id;
  const color = selected ? 0xea580c : 0x0891b2;
  const line = (from: THREE.Vector3, to: THREE.Vector3) => group.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([from, to]), new THREE.LineBasicMaterial({ color })));
  line(layout.dimensionStart, layout.dimensionEnd);
  line(layout.start, layout.extensionStart);
  line(layout.end, layout.extensionEnd);
  const along = layout.dimensionEnd.clone().sub(layout.dimensionStart).normalize();
  const tick = Math.max(0.09, span * 0.025);
  for (const point of [layout.dimensionStart, layout.dimensionEnd]) {
    line(point.clone().addScaledVector(along, -tick).addScaledVector(layout.normal, -tick),
      point.clone().addScaledVector(along, tick).addScaledVector(layout.normal, tick));
  }
  return group;
}
