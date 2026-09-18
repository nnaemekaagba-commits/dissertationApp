import * as THREE from 'three';
import type { FBDForce } from './fbdState.ts';

/** The arrow tail is the student's application point; angle is in degrees from +x. */
export function buildFBDForceArrow(force: FBDForce, span: number, selected = false): THREE.Group {
  const group = new THREE.Group();
  group.userData.fbdForceId = force.id;
  const radians = force.angle * Math.PI / 180;
  const direction = new THREE.Vector3(Math.cos(radians), Math.sin(radians), 0).normalize();
  const length = Math.max(0.65, span * 0.27);
  const arrow = new THREE.ArrowHelper(direction,
    new THREE.Vector3(force.at.x, force.at.y, 0.16), length,
    selected ? 0xea580c : 0xdc2626, Math.min(length * 0.3, 0.32), Math.min(length * 0.16, 0.17));
  group.add(arrow);
  return group;
}
