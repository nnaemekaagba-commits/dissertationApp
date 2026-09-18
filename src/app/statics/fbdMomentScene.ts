import * as THREE from 'three';
import type { FBDMoment } from './fbdState.ts';

/** A three-quarter-circle path; its winding follows the student's chosen direction. */
export function momentArcPoints(moment: FBDMoment, span: number): THREE.Vector3[] {
  const radius = Math.max(0.32, span * 0.1);
  const start = -3 * Math.PI / 4;
  const sweep = (moment.clockwise ? -1 : 1) * 3 * Math.PI / 2;
  return Array.from({ length: 49 }, (_, index) => {
    const angle = start + sweep * index / 48;
    return new THREE.Vector3(radius * Math.cos(angle), radius * Math.sin(angle), 0.18);
  });
}

export function buildFBDMomentArrow(moment: FBDMoment, span: number, selected = false): THREE.Group {
  const group = new THREE.Group();
  group.userData.fbdMomentId = moment.id;
  group.position.set(moment.at.x, moment.at.y, 0);
  const points = momentArcPoints(moment, span);
  const color = selected ? 0xea580c : 0x7c3aed;
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color })));
  const tip = points[points.length - 1];
  const tangent = tip.clone().sub(points[points.length - 2]).normalize();
  const headLength = Math.max(0.13, Math.min(0.23, span * 0.055));
  const head = new THREE.Mesh(new THREE.ConeGeometry(headLength * 0.38, headLength, 12),
    new THREE.MeshBasicMaterial({ color }));
  head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
  head.position.copy(tip).addScaledVector(tangent, -headLength / 2);
  group.add(head);
  return group;
}
