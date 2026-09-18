import * as THREE from 'three';
import type { FBDAngle } from './fbdState.ts';

/** Draw the smaller arc between chosen rays; the student's text remains the only angle value. */
export function angleArcLayout(angle: FBDAngle, span: number) {
  const vertex = new THREE.Vector3(angle.vertex.x, angle.vertex.y, 0.22);
  const from = new THREE.Vector3(angle.from.x, angle.from.y, 0.22);
  const to = new THREE.Vector3(angle.to.x, angle.to.y, 0.22);
  const first = from.clone().sub(vertex);
  const second = to.clone().sub(vertex);
  const start = Math.atan2(first.y, first.x);
  const sweep = Math.atan2(first.x * second.y - first.y * second.x,
    first.x * second.x + first.y * second.y);
  const radius = Math.min(Math.max(0.3, span * 0.08), first.length() * 0.65, second.length() * 0.65);
  const points = Array.from({ length: 33 }, (_, index) => {
    const direction = start + sweep * index / 32;
    return vertex.clone().add(new THREE.Vector3(radius * Math.cos(direction), radius * Math.sin(direction), 0));
  });
  const labelDistance = radius + Math.max(0.2, span * 0.05);
  const labelDirection = start + sweep / 2;
  const labelPosition = vertex.clone().add(new THREE.Vector3(
    labelDistance * Math.cos(labelDirection), labelDistance * Math.sin(labelDirection), 0.02));
  return { vertex, from, to, points, labelPosition, sweep };
}

export function buildFBDAngleArc(angle: FBDAngle, span: number, selected = false): THREE.Group {
  const layout = angleArcLayout(angle, span);
  const group = new THREE.Group();
  group.userData.fbdAngleId = angle.id;
  const color = selected ? 0xea580c : 0x0d9488;
  const line = (points: THREE.Vector3[]) => group.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color })));
  line([layout.vertex, layout.from]);
  line([layout.vertex, layout.to]);
  line(layout.points);
  return group;
}
