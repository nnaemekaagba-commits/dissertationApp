import * as THREE from 'three';
import { selectSceneData } from './sceneData';
import type { BeamReactionResult } from './calculations';
import type { StaticsWorkspace } from './model';
import { fbdBodyCorners, fbdBodyEndpointLabelPositions, fbdEndpointLabels,
  fbdMemberEndpointLabelPositions,
  type FBDForce, type FBDMoment, type FBDDimension, type FBDAngle, type FBDLabel,
  type FBDJoint, type FBDElement, type FBDElementKind, type FBDPrimitiveKind,
  type FBDState } from './fbdState';
import { buildFBDForceArrow } from './fbdForceScene';
import { buildFBDMomentArrow } from './fbdMomentScene';
import { fbdJointSymbol } from './fbdJointSymbol';
import { inferReactionSupports } from './fbdStructureTranslation';
import { fbdGridLineConflicts, fbdGridReading, fbdGridSpec } from './fbdGrid';
import { buildFBDDimensionLines, dimensionLayout } from './fbdDimensionScene';
import { angleArcLayout, buildFBDAngleArc } from './fbdAngleScene';
import { buildGivenFBDOverlay } from './fbdGivenScene';
import type { GivenVisibility } from './fbdGiven';

export const FBD_MEMBER_HEIGHT = 0.1;

function textSprite(text: string, color = '#0f172a', scale = 0.64) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.font = '600 42px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.lineWidth = 8;
  context.strokeStyle = 'rgba(248, 250, 252, 0.96)';
  context.strokeText(text, 128, 48, 242);
  context.fillStyle = color;
  context.fillText(text, 128, 48, 242);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(scale * 2.66, scale, 1);
  sprite.renderOrder = 10;
  return sprite;
}

