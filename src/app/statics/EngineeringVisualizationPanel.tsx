import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Box, RotateCcw, X } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { useStaticsWorkspace } from './StaticsWorkspaceProvider';
import { selectSceneData } from './sceneData';
import type { VisualizationAction } from './researchLog';
import { calculatePlanarBeamReactions, type BeamReactionResult } from './calculations';
import type { EngineeringView } from './engineeringTools';
import type { StaticsWorkspace } from './model';
import { createEmptyFBDState, selectFBDTarget, visibleReactions,
  addFBDForce, type FBDForce, type FBDState, type FBDTarget } from './fbdState';
import { buildFBDForceArrow } from './fbdForceScene';

type ViewMode = 'front' | 'top' | 'right' | 'isometric' | 'free';
const VIEW_BUTTONS: { label: string; mode: Exclude<ViewMode, 'free'> }[] = [
  { label: 'Front', mode: 'front' },
  { label: 'Top', mode: 'top' },
  { label: 'Right', mode: 'right' },
  { label: 'Isometric', mode: 'isometric' },
];

function textSprite(text: string, color = '#0f172a', scale = 0.64) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.font = '600 42px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = color;
  context.fillText(text, 128, 48, 242);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(scale * 2.66, scale, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function disposeGroup(group: THREE.Group) {
  group.traverse((object) => {
    const renderable = object as THREE.Mesh;
    renderable.geometry?.dispose();
    const materials = renderable.material ? (Array.isArray(renderable.material) ? renderable.material : [renderable.material]) : [];
    materials.forEach((material) => {
      const mapped = material as THREE.Material & { map?: THREE.Texture };
      mapped.map?.dispose();
      material.dispose();
    });
  });
}

function addLine(group: THREE.Group, start: THREE.Vector3, end: THREE.Vector3, color: number) {
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
  group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color })));
}

function buildFBDModel(workspace: StaticsWorkspace, fbdState: FBDState, selectedForceId: string | null) {
  const group = new THREE.Group();
  const nodes = new Map(workspace.nodes.map((node) => [node.id, node]));
  const points = workspace.nodes.map((node) => new THREE.Vector3(node.x, node.y, 0));
  const bounds = new THREE.Box3().setFromPoints(points);
  const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
  const size = bounds.isEmpty() ? new THREE.Vector3(1, 1, 0) : bounds.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, 1);
  const target = fbdState.selectedTarget;
  const selectedMembers = target?.kind === 'body' ? workspace.members :
    target?.kind === 'member' ? workspace.members.filter((member) => member.id === target.id) : [];
  const selectedNodeIds = new Set<string>();
  for (const member of selectedMembers) {
    const start = nodes.get(member.startNodeId);
    const end = nodes.get(member.endNodeId);
    if (!start || !end) continue;
    selectedNodeIds.add(start.id);
    selectedNodeIds.add(end.id);
    const from = new THREE.Vector3(start.x, start.y, 0);
    const to = new THREE.Vector3(end.x, end.y, 0);
    const vector = to.clone().sub(from);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, vector.length(), 12),
      new THREE.MeshStandardMaterial({ color: 0x2563eb }));
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector.normalize());
    beam.position.copy(from).add(to).multiplyScalar(0.5);
    group.add(beam);
  }
  if (target?.kind === 'joint') selectedNodeIds.add(target.id);
  for (const nodeId of selectedNodeIds) {
    const node = nodes.get(nodeId);
    if (!node) continue;
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x0f172a }));
    marker.position.set(node.x, node.y, 0.04);
    group.add(marker);
    const label = textSprite(node.label || node.id);
    if (label) { label.position.set(node.x, node.y + Math.max(0.28, span * 0.07), 0.1); group.add(label); }
  }
  for (const force of fbdState.forces) {
    const arrow = buildFBDForceArrow(force, span, force.id === selectedForceId);
    group.add(arrow);
    const radians = force.angle * Math.PI / 180;
    const length = Math.max(0.65, span * 0.27);
    const labelText = `${force.label || 'F'}${force.magnitude === undefined ? '' : ` = ${force.magnitude} ${workspace.units.force}`}`;
    const label = textSprite(labelText, force.id === selectedForceId ? '#c2410c' : '#b91c1c', 0.42);
    if (label) {
      label.position.set(force.at.x + Math.cos(radians) * (length + 0.32),
        force.at.y + Math.sin(radians) * (length + 0.32), 0.2);
      group.add(label);
    }
  }
  return { group, center, span };
}

