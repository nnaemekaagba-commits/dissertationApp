import * as THREE from 'three';
import type { StaticsWorkspace } from './model.ts';
import type { FBDState } from './fbdState.ts';
import { selectGivenFBDInformation, type GivenVisibility } from './fbdGiven.ts';

type TextFactory = (text: string, color: string, scale: number) => THREE.Object3D | null;
const COLOR = 0x64748b;
const TEXT_COLOR = '#475569';

/** Draws only stated problem information. No solver output or student objects enter this group. */
export function buildGivenFBDOverlay(workspace: StaticsWorkspace, state: FBDState,
  visibility: GivenVisibility, makeText: TextFactory): THREE.Group {
  const group = new THREE.Group();
  group.userData.source = 'given-problem';
  const given = selectGivenFBDInformation(workspace, state, visibility);
  const nodes = new Map(workspace.nodes.map((node) => [node.id, node]));
  const bounds = new THREE.Box3().setFromPoints(workspace.nodes.map((node) =>
    new THREE.Vector3(node.x, node.y, 0)));
  const size = bounds.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, 1);
  const position = (id: string) => {
    const node = nodes.get(id);
    return node ? new THREE.Vector3(node.x, node.y, 0.19) : null;
  };
  const label = (text: string, at: THREE.Vector3, scale = 0.42) => {
    const sprite = makeText(text, TEXT_COLOR, scale);
    if (sprite) { sprite.position.copy(at); group.add(sprite); }
  };
  const line = (points: THREE.Vector3[]) => {
    const object = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineDashedMaterial({ color: COLOR, dashSize: 0.1, gapSize: 0.06 }));
    object.computeLineDistances();
    group.add(object);
  };
  const angleToRadians = (value: number) => workspace.units.angle === 'rad' ? value : THREE.MathUtils.degToRad(value);
  const arrow = (point: THREE.Vector3, directionAngle: number, length: number) => {
    const radians = angleToRadians(directionAngle);
    const direction = new THREE.Vector3(Math.cos(radians), Math.sin(radians), 0).normalize();
    group.add(new THREE.ArrowHelper(direction, point.clone().addScaledVector(direction, -length),
      length, COLOR, length * 0.24, length * 0.13));
    return direction;
  };

  for (const load of given.loads) {
    if (load.kind === 'force') {
      const point = position(load.nodeId);
      if (!point) continue;
      const length = Math.max(0.48, span * 0.2);
      const direction = arrow(point, load.angle, length);
      label(`Given ${load.magnitude} ${workspace.units.force}`,
        point.clone().addScaledVector(direction, -(length + 0.28)));
    } else if (load.kind === 'distributed') {
      const member = workspace.members.find((item) => item.id === load.memberId);
      const start = member && position(member.startNodeId);
      const end = member && position(member.endNodeId);
      if (!start || !end) continue;
      for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const intensity = load.startMagnitude + (load.endMagnitude - load.startMagnitude) * t;
        if (Math.abs(intensity) < 1e-10) continue;
        const angle = intensity < 0 ? load.angle + (workspace.units.angle === 'rad' ? Math.PI : 180) : load.angle;
        arrow(start.clone().lerp(end, t), angle, Math.max(0.35, span * 0.14));
      }
      label(`Given q ${load.startMagnitude}→${load.endMagnitude} ${workspace.units.force}/${workspace.units.length}`,
        start.clone().add(end).multiplyScalar(0.5).add(new THREE.Vector3(0, Math.max(0.6, span * 0.3), 0)));
    } else {
      const point = position(load.nodeId);
      if (!point) continue;
      const radius = Math.max(0.28, span * 0.08);
      const sign = load.magnitude >= 0 ? 1 : -1;
      const center = point.clone().add(new THREE.Vector3(0, Math.max(0.55, span * 0.2), 0));
      const arc = Array.from({ length: 33 }, (_, index) => {
        const a = -Math.PI / 4 + sign * Math.PI * 1.5 * index / 32;
        return center.clone().add(new THREE.Vector3(radius * Math.cos(a), radius * Math.sin(a), 0));
      });
      line(arc);
      const tangent = arc[32].clone().sub(arc[31]).normalize();
      group.add(new THREE.ArrowHelper(tangent, arc[32].clone().addScaledVector(tangent, -0.16),
        0.16, COLOR, 0.08, 0.05));
      label(`Given M ${load.magnitude} ${workspace.units.moment ?? `${workspace.units.force}·${workspace.units.length}`}`,
        center.clone().add(new THREE.Vector3(0, radius + 0.28, 0)));
    }
  }

  for (const dimension of given.dimensions) {
    const start = position(dimension.startNodeId);
    const end = position(dimension.endNodeId);
    if (!start || !end || start.distanceTo(end) === 0) continue;
    const along = end.clone().sub(start).normalize();
    const normal = new THREE.Vector3(along.y, -along.x, 0);
    const offset = Math.max(0.38, span * 0.15);
    const from = start.clone().addScaledVector(normal, offset);
    const to = end.clone().addScaledVector(normal, offset);
    line([start, from]); line([from, to]); line([to, end]);
    label(`Given ${dimension.label || `${dimension.value} ${workspace.units.length}`}`,
      from.clone().add(to).multiplyScalar(0.5).addScaledVector(normal, 0.2));
  }

  for (const angle of given.angles) {
    const vertex = position(angle.vertexNodeId);
    const from = position(angle.fromNodeId);
    const to = position(angle.toNodeId);
    if (!vertex || !from || !to) continue;
    const first = from.clone().sub(vertex);
    const second = to.clone().sub(vertex);
    if (first.lengthSq() === 0 || second.lengthSq() === 0) continue;
    const start = Math.atan2(first.y, first.x);
    const sweep = Math.atan2(first.x * second.y - first.y * second.x, first.x * second.x + first.y * second.y);
    const radius = Math.min(Math.max(0.3, span * 0.08), first.length() * 0.6, second.length() * 0.6);
    const arc = Array.from({ length: 25 }, (_, index) => vertex.clone().add(new THREE.Vector3(
      radius * Math.cos(start + sweep * index / 24), radius * Math.sin(start + sweep * index / 24), 0)));
    line(arc);
    const unit = workspace.units.angle === 'rad' ? ' rad' : '°';
    label(`Given ${angle.label || `${angle.value}${unit}`}`,
      vertex.clone().add(new THREE.Vector3((radius + 0.28) * Math.cos(start + sweep / 2),
        (radius + 0.28) * Math.sin(start + sweep / 2), 0)));
  }

  for (const node of given.nodes) {
    label(`Given ${node.label || node.id}`,
      new THREE.Vector3(node.x, node.y + Math.max(0.27, span * 0.07), 0.24));
  }
  for (const member of given.members) {
    const start = position(member.startNodeId);
    const end = position(member.endNodeId);
    if (start && end) label(`Given ${member.label || member.id}`,
      start.clone().add(end).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.3, 0)));
  }
  return group;
}