export function disposeGroup(group: THREE.Group) {
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

export function fbdLabelPosition(kind: FBDElementKind, item: FBDElement, span: number): THREE.Vector3 {
  if (kind === 'force') {
    const force = item as FBDForce;
    const radians = force.angle * Math.PI / 180;
    const distance = Math.max(0.65, span * 0.27) + 0.32;
    return new THREE.Vector3(force.labelPosition?.x ?? force.at.x + Math.cos(radians) * distance,
      force.labelPosition?.y ?? force.at.y + Math.sin(radians) * distance, 0.2);
  }
  if (kind === 'moment') {
    const moment = item as FBDMoment;
    return new THREE.Vector3(moment.labelPosition?.x ?? moment.at.x,
      moment.labelPosition?.y ?? moment.at.y + Math.max(0.55, span * 0.17), 0.2);
  }
  if (kind === 'dimension') {
    const dimension = item as FBDDimension;
    const calculated = dimensionLayout(dimension, span).labelPosition;
    return dimension.labelPosition ? new THREE.Vector3(dimension.labelPosition.x, dimension.labelPosition.y, 0.24) : calculated;
  }
  if (kind === 'angle') {
    const angle = item as FBDAngle;
    const calculated = angleArcLayout(angle, span).labelPosition;
    return angle.labelPosition ? new THREE.Vector3(angle.labelPosition.x, angle.labelPosition.y, 0.24) : calculated;
  }
  const label = item as FBDLabel;
  return new THREE.Vector3(label.at.x, label.at.y, 0.45);
}

export function buildFBDModel(workspace: StaticsWorkspace, fbdState: FBDState,
  selectedForceId: string | null, selectedMomentId: string | null,
  selectedDimensionId: string | null, selectedAngleId: string | null, selectedLabelId: string | null,
  givenVisibility: GivenVisibility, baseOnly = false,
  selectedPrimitive: { kind: FBDPrimitiveKind; id: string } | null = null) {
  const group = new THREE.Group();
  const pointData = [
    ...fbdState.bodies.flatMap((item) => fbdBodyCorners(item)),
    ...fbdState.joints.map((item) => item.at),
    ...fbdState.members.flatMap((item) => [item.start, item.end]),
    ...(!baseOnly ? [
      ...fbdState.forces.map((item) => item.at), ...fbdState.moments.map((item) => item.at),
      ...fbdState.dimensions.flatMap((item) => [item.start, item.end]),
      ...fbdState.angles.flatMap((item) => [item.vertex, item.from, item.to]),
      ...fbdState.labels.map((item) => item.at),
    ] : []),
  ];
  const points = pointData.map((point) => new THREE.Vector3(point.x, point.y, 0));
  const bounds = new THREE.Box3().setFromPoints(points);
  const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
  const size = bounds.isEmpty() ? new THREE.Vector3(1, 1, 0) : bounds.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, 1);
  if (pointData.length) {
    const grid = fbdGridSpec(center, span);
    const geometrySegments = [
      ...fbdState.members.map((member) => ({ start: member.start, end: member.end })),
      ...fbdState.bodies.flatMap((body) => {
        const corners = fbdBodyCorners(body);
        return corners.map((start, index) => ({ start, end: corners[(index + 1) % corners.length] }));
      }),
    ];
    const conflictTolerance = Math.max(grid.step * 0.035, 1e-8);
    const xMin = grid.xValues[0]; const xMax = grid.xValues[grid.xValues.length - 1];
    const yMin = grid.yValues[0]; const yMax = grid.yValues[grid.yValues.length - 1];
    for (const x of grid.xValues) {
      if (fbdGridLineConflicts('x', x, geometrySegments, conflictTolerance)) continue;
      addLine(group, new THREE.Vector3(x, yMin, -0.18), new THREE.Vector3(x, yMax, -0.18),
        Math.abs(x) < grid.step / 100 ? 0x94a3b8 : 0xe2e8f0);
      const reading = textSprite(fbdGridReading(x), '#334155', 0.4);
      if (reading) { reading.position.set(x, yMin - grid.step * 0.35, -0.12); group.add(reading); }
    }
    for (const y of grid.yValues) {
      if (fbdGridLineConflicts('y', y, geometrySegments, conflictTolerance)) continue;
      addLine(group, new THREE.Vector3(xMin, y, -0.18), new THREE.Vector3(xMax, y, -0.18),
        Math.abs(y) < grid.step / 100 ? 0x94a3b8 : 0xe2e8f0);
      const reading = textSprite(fbdGridReading(y), '#334155', 0.4);
      if (reading) { reading.position.set(xMin - grid.step * 0.45, y, -0.12); group.add(reading); }
    }
    const xUnit = textSprite(`x (${workspace.units.length})`, '#1e293b', 0.44);
    if (xUnit) { xUnit.position.set(xMax, yMin - grid.step * 0.72, -0.12); group.add(xUnit); }
    const yUnit = textSprite(`y (${workspace.units.length})`, '#1e293b', 0.44);
    if (yUnit) { yUnit.position.set(xMin - grid.step * 0.7, yMax, -0.12); group.add(yUnit); }
  }
  // Only student-created FBDState is drawn. EngineeringState remains problem data.
  for (const body of fbdState.bodies) {
    const outline = new THREE.Group();
    outline.userData.fbdPrimitive = { kind: 'body', id: body.id };
    outline.userData.fbdDragBody = body.id;
    const corners = fbdBodyCorners(body).map((point) => new THREE.Vector3(point.x, point.y, 0));
    const maskShape = new THREE.Shape();
    maskShape.moveTo(corners[0].x, corners[0].y);
    for (let index = 1; index < 4; index++) maskShape.lineTo(corners[index].x, corners[index].y);
    maskShape.closePath();
    const mask = new THREE.Mesh(new THREE.ShapeGeometry(maskShape),
      new THREE.MeshBasicMaterial({ color: 0xf8fafc, side: THREE.DoubleSide, depthTest: true }));
    mask.position.z = -0.08;
    mask.userData.fbdPrimitive = { kind: 'body', id: body.id };
    outline.add(mask);
    corners.push(corners[0]);
    for (let index = 0; index < 4; index++) addLine(outline,
      corners[index], corners[index + 1], selectedPrimitive?.kind === 'body' && selectedPrimitive.id === body.id ? 0xc2410c : 0x059669);
    const bodyEnds = fbdEndpointLabels(body.label || body.id);
    if (bodyEnds) {
      const labelPoints = fbdBodyEndpointLabelPositions(body, Math.max(0.28, span * 0.075));
      for (const [text, point] of [[bodyEnds[0], labelPoints[0]],
        [bodyEnds[1], labelPoints[1]]] as const) {
        const label = textSprite(text, '#047857', 0.54);
        if (label) { label.position.set(point.x, point.y, 0.24);
          label.userData.fbdPrimitive = { kind: 'body', id: body.id }; outline.add(label); }
      }
    } else if (body.label) {
      const label = textSprite(body.label, '#047857', 0.42);
      if (label) { label.position.copy(corners[0]).add(corners[2]).multiplyScalar(0.5);
        label.position.z = 0.2; outline.add(label); }
    }
    group.add(outline);
  }
  for (const member of fbdState.members) {
    const from = new THREE.Vector3(member.start.x, member.start.y, 0);
    const to = new THREE.Vector3(member.end.x, member.end.y, 0);
    const vector = to.clone().sub(from);
    const memberGroup = new THREE.Group();
    memberGroup.userData.fbdPrimitive = { kind: 'member', id: member.id };
    memberGroup.userData.fbdDragMember = member.id;
    const normal = vector.lengthSq() > 0
      ? new THREE.Vector3(-vector.y, vector.x, 0).normalize().multiplyScalar(FBD_MEMBER_HEIGHT / 2)
      : new THREE.Vector3(0, FBD_MEMBER_HEIGHT / 2, 0);
    const corners = [from.clone().add(normal), to.clone().add(normal),
      to.clone().sub(normal), from.clone().sub(normal)];
    const maskShape = new THREE.Shape();
    maskShape.moveTo(corners[0].x, corners[0].y);
    for (let index = 1; index < corners.length; index++) maskShape.lineTo(corners[index].x, corners[index].y);
    maskShape.closePath();
    const mask = new THREE.Mesh(new THREE.ShapeGeometry(maskShape),
      new THREE.MeshBasicMaterial({ color: 0xf8fafc, side: THREE.DoubleSide, depthTest: true }));
    mask.position.z = -0.08;
    memberGroup.add(mask);
    const color = selectedPrimitive?.kind === 'member' && selectedPrimitive.id === member.id ? 0xc2410c : 0x059669;
    for (let index = 0; index < corners.length; index++)
      addLine(memberGroup, corners[index], corners[(index + 1) % corners.length], color);
    group.add(memberGroup);
    const memberEnds = fbdEndpointLabels(member.label || member.id);
    if (memberEnds) {
      const labelPoints = fbdMemberEndpointLabelPositions(member, Math.max(0.28, span * 0.075));
      for (const [text, point] of [[memberEnds[0], labelPoints[0]],
        [memberEnds[1], labelPoints[1]]] as const) {
        const label = textSprite(text, '#047857', 0.54);
        if (label) { label.position.set(point.x, point.y, 0.24);
          label.userData.fbdPrimitive = { kind: 'member', id: member.id }; group.add(label); }
      }
    } else if (member.label) {
      const label = textSprite(member.label, '#047857', 0.42);
      if (label) { label.position.copy(from).add(to).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.24, 0.2));
        label.userData.fbdPrimitive = { kind: 'member', id: member.id }; group.add(label); }
    }
  }
  const explicitStructureJoints: FBDJoint[] = baseOnly ? [
    ...fbdState.bodies.flatMap((body) => {
      const corners = fbdBodyCorners(body);
      return [body.startJointKind && body.startJointKind !== 'free' ?
        { id: `${body.id}:start`, at: { x: (corners[0].x + corners[3].x) / 2, y: (corners[0].y + corners[3].y) / 2 }, kind: body.startJointKind } : null,
      body.endJointKind && body.endJointKind !== 'free' ?
        { id: `${body.id}:end`, at: { x: (corners[1].x + corners[2].x) / 2, y: (corners[1].y + corners[2].y) / 2 }, kind: body.endJointKind } : null]
        .filter((joint): joint is FBDJoint => joint !== null);
    }),
    ...fbdState.members.flatMap((member) => [
      member.startJointKind && member.startJointKind !== 'free' ?
        { id: `${member.id}:start`, at: member.start, kind: member.startJointKind } : null,
      member.endJointKind && member.endJointKind !== 'free' ?
        { id: `${member.id}:end`, at: member.end, kind: member.endJointKind } : null,
    ].filter((joint): joint is FBDJoint => joint !== null)),
    ...fbdState.joints,
  ] : [];
  const derivedJoints: FBDJoint[] = baseOnly ? [
    ...explicitStructureJoints,
    ...inferReactionSupports(fbdState.forces, explicitStructureJoints.map((joint) => joint.at), fbdState.moments),
  ] : [];
  for (const node of derivedJoints) {
    const symbol = new THREE.Group();
    symbol.userData.fbdPrimitive = { kind: 'joint', id: node.id };
    symbol.position.set(node.at.x, node.at.y, 0.1);
    const color = selectedPrimitive?.kind === 'joint' && selectedPrimitive.id === node.id ? 0xc2410c : 0x047857;
    const drawing = fbdJointSymbol(node.kind);
    for (const stroke of drawing.strokes) addLine(symbol,
      new THREE.Vector3(stroke.from.x, stroke.from.y, 0),
      new THREE.Vector3(stroke.to.x, stroke.to.y, 0), color);
    for (const circle of drawing.circles) {
      if (!circle.filled) {
        const points = Array.from({ length: 33 }, (_, index) => {
          const angle = index / 32 * Math.PI * 2;
          return new THREE.Vector3(circle.center.x + Math.cos(angle) * circle.radius,
            circle.center.y + Math.sin(angle) * circle.radius, 0.02);
        });
        const outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color }));
        symbol.add(outline);
      } else {
        const shape = new THREE.Mesh(new THREE.CircleGeometry(circle.radius, 32),
          new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
        shape.position.set(circle.center.x, circle.center.y, 0.02);
        symbol.add(shape);
      }
    }
    group.add(symbol);
    if (node.label) {
      const label = textSprite(node.label, '#047857', 0.42);
      if (label) { label.position.set(node.at.x, node.at.y + 0.27, 0.2);
        label.userData.fbdPrimitive = { kind: 'joint', id: node.id }; group.add(label); }
    }
  }
  for (const force of fbdState.forces.filter((item) => !baseOnly || (item.role || 'applied') === 'applied')) {
    const arrow = buildFBDForceArrow(force, span, force.id === selectedForceId);
    arrow.userData.fbdForceId = force.id;
    arrow.userData.fbdDragApplication = force.id;
    group.add(arrow);
    const labelText = `${force.label || 'F'}${force.magnitude === undefined ? '' : ` = ${force.magnitude} ${workspace.units.force}`}`;
    const label = textSprite(labelText, force.id === selectedForceId ? '#c2410c' : '#b91c1c', 0.42);
    if (label) {
      label.position.copy(fbdLabelPosition('force', force, span));
      label.userData.fbdForceId = force.id;
      label.userData.fbdDragLabel = { kind: 'force', id: force.id };
      group.add(label);
    }
  }
  if (baseOnly) return { group, center, span };
  for (const moment of fbdState.moments) {
    group.add(buildFBDMomentArrow(moment, span, moment.id === selectedMomentId));
    const labelText = `${moment.label || 'M'}${moment.magnitude === undefined ? '' : ` = ${moment.magnitude} ${workspace.units.force}·${workspace.units.length}`}`;
    const label = textSprite(labelText, moment.id === selectedMomentId ? '#c2410c' : '#6d28d9', 0.42);
    if (label) {
      label.position.copy(fbdLabelPosition('moment', moment, span));
      label.userData.fbdDragLabel = { kind: 'moment', id: moment.id };
      label.userData.fbdMomentId = moment.id;
      group.add(label);
    }
  }
  for (const dimension of fbdState.dimensions) {
    group.add(buildFBDDimensionLines(dimension, span, dimension.id === selectedDimensionId));
    const label = textSprite(dimension.label || '',
      dimension.id === selectedDimensionId ? '#c2410c' : '#0e7490', 0.42);
    if (label) {
      label.position.copy(fbdLabelPosition('dimension', dimension, span));
      label.userData.fbdDragLabel = { kind: 'dimension', id: dimension.id };
      label.userData.fbdDimensionId = dimension.id;
      group.add(label);
    }
  }
  for (const angle of fbdState.angles) {
    group.add(buildFBDAngleArc(angle, span, angle.id === selectedAngleId));
    const label = textSprite(angle.label || '', angle.id === selectedAngleId ? '#c2410c' : '#0f766e', 0.42);
    if (label) {
      label.position.copy(fbdLabelPosition('angle', angle, span));
      label.userData.fbdDragLabel = { kind: 'angle', id: angle.id };
      label.userData.fbdAngleId = angle.id;
      group.add(label);
    }
  }
  for (const item of fbdState.labels) {
    const sprite = textSprite(item.text, item.id === selectedLabelId ? '#c2410c' : '#1e293b', 0.55);
    if (sprite) {
      sprite.position.copy(fbdLabelPosition('label', item, span));
      sprite.userData.fbdLabelId = item.id;
      sprite.userData.fbdDragLabel = { kind: 'label', id: item.id };
      group.add(sprite);
    }
  }
  return { group, center, span };
}

export function hasStudentFBDBaseGeometry(state: FBDState): boolean {
  return state.bodies.length + state.members.length > 0;
}

export function buildStructureModel(workspace: StaticsWorkspace, reactions: BeamReactionResult | null) {
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
  const grid = new THREE.GridHelper(Math.max(10, Math.ceil(span * 3)), 20, 0xcbd5e1, 0xe2e8f0);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -0.14;
  group.add(grid);

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

  sceneData.supports.forEach((support) => {
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

  sceneData.dimensions.forEach((dimension) => {
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