function buildModel(workspace: StaticsWorkspace, reactions: BeamReactionResult | null,
  showFbd: boolean, fbdState: FBDState, selectedForceId: string | null) {
  if (showFbd) return buildFBDModel(workspace, fbdState, selectedForceId);
  const group = new THREE.Group();
  const sceneData = selectSceneData(workspace);
  const nodes = new Map(sceneData.nodes.map((node) => [node.id, node]));
  const points = sceneData.nodes.map((node) => new THREE.Vector3(node.x, node.y, 0));
  const box = new THREE.Box3().setFromPoints(points);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, 1);
  const radius = Math.max(0.035, Math.min(0.12, span * 0.018));
  const at = (id: string) => {
    const node = nodes.get(id);
    return node ? new THREE.Vector3(node.x, node.y, 0) : null;
  };

  // Light grid and axes keep orientation clear while orbiting in 3D.
  if (!showFbd) {
    const grid = new THREE.GridHelper(Math.max(10, Math.ceil(span * 3)), 20, 0xcbd5e1, 0xe2e8f0);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.14;
    group.add(grid);
  }

  sceneData.members.forEach((member) => {
    const start = at(member.startNodeId);
    const end = at(member.endNodeId);
    if (!start || !end) return;
    const vector = new THREE.Vector3().subVectors(end, start);
    const length = vector.length();
    if (length === 0) return;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, length, 12),
      new THREE.MeshStandardMaterial({ color: 0x2563eb, metalness: 0.12, roughness: 0.55 }),
    );
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector.normalize());
    beam.position.copy(start).add(end).multiplyScalar(0.5);
    group.add(beam);
  });

  sceneData.nodes.forEach((node) => {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.65, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0x0f172a }),
    );
    marker.position.set(node.x, node.y, radius * 0.2);
    group.add(marker);
    const label = textSprite(node.label || node.id);
    if (label) {
      label.position.set(node.x, node.y + Math.max(0.24, span * 0.07), 0.08);
      group.add(label);
    }
  });

  if (!showFbd) sceneData.supports.forEach((support) => {
    const point = at(support.nodeId);
    if (!point) return;
    const width = Math.max(radius * 3, span * 0.07);
    const height = width * 0.8;
    if (support.kind === 'fixed') {
      const block = new THREE.Mesh(new THREE.BoxGeometry(width * 0.4, height * 1.5, radius),
        new THREE.MeshStandardMaterial({ color: 0xf59e0b }));
      block.position.copy(point).add(new THREE.Vector3(-width * 0.25, 0, 0));
      group.add(block);
      return;
    }
    // Triangle beneath the joint for both support types; the roller has wheels below it.
    const vertices = new Float32Array([
      point.x, point.y - radius, 0,
      point.x - width / 2, point.y - radius - height, 0,
      point.x + width / 2, point.y - radius - height, 0,
    ]);
    const triangle = new THREE.BufferGeometry();
    triangle.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    triangle.computeVertexNormals();
    group.add(new THREE.Mesh(triangle, new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide })));
    const baseline = point.y - radius - height;
    if (support.kind === 'roller') {
      [-width * 0.24, width * 0.24].forEach((dx) => {
        const wheel = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.6, 16),
          new THREE.MeshBasicMaterial({ color: 0xb45309, side: THREE.DoubleSide }));
        wheel.position.set(point.x + dx, baseline - radius * 0.65, 0.02);
        group.add(wheel);
      });
      addLine(group, new THREE.Vector3(point.x - width * 0.65, baseline - radius * 1.4, 0),
        new THREE.Vector3(point.x + width * 0.65, baseline - radius * 1.4, 0), 0x92400e);
    } else {
      addLine(group, new THREE.Vector3(point.x - width * 0.65, baseline, 0),
        new THREE.Vector3(point.x + width * 0.65, baseline, 0), 0x92400e);
    }
  });

  reactions?.reactions.forEach((reaction) => {
    const point = at(reaction.nodeId);
    if (!point) return;
    const side = point.x <= center.x ? -1 : 1;
    const xOffset = side * Math.max(0.23, span * 0.08);
    const arrowX = point.x + xOffset;
    const arrowTop = point.y - Math.max(0.22, span * 0.06);
    const arrowLength = Math.max(0.48, span * 0.17);
    if (reaction.vertical !== 0) {
      const direction = new THREE.Vector3(0, Math.sign(reaction.vertical), 0);
      const originY = reaction.vertical > 0 ? arrowTop - arrowLength : arrowTop;
      group.add(new THREE.ArrowHelper(direction, new THREE.Vector3(arrowX, originY, 0.14),
        arrowLength, 0x059669, arrowLength * 0.25, arrowLength * 0.16));
      const amount = Number(reaction.vertical.toPrecision(6));
      const label = textSprite(`R_${reaction.nodeId}y = ${amount} ${reactions.forceUnit}`, '#047857', 0.64);
      if (label) {
        label.position.set(arrowX, arrowTop - arrowLength - Math.max(0.52, span * 0.14), 0.18);
        group.add(label);
      }
    }
    if (reaction.horizontal !== 0) {
      const direction = new THREE.Vector3(Math.sign(reaction.horizontal), 0, 0);
      const arrowY = point.y + Math.max(0.48, span * 0.13);
      const originX = reaction.horizontal > 0 ? point.x - arrowLength / 2 : point.x + arrowLength / 2;
      group.add(new THREE.ArrowHelper(direction, new THREE.Vector3(originX, arrowY, 0.14),
        arrowLength, 0x059669, arrowLength * 0.25, arrowLength * 0.16));
      const amount = Number(reaction.horizontal.toPrecision(6));
      const label = textSprite(`R_${reaction.nodeId}x = ${amount} ${reactions.forceUnit}`, '#047857', 0.64);
      if (label) {
        label.position.set(point.x, arrowY + Math.max(0.16, span * 0.04), 0.18);
        group.add(label);
      }
    }
    if (reaction.moment !== 0) {
      const centerX = point.x + side * Math.max(0.32, span * 0.12);
      const centerY = point.y - Math.max(0.5, span * 0.18);
      const arcRadius = Math.max(0.14, span * 0.045);
      const sign = Math.sign(reaction.moment);
      const startAngle = -Math.PI / 4;
      const endAngle = startAngle + sign * Math.PI * 1.55;
      const arc = Array.from({ length: 25 }, (_, index) => {
        const angle = startAngle + (endAngle - startAngle) * index / 24;
        return new THREE.Vector3(centerX + arcRadius * Math.cos(angle),
          centerY + arcRadius * Math.sin(angle), 0.17);
      });
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(arc),
        new THREE.LineBasicMaterial({ color: 0x059669 })));
      const tangent = new THREE.Vector3(-Math.sin(endAngle) * sign, Math.cos(endAngle) * sign, 0);
      group.add(new THREE.ArrowHelper(tangent, arc[24].clone().addScaledVector(tangent, -arcRadius * 0.4),
        arcRadius * 0.4, 0x059669, arcRadius * 0.27, arcRadius * 0.2));
      const amount = Number(reaction.moment.toPrecision(6));
      const label = textSprite(`M_${reaction.nodeId} = ${amount} ${reactions.momentUnit}`, '#047857', 0.64);
      if (label) {
        label.position.set(centerX, centerY - arcRadius - Math.max(0.52, span * 0.14), 0.18);
        group.add(label);
      }
    }
  });

  const angleToRadians = (angle: number) => sceneData.units.angle === 'rad' ? angle : THREE.MathUtils.degToRad(angle);
  const addForceArrow = (point: THREE.Vector3, angle: number, length: number) => {
    const radians = angleToRadians(angle);
    const direction = new THREE.Vector3(Math.cos(radians), Math.sin(radians), 0).normalize();
    const origin = point.clone().addScaledVector(direction, -length);
    group.add(new THREE.ArrowHelper(direction, origin, length, 0xef4444, length * 0.28, length * 0.18));
  };
  sceneData.loads.forEach((load) => {
    if (load.kind === 'force') {
      const point = at(load.nodeId);
      if (point) {
        const arrowLength = Math.max(0.55, span * 0.26);
        addForceArrow(point, load.angle, arrowLength);
        const radians = angleToRadians(load.angle);
        const label = textSprite(`${load.magnitude} ${sceneData.units.force}`, '#b91c1c', 0.62);
        if (label) {
          label.position.set(point.x - Math.cos(radians) * (arrowLength + 0.2),
            point.y - Math.sin(radians) * (arrowLength + 0.2), 0.12);
          group.add(label);
        }
      }
    } else if (load.kind === 'distributed') {
      const member = sceneData.members.find((item) => item.id === load.memberId);
      const start = member && at(member.startNodeId);
      const end = member && at(member.endNodeId);
      if (!start || !end) return;
      const maximum = Math.max(Math.abs(load.startMagnitude), Math.abs(load.endMagnitude), 1);
      [0.1, 0.3, 0.5, 0.7, 0.9].forEach((t) => {
        const point = start.clone().lerp(end, t);
        const intensity = load.startMagnitude + (load.endMagnitude - load.startMagnitude) * t;
        if (Math.abs(intensity) < 1e-10) return;
        const directionAngle = intensity < 0 ? load.angle + (sceneData.units.angle === 'rad' ? Math.PI : 180) : load.angle;
        addForceArrow(point, directionAngle, Math.max(0.35, span * 0.1 + span * 0.13 * Math.abs(intensity) / maximum));
      });
      const label = textSprite(`q: ${load.startMagnitude}→${load.endMagnitude} ${sceneData.units.force}/${sceneData.units.length}`, '#b91c1c', 0.62);
      if (label) {
        label.position.copy(start.clone().add(end).multiplyScalar(0.5)).add(new THREE.Vector3(0, Math.max(0.55, span * 0.36), 0.12));
        group.add(label);
      }
    } else {
      const point = at(load.nodeId);
      if (!point) return;
      const arcRadius = Math.max(0.15, span * 0.05);
      const centerY = point.y + Math.max(0.55, span * 0.19);
      const sign = load.magnitude >= 0 ? 1 : -1;
      const startAngle = -Math.PI / 4;
      const endAngle = startAngle + sign * Math.PI * 1.55;
      const arc = Array.from({ length: 25 }, (_, index) => {
        const angle = startAngle + (endAngle - startAngle) * index / 24;
        return new THREE.Vector3(point.x + arcRadius * Math.cos(angle),
          centerY + arcRadius * Math.sin(angle), 0.16);
      });
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(arc),
        new THREE.LineBasicMaterial({ color: 0xef4444 })));
      const tangent = new THREE.Vector3(-Math.sin(endAngle) * sign, Math.cos(endAngle) * sign, 0);
      group.add(new THREE.ArrowHelper(tangent, arc[24].clone().addScaledVector(tangent, -arcRadius * 0.4),
        arcRadius * 0.4, 0xef4444, arcRadius * 0.27, arcRadius * 0.2));
      const label = textSprite(`M = ${load.magnitude} ${sceneData.units.moment ?? `${sceneData.units.force}*${sceneData.units.length}`}`, '#b91c1c', 0.62);
      if (label) {
        label.position.set(point.x, centerY + arcRadius + Math.max(0.16, span * 0.04), 0.18);
        group.add(label);
      }
    }
  });

  if (!showFbd) sceneData.dimensions.forEach((dimension) => {
    const start = at(dimension.startNodeId);
    const end = at(dimension.endNodeId);
    if (!start || !end) return;
    const direction = end.clone().sub(start).normalize();
    const isOverall = sceneData.dimensions.length > 1 &&
      dimension.value === Math.max(...sceneData.dimensions.map((item) => item.value));
    const offsetDistance = Math.max(0.4, span * (isOverall ? 0.28 : 0.18));
    const offset = new THREE.Vector3(direction.y, -direction.x, 0).multiplyScalar(offsetDistance);
    const from = start.clone().add(offset);
    const to = end.clone().add(offset);
    addLine(group, from, to, 0x7c3aed);
    const tick = Math.max(0.07, span * 0.018);
    [from, to].forEach((endPoint) => addLine(group,
      endPoint.clone().add(new THREE.Vector3(-direction.y, direction.x, 0).multiplyScalar(tick)),
      endPoint.clone().add(new THREE.Vector3(direction.y, -direction.x, 0).multiplyScalar(tick)), 0x7c3aed));
    const label = textSprite(dimension.label || `${dimension.value} ${sceneData.units.length}`, '#6d28d9', 0.62);
    if (label) {
      label.position.copy(from.clone().add(to).multiplyScalar(0.5))
        .add(new THREE.Vector3(0, -Math.max(0.13, span * 0.035), 0.05));
      group.add(label);
    }
  });

  sceneData.angles?.forEach((angle) => {
    const vertex = at(angle.vertexNodeId);
    const from = at(angle.fromNodeId);
    const to = at(angle.toNodeId);
    if (!vertex || !from || !to) return;
    const start = Math.atan2(from.y - vertex.y, from.x - vertex.x);
    const end = Math.atan2(to.y - vertex.y, to.x - vertex.x);
    const sweep = ((end - start + Math.PI * 2) % (Math.PI * 2));
    const arcRadius = Math.max(0.28, span * 0.09);
    const arcPoints = Array.from({ length: 25 }, (_, i) =>
      new THREE.Vector3(vertex.x + Math.cos(start + sweep * i / 24) * arcRadius,
        vertex.y + Math.sin(start + sweep * i / 24) * arcRadius, 0.06));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(arcPoints),
      new THREE.LineBasicMaterial({ color: 0x9333ea })));
    const label = textSprite(angle.label || `${angle.value}${sceneData.units.angle === 'rad' ? ' rad' : '°'}`, '#7e22ce', 0.42);
    if (label) {
      label.position.set(vertex.x + Math.cos(start + sweep / 2) * arcRadius * 1.7,
        vertex.y + Math.sin(start + sweep / 2) * arcRadius * 1.7, 0.08);
      group.add(label);
    }
  });

  return { group, center, span };
}

export function EngineeringVisualizationPanel({ onClose, viewCommand, showFbd, onFbdChange,
  onVisualizationInteraction }: {
  onClose: () => void;
  viewCommand?: { view: EngineeringView; sequence: number };
  showFbd: boolean;
  onFbdChange: (visible: boolean) => void;
  onVisualizationInteraction: (action: VisualizationAction, target?: FBDTarget, force?: FBDForce) => void;
}) {
  const { workspace, fbdState, setFbdState, undoFbd, redoFbd, canUndoFbd, canRedoFbd } = useStaticsWorkspace();
  const reactionState = useMemo(() => visibleReactions(showFbd, workspace, calculatePlanarBeamReactions),
    [workspace, showFbd]);
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const onInteractionRef = useRef(onVisualizationInteraction);
  onInteractionRef.current = onVisualizationInteraction;
  const modelRef = useRef<THREE.Group | null>(null);
  const viewBoundsRef = useRef<{ center: THREE.Vector3; span: number } | null>(null);
  const framedRef = useRef(false);
  const framedSpanRef = useRef<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('free');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [forceFormOpen, setForceFormOpen] = useState(false);
  const [forceDraft, setForceDraft] = useState({ x: '0', y: '0', label: 'F', angle: '-90', magnitude: '' });
  const [forceError, setForceError] = useState('');
  const [selectedForceId, setSelectedForceId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedForceId && !fbdState.forces.some((force) => force.id === selectedForceId))
      setSelectedForceId(null);
  }, [fbdState.forces, selectedForceId]);
  const canvasClickRef = useRef<(event: MouseEvent) => void>(() => {});
  canvasClickRef.current = (event) => {
    if (!showFbd || !rendererRef.current || !cameraRef.current) return;
    const rect = rendererRef.current.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
      -((event.clientY - rect.top) / rect.height * 2 - 1));
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, cameraRef.current);
    if (forceFormOpen) {
      const point = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3());
      if (point) setForceDraft((current) => ({ ...current, x: point.x.toFixed(2), y: point.y.toFixed(2) }));
      return;
    }
    for (const hit of raycaster.intersectObjects(modelRef.current?.children || [], true)) {
      let object: THREE.Object3D | null = hit.object;
      while (object && !object.userData.fbdForceId) object = object.parent;
      if (object?.userData.fbdForceId) {
        setSelectedForceId(object.userData.fbdForceId as string);
        return;
      }
    }
  };

  const frameModel = (center: THREE.Vector3, span: number, mode: ViewMode | 'reset') => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const distance = Math.max(4.5, span * 1.7);
    const orbitDirection = camera.position.clone().sub(controls.target);
    const direction = mode === 'front' ? new THREE.Vector3(0, 0, 1)
      : mode === 'top' ? new THREE.Vector3(0, 1, 0)
      : mode === 'right' ? new THREE.Vector3(1, 0, 0)
      : mode === 'isometric' ? new THREE.Vector3(1, 1, 1)
      : mode === 'free' && orbitDirection.lengthSq() > 0 ? orbitDirection
      : new THREE.Vector3(0.12, 0.16, 3.2);
    if (mode !== 'free') camera.up.set(0, mode === 'top' ? 0 : 1, mode === 'top' ? -1 : 0);
    controls.target.copy(center);
    camera.position.copy(center).add(direction.normalize().multiplyScalar(distance));
    controls.enableRotate = mode === 'free' || mode === 'reset';
    camera.near = 0.01;
    camera.far = Math.max(1000, span * 100);
    camera.updateProjectionMatrix();
    controls.update();
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setError('3D graphics are unavailable in this browser.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0xf8fafc);
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(3, 5, 8);
    scene.add(light);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    const handleCanvasClick = (event: MouseEvent) => canvasClickRef.current(event);
    renderer.domElement.addEventListener('click', handleCanvasClick);
    const recordOrbit = () => onInteractionRef.current('orbit');
    controls.addEventListener('end', recordOrbit);
    controls.enableDamping = true;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.4;
    controls.maxDistance = 500;
    sceneRef.current = scene;
    rendererRef.current = renderer;
    cameraRef.current = camera;
    controlsRef.current = controls;
    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();
    setReady(true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      controls.removeEventListener('end', recordOrbit);
      renderer.domElement.removeEventListener('click', handleCanvasClick);
      if (modelRef.current) {
        scene.remove(modelRef.current);
        disposeGroup(modelRef.current);
        modelRef.current = null;
      }
      viewBoundsRef.current = null;
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      framedRef.current = false;
      framedSpanRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene) return;
    if (modelRef.current) {
      scene.remove(modelRef.current);
      disposeGroup(modelRef.current);
    }
    const model = buildModel(workspace, reactionState.result, showFbd, fbdState, selectedForceId);
    modelRef.current = model.group;
    viewBoundsRef.current = { center: model.center, span: model.span };
    scene.add(model.group);
    if (!framedRef.current || framedSpanRef.current !== model.span) {
      frameModel(model.center, model.span, viewMode);
      framedRef.current = true;
      framedSpanRef.current = model.span;
    }
  }, [ready, workspace, reactionState, showFbd, fbdState, selectedForceId]);

  const resetView = () => {
    const bounds = viewBoundsRef.current;
    if (bounds) frameModel(bounds.center, bounds.span, 'reset');
    setViewMode('free');
    onVisualizationInteraction('reset');
  };

  const selectView = (mode: ViewMode) => {
    const bounds = viewBoundsRef.current;
    if (mode === 'free') {
      if (controlsRef.current) controlsRef.current.enableRotate = true;
    } else if (bounds) frameModel(bounds.center, bounds.span, mode);
    setViewMode(mode);
    onVisualizationInteraction(mode);
  };

  useEffect(() => {
    if (!ready || !viewCommand) return;
    if (viewCommand.view === 'reset') resetView();
    else selectView(viewCommand.view);
  }, [ready, viewCommand?.sequence]);

  const targetOptions: { label: string; target: FBDTarget }[] = [
    { label: 'Body · Entire structure', target: { kind: 'body', id: 'structure' } },
    ...workspace.members.map((member) => ({ label: `Member · ${member.label || member.id}`,
      target: { kind: 'member' as const, id: member.id } })),
    ...workspace.nodes.map((node) => ({ label: `Joint · ${node.label || node.id}`,
      target: { kind: 'joint' as const, id: node.id } })),
  ];
  const selectTarget = (target: FBDTarget | null) => {
    setFbdState((current) => selectFBDTarget(current, target, workspace));
    if (target) onVisualizationInteraction('fbd_select', target);
    else onVisualizationInteraction('fbd_delete');
  };
  const openForceForm = () => {
    if (!fbdState.selectedTarget) return;
    const target = fbdState.selectedTarget;
    const joint = target.kind === 'joint' ? workspace.nodes.find((node) => node.id === target.id) : null;
    const member = target.kind === 'member' ? workspace.members.find((item) => item.id === target.id) : null;
    const start = member ? workspace.nodes.find((node) => node.id === member.startNodeId) : null;
    const end = member ? workspace.nodes.find((node) => node.id === member.endNodeId) : null;
    const x = joint?.x ?? (start && end ? (start.x + end.x) / 2 : 0);
    const y = joint?.y ?? (start && end ? (start.y + end.y) / 2 : 0);
    setForceDraft({ x: String(x), y: String(y), label: 'F', angle: '-90', magnitude: '' });
    setForceError('');
    setForceFormOpen(true);
  };
  const submitForce = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const forceId = crypto.randomUUID();
      const input = { at: { x: Number(forceDraft.x), y: Number(forceDraft.y) },
        label: forceDraft.label, angle: Number(forceDraft.angle),
        ...(forceDraft.magnitude.trim() ? { magnitude: Number(forceDraft.magnitude) } : {}) };
      const next = addFBDForce(fbdState, input, workspace, forceId);
      const force = next.forces[next.forces.length - 1];
      setFbdState(next);
      setSelectedForceId(force.id);
      setForceFormOpen(false);
      setForceError('');
      onVisualizationInteraction('fbd_force_add', undefined, force);
    } catch (caught) {
      setForceError(caught instanceof Error ? caught.message : 'Could not add force.');
    }
  };

  return (
    <aside className="absolute inset-0 z-20 flex flex-col border-l border-slate-200 bg-white md:relative md:inset-auto md:z-auto md:w-[min(40vw,480px)] md:flex-shrink-0" aria-label="Engineering visualization">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Box className="size-4 text-blue-600" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-900">Engineering visualization</h2>
            <p className="text-[11px] text-slate-500">{workspace.nodes.length} nodes · {workspace.members.length} members</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onClose} className="rounded p-1.5 text-slate-600 hover:bg-slate-100" title="Close visualization" aria-label="Close visualization"><X className="size-4" /></button>
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-2 py-2" aria-label={showFbd ? 'Build FBD mode' : 'Camera views'}>
        {!showFbd && VIEW_BUTTONS.map(({ label, mode }) => (
          <button key={mode} type="button" onClick={() => selectView(mode)} aria-pressed={viewMode === mode}
            className={`shrink-0 rounded px-2 py-1 text-xs ${viewMode === mode ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
            {label}
          </button>
        ))}
        {!showFbd && <button type="button" onClick={resetView} className="flex shrink-0 items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200">
          <RotateCcw className="size-3" /> Reset View
        </button>}
        {!showFbd && <button type="button" onClick={() => selectView('free')} aria-pressed={viewMode === 'free'}
          className={`shrink-0 rounded px-2 py-1 text-xs ${viewMode === 'free' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
          Free Orbit
        </button>}
        {showFbd && <span className="self-center px-2 text-xs font-medium text-emerald-800">Build FBD Mode</span>}
        <button type="button" onClick={() => onFbdChange(!showFbd)} aria-pressed={showFbd}
          className={`shrink-0 rounded px-2 py-1 text-xs ${showFbd ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
          {showFbd ? 'Return to Structure' : 'FBD'}
        </button>
      </div>
      <div ref={containerRef} className="relative min-h-0 flex-1 bg-slate-50 touch-none">
        {error && <div className="absolute inset-0 z-10 flex items-center justify-center p-4 text-sm text-slate-600">{error}</div>}
        {showFbd && !fbdState.selectedTarget && fbdState.forces.length === 0 && !error &&
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4 text-center text-sm text-slate-500">
            Select a body, member, or joint to begin your free-body diagram.
          </div>}
      </div>
      {showFbd && <div className="border-t border-slate-200 px-3 py-2" aria-label="FBD construction toolbar">
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="text-xs font-medium text-slate-700" htmlFor="fbd-target-select">Select Body/Member/Joint</label>
          <select id="fbd-target-select" aria-label="Select Body/Member/Joint"
            className="max-w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
            value={fbdState.selectedTarget ? JSON.stringify(fbdState.selectedTarget) : ''}
            onChange={(event) => {
              const option = targetOptions.find((item) => JSON.stringify(item.target) === event.target.value);
              selectTarget(option?.target || null);
            }}>
            <option value="">Select a body, member, or joint</option>
            {targetOptions.map(({ label, target }) =>
              <option key={`${target.kind}:${target.id}`} value={JSON.stringify(target)}>{label}</option>)}
          </select>
          <button type="button" disabled={!fbdState.selectedTarget} onClick={openForceForm}
            className="rounded bg-slate-100 px-2 py-1 text-xs disabled:text-slate-400">Add Force</button>
          {['Add Moment', 'Add Dimension', 'Add Angle', 'Add Label'].map((label) =>
            <button key={label} type="button" disabled title="Drawing tools are coming in the next phase"
              className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-400">{label}</button>)}
          <button type="button" disabled={!selectedForceId && !fbdState.selectedTarget} onClick={() => {
            if (selectedForceId) {
              setFbdState((current) => ({ ...current, forces: current.forces.filter((force) => force.id !== selectedForceId) }));
              setSelectedForceId(null);
              onVisualizationInteraction('fbd_delete');
            } else selectTarget(null);
          }}
            className="rounded bg-slate-100 px-2 py-1 text-xs disabled:text-slate-400">Delete</button>
          <button type="button" disabled={!canUndoFbd} onClick={() => { undoFbd(); onVisualizationInteraction('fbd_undo'); }}
            className="rounded bg-slate-100 px-2 py-1 text-xs disabled:text-slate-400">Undo</button>
          <button type="button" disabled={!canRedoFbd} onClick={() => { redoFbd(); onVisualizationInteraction('fbd_redo'); }}
            className="rounded bg-slate-100 px-2 py-1 text-xs disabled:text-slate-400">Redo</button>
          <button type="button" onClick={() => { setFbdState(createEmptyFBDState(workspace)); setSelectedForceId(null); setForceFormOpen(false); onVisualizationInteraction('fbd_reset'); }}
            className="rounded bg-slate-100 px-2 py-1 text-xs">Reset FBD</button>
        </div>
        {forceFormOpen && <form onSubmit={submitForce} className="mt-2 grid grid-cols-2 gap-2 text-xs" aria-label="Add force details">
          <p className="col-span-2 text-slate-600">Choose the application point on the canvas or enter its coordinates.</p>
          <label>Point X ({workspace.units.length})<input required type="number" step="any" value={forceDraft.x}
            onChange={(event) => setForceDraft({ ...forceDraft, x: event.target.value })}
            className="block w-full rounded border border-slate-300 px-2 py-1" /></label>
          <label>Point Y ({workspace.units.length})<input required type="number" step="any" value={forceDraft.y}
            onChange={(event) => setForceDraft({ ...forceDraft, y: event.target.value })}
            className="block w-full rounded border border-slate-300 px-2 py-1" /></label>
          <label>Force label<input required maxLength={80} value={forceDraft.label}
            onChange={(event) => setForceDraft({ ...forceDraft, label: event.target.value })}
            className="block w-full rounded border border-slate-300 px-2 py-1" /></label>
          <label>Direction (degrees from +X)<input required type="number" step="any" list="fbd-force-angles" value={forceDraft.angle}
            onChange={(event) => setForceDraft({ ...forceDraft, angle: event.target.value })}
            className="block w-full rounded border border-slate-300 px-2 py-1" />
            <datalist id="fbd-force-angles"><option value="0" /><option value="90" /><option value="180" /><option value="-90" /></datalist></label>
          <label>Magnitude ({workspace.units.force}, optional)<input type="number" min="0" step="any" value={forceDraft.magnitude}
            onChange={(event) => setForceDraft({ ...forceDraft, magnitude: event.target.value })}
            className="block w-full rounded border border-slate-300 px-2 py-1" /></label>
          <div className="flex items-end gap-2"><button type="submit" className="rounded bg-blue-600 px-2 py-1 text-white">Add force</button>
            <button type="button" onClick={() => setForceFormOpen(false)} className="rounded bg-slate-100 px-2 py-1">Cancel</button></div>
          {forceError && <p className="col-span-2 text-red-700" role="alert">{forceError}</p>}
        </form>}
        {fbdState.forces.length > 0 && <div className="mt-2 flex flex-wrap gap-1" aria-label="FBD forces">
          {fbdState.forces.map((force) => <button key={force.id} type="button" aria-pressed={selectedForceId === force.id}
            onClick={() => setSelectedForceId(force.id)}
            className={`rounded px-2 py-1 text-xs ${selectedForceId === force.id ? 'bg-orange-100 text-orange-800' : 'bg-slate-100 text-slate-700'}`}>
            {force.label || 'F'} ({force.at.x}, {force.at.y})</button>)}
        </div>}
      </div>}
      {!showFbd && reactionState.error && (
        <p className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
          Reactions unavailable: {reactionState.error}
        </p>
      )}
      {!showFbd && <div className="border-t border-slate-200 px-3 py-2 text-[11px] text-slate-500">
        <p>Ask the chat to move or add loads, change supports, or resize the beam.</p>
        <p>{viewMode === 'free' ? 'Drag to rotate' : 'Free Orbit enables rotation'} · Scroll to zoom · Right drag to pan · Length: {workspace.units.length} · Force: {workspace.units.force}</p>
      </div>}
    </aside>
  );
}
