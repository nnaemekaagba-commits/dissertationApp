import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Box, RotateCcw, X } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { useStaticsWorkspace } from './StaticsWorkspaceProvider';
import { selectSceneData } from './sceneData';
import { fbdTargetOptions } from './fbdTargetOptions';
import type { VisualizationAction } from './researchLog';
import type { BeamReactionResult } from './calculations';
import { visibleCalculation, type RequestedVisualCalculation } from './calculationPolicy';
import type { EngineeringView } from './engineeringTools';
import type { StaticsWorkspace } from './model';
import { DISPLAY_MODES, displayModeLayout, type EngineeringDisplayMode } from './displayMode';
import { fbdBodyCorners, fbdBodyEndpointLabelPositions, fbdEndpointLabels, fbdMemberEndFromAngle,
  fbdMemberEndpointLabelPositions,
  hasStudentFBDElements, resetStudentFBDElements, selectFBDTarget,
  addFBDBody, addFBDJoint, addFBDMember, editFBDPrimitive,
  addFBDForce, addFBDMoment, addFBDDimension, addFBDAngle, addFBDLabel, moveFBDLabel,
  editFBDForce, editFBDMoment, editFBDDimension, editFBDAngle, editFBDLabel,
  deleteFBDElement, getFBDElement, repositionFBDLabel, moveFBDForceApplication,
  type FBDForce, type FBDMoment, type FBDDimension, type FBDAngle, type FBDLabel,
  type FBDBody, type FBDJoint, type FBDMember, type FBDPrimitiveKind,
  type FBDElement, type FBDElementKind, type FBDLabelAssociation, type FBDState, type FBDTarget } from './fbdState';
import { buildFBDForceArrow } from './fbdForceScene';
import { buildFBDMomentArrow } from './fbdMomentScene';
import { fbdJointSymbol } from './fbdJointSymbol';
import { fbdGridLineConflicts, fbdGridReading, fbdGridSpec } from './fbdGrid';
import { buildFBDDimensionLines, dimensionLayout } from './fbdDimensionScene';
import { angleArcLayout, buildFBDAngleArc } from './fbdAngleScene';
import { DEFAULT_GIVEN_VISIBILITY, GIVEN_TOGGLES, type GivenVisibility } from './fbdGiven';
import { buildGivenFBDOverlay } from './fbdGivenScene';

type ViewMode = 'front' | 'top' | 'right' | 'isometric' | 'free';
type FBDDrag = { pointerId: number; kind: FBDElementKind; id: string;
  target: 'label' | 'application'; object: THREE.Object3D;
  start: THREE.Vector3; original: THREE.Vector3; current: THREE.Vector3;
  clientX: number; clientY: number; moved: boolean; controlsEnabled: boolean };
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

function fbdLabelPosition(kind: FBDElementKind, item: FBDElement, span: number): THREE.Vector3 {
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

function buildFBDModel(workspace: StaticsWorkspace, fbdState: FBDState,
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
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, vector.length(), 12),
      new THREE.MeshStandardMaterial({ color: selectedPrimitive?.kind === 'member' && selectedPrimitive.id === member.id ? 0xc2410c : 0x059669 }));
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector.normalize());
    beam.position.copy(from).add(to).multiplyScalar(0.5);
    beam.userData.fbdPrimitive = { kind: 'member', id: member.id };
    group.add(beam);
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
      if (label) { label.position.copy(beam.position).add(new THREE.Vector3(0, 0.24, 0.2));
        label.userData.fbdPrimitive = { kind: 'member', id: member.id }; group.add(label); }
    }
  }
  const derivedJoints: FBDJoint[] = baseOnly ? [
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

function hasStudentFBDBaseGeometry(state: FBDState): boolean {
  return state.bodies.length + state.members.length > 0;
}

function buildStructureModel(workspace: StaticsWorkspace, reactions: BeamReactionResult | null) {
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

function StructurePreview({ workspace, fbdState }: {
  workspace: StaticsWorkspace; fbdState: FBDState;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { setError('3D graphics are unavailable in this browser.'); return; }
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
    controls.enableDamping = true;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.4;
    controls.maxDistance = 500;
    const model = buildFBDModel(workspace, fbdState, null, null, null, null, null,
      DEFAULT_GIVEN_VISIBILITY, true);
    scene.add(model.group);
    controls.target.copy(model.center);
    camera.position.copy(model.center).add(new THREE.Vector3(0, 0, Math.max(4.5, model.span * 1.7)));
    controls.enableRotate = false;
    controls.update();
    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      renderer.setSize(width, height);
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
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      scene.remove(model.group);
      disposeGroup(model.group);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [workspace, fbdState]);
  return <div ref={containerRef} className="relative min-h-0 flex-1 bg-slate-50 touch-none" aria-label="Structure preview">
    {error && <div className="absolute inset-0 z-10 flex items-center justify-center p-4 text-sm text-slate-600">{error}</div>}
  </div>;
}

export function EngineeringVisualizationPanel({ onClose, viewCommand, displayMode, onDisplayModeChange, onCheckFBD,
  requestedVisualCalculation,
  onVisualizationInteraction }: {
  onClose: () => void;
  viewCommand?: { view: EngineeringView; sequence: number };
  displayMode: EngineeringDisplayMode;
  onDisplayModeChange: (mode: EngineeringDisplayMode) => void;
  onCheckFBD: () => void;
  requestedVisualCalculation: RequestedVisualCalculation | null;
  onVisualizationInteraction: (action: VisualizationAction, target?: FBDTarget,
    force?: FBDForce, moment?: FBDMoment, dimension?: FBDDimension, angle?: FBDAngle,
    label?: FBDLabel,
    change?: { elementKind: FBDElementKind; elementId: string; before: FBDElement;
      after: FBDElement | null; dragTarget?: 'label' | 'application' },
    history?: { before: FBDState; after: FBDState },
    primitive?: { kind: FBDPrimitiveKind; id: string }) => void;
}) {
  const { workspace, fbdState, setFbdState, undoFbd, redoFbd, canUndoFbd, canRedoFbd } = useStaticsWorkspace();
  const { showFbd } = displayModeLayout(displayMode);
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
  const [viewMode, setViewMode] = useState<ViewMode>('front');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [resetPending, setResetPending] = useState(false);
  const [givenVisibility, setGivenVisibility] = useState<GivenVisibility>(DEFAULT_GIVEN_VISIBILITY);
  const [pendingTarget, setPendingTarget] = useState<FBDTarget | null | undefined>(undefined);
  const [forceFormOpen, setForceFormOpen] = useState(false);
  const [forceDraft, setForceDraft] = useState({ x: '0', y: '0', label: 'F', angle: '-90', magnitude: '', role: 'applied' });
  const [forceError, setForceError] = useState('');
  const [selectedForceId, setSelectedForceId] = useState<string | null>(null);
  const [momentFormOpen, setMomentFormOpen] = useState(false);
  const [momentDraft, setMomentDraft] = useState({ x: '0', y: '0', label: 'M', clockwise: 'clockwise', magnitude: '' });
  const [momentError, setMomentError] = useState('');
  const [selectedMomentId, setSelectedMomentId] = useState<string | null>(null);
  const [dimensionFormOpen, setDimensionFormOpen] = useState(false);
  const [dimensionDraft, setDimensionDraft] = useState({ startChoice: 'custom', endChoice: 'custom',
    startX: '0', startY: '0', endX: '0', endY: '0', label: '' });
  const [dimensionPick, setDimensionPick] = useState<'start' | 'end'>('start');
  const [dimensionError, setDimensionError] = useState('');
  const [selectedDimensionId, setSelectedDimensionId] = useState<string | null>(null);
  const [angleFormOpen, setAngleFormOpen] = useState(false);
  const [angleDraft, setAngleDraft] = useState({ vertexChoice: 'custom', fromChoice: 'custom', toChoice: 'custom',
    vertexX: '0', vertexY: '0', fromX: '1', fromY: '0', toX: '0', toY: '1', label: '' });
  const [anglePick, setAnglePick] = useState<'vertex' | 'from' | 'to'>('vertex');
  const [angleError, setAngleError] = useState('');
  const [selectedAngleId, setSelectedAngleId] = useState<string | null>(null);
  const [labelFormOpen, setLabelFormOpen] = useState(false);
  const [labelDraft, setLabelDraft] = useState({ x: '0', y: '0', text: '', association: '' });
  const [labelError, setLabelError] = useState('');
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  const [selectedPrimitive, setSelectedPrimitive] = useState<{ kind: FBDPrimitiveKind; id: string } | null>(null);
  const [primitiveMode, setPrimitiveMode] = useState<FBDPrimitiveKind | null>(null);
  const [primitiveEditing, setPrimitiveEditing] = useState(false);
  const [primitiveDraft, setPrimitiveDraft] = useState({ id: '', label: '', x: '0', y: '0',
    endX: '4', endY: '0', width: '4', height: '0.6', angle: '0', length: '4', jointKind: 'free',
    startJointKind: 'none', endJointKind: 'none' });
  const [primitiveError, setPrimitiveError] = useState('');
  const [diagramActionNotice, setDiagramActionNotice] = useState('');
  const [moveDraft, setMoveDraft] = useState({ dx: '0', dy: '0' });
  useEffect(() => {
    if (!hasStudentFBDElements(fbdState)) onVisualizationInteraction('fbd_blank_workspace');
  }, []);
  const [labelMoveMode, setLabelMoveMode] = useState(false);
  const [targetSearch, setTargetSearch] = useState('');
  const [editError, setEditError] = useState('');
  const [forceApplicationArmed, setForceApplicationArmed] = useState(false);
  const dragRef = useRef<FBDDrag | null>(null);
  const suppressClickRef = useRef(false);
  useEffect(() => {
    if (selectedForceId && !fbdState.forces.some((force) => force.id === selectedForceId))
      setSelectedForceId(null);
  }, [fbdState.forces, selectedForceId]);
  useEffect(() => { if (!selectedForceId) setForceApplicationArmed(false); }, [selectedForceId]);
  useEffect(() => {
    if (selectedMomentId && !fbdState.moments.some((moment) => moment.id === selectedMomentId))
      setSelectedMomentId(null);
  }, [fbdState.moments, selectedMomentId]);
  useEffect(() => {
    if (selectedDimensionId && !fbdState.dimensions.some((dimension) => dimension.id === selectedDimensionId))
      setSelectedDimensionId(null);
  }, [fbdState.dimensions, selectedDimensionId]);
  useEffect(() => {
    if (selectedAngleId && !fbdState.angles.some((angle) => angle.id === selectedAngleId))
      setSelectedAngleId(null);
  }, [fbdState.angles, selectedAngleId]);
  useEffect(() => {
    if (selectedLabelId && !fbdState.labels.some((label) => label.id === selectedLabelId)) {
      setSelectedLabelId(null);
      setLabelMoveMode(false);
    }
  }, [fbdState.labels, selectedLabelId]);
  const canvasClickRef = useRef<(event: MouseEvent) => void>(() => {});
  canvasClickRef.current = (event) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    if (!showFbd || !rendererRef.current || !cameraRef.current) return;
    const rect = rendererRef.current.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
      -((event.clientY - rect.top) / rect.height * 2 - 1));
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, cameraRef.current);
    if (forceFormOpen || momentFormOpen || dimensionFormOpen || angleFormOpen || labelFormOpen || labelMoveMode) {
      const point = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3());
      if (point && forceFormOpen) setForceDraft((current) => ({ ...current, x: point.x.toFixed(2), y: point.y.toFixed(2) }));
      if (point && momentFormOpen) setMomentDraft((current) => ({ ...current, x: point.x.toFixed(2), y: point.y.toFixed(2) }));
      if (point && dimensionFormOpen) setDimensionDraft((current) => dimensionPick === 'start'
        ? { ...current, startChoice: 'custom', startX: point.x.toFixed(2), startY: point.y.toFixed(2) }
        : { ...current, endChoice: 'custom', endX: point.x.toFixed(2), endY: point.y.toFixed(2) });
      if (point && angleFormOpen) setAngleDraft((current) => ({ ...current,
        [`${anglePick}Choice`]: 'custom', [`${anglePick}X`]: point.x.toFixed(2),
        [`${anglePick}Y`]: point.y.toFixed(2) }));
      if (point && labelFormOpen) setLabelDraft((current) => ({ ...current,
        x: point.x.toFixed(2), y: point.y.toFixed(2) }));
      if (point && labelMoveMode && selectedLabelId) {
        const before = getFBDElement(fbdState, 'label', selectedLabelId);
        const next = moveFBDLabel(fbdState, selectedLabelId, { x: point.x, y: point.y });
        setFbdState(next);
        setLabelMoveMode(false);
        if (before) onVisualizationInteraction('fbd_element_reposition', undefined, undefined, undefined, undefined,
          undefined, undefined, { elementKind: 'label', elementId: selectedLabelId, before,
            after: getFBDElement(next, 'label', selectedLabelId)!, dragTarget: 'label' },
          { before: fbdState, after: next });
      }
      return;
    }
    raycaster.params.Line.threshold = Math.max(0.08, (viewBoundsRef.current?.span || 1) * 0.018);
    for (const hit of raycaster.intersectObjects(modelRef.current?.children || [], true)) {
      let object: THREE.Object3D | null = hit.object;
      while (object && !object.userData.fbdForceId && !object.userData.fbdMomentId &&
        !object.userData.fbdDimensionId && !object.userData.fbdAngleId && !object.userData.fbdLabelId &&
        !object.userData.fbdPrimitive) object = object.parent;
      if (object?.userData.fbdPrimitive) {
        setSelectedPrimitive(object.userData.fbdPrimitive as { kind: FBDPrimitiveKind; id: string });
        setSelectedForceId(null); setSelectedMomentId(null); setSelectedDimensionId(null);
        setSelectedAngleId(null); setSelectedLabelId(null);
        return;
      }
      if (object?.userData.fbdLabelId) {
        setSelectedPrimitive(null);
        setSelectedLabelId(object.userData.fbdLabelId as string);
        setSelectedForceId(null); setSelectedMomentId(null); setSelectedDimensionId(null); setSelectedAngleId(null);
        return;
      }
      if (object?.userData.fbdForceId) {
        setSelectedPrimitive(null);
        setSelectedForceId(object.userData.fbdForceId as string);
        setSelectedMomentId(null);
        setSelectedDimensionId(null);
        setSelectedAngleId(null);
        setSelectedLabelId(null);
        return;
      }
      if (object?.userData.fbdMomentId) {
        setSelectedPrimitive(null);
        setSelectedMomentId(object.userData.fbdMomentId as string);
        setSelectedForceId(null);
        setSelectedDimensionId(null);
        setSelectedAngleId(null);
        setSelectedLabelId(null);
        return;
      }
      if (object?.userData.fbdDimensionId) {
        setSelectedPrimitive(null);
        setSelectedDimensionId(object.userData.fbdDimensionId as string);
        setSelectedForceId(null);
        setSelectedMomentId(null);
        setSelectedAngleId(null);
        setSelectedLabelId(null);
        return;
      }
      if (object?.userData.fbdAngleId) {
        setSelectedPrimitive(null);
        setSelectedAngleId(object.userData.fbdAngleId as string);
        setSelectedForceId(null);
        setSelectedMomentId(null);
        setSelectedDimensionId(null);
        setSelectedLabelId(null);
        return;
      }
    }
  };

  const pointerRay = (event: PointerEvent) => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
      -((event.clientY - rect.top) / rect.height * 2 - 1)), camera);
    ray.params.Line.threshold = Math.max(0.08, (viewBoundsRef.current?.span || 1) * 0.018);
    return ray;
  };
  const pointerDownRef = useRef<(event: PointerEvent) => void>(() => {});
  const pointerMoveRef = useRef<(event: PointerEvent) => void>(() => {});
  const pointerUpRef = useRef<(event: PointerEvent) => void>(() => {});
  pointerDownRef.current = (event) => {
    if (!showFbd || event.button !== 0 || forceFormOpen || momentFormOpen || dimensionFormOpen ||
      angleFormOpen || labelFormOpen || labelMoveMode || !modelRef.current) return;
    const ray = pointerRay(event);
    if (!ray) return;
    const start = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3());
    if (!start) return;
    for (const hit of ray.intersectObjects(modelRef.current.children, true)) {
      let object: THREE.Object3D | null = hit.object;
      while (object && !object.userData.fbdDragLabel && !object.userData.fbdDragApplication) object = object.parent;
      if (!object) continue;
      const annotation = object.userData.fbdDragLabel as { kind: FBDElementKind; id: string } | undefined;
      const applicationId = object.userData.fbdDragApplication as string | undefined;
      if (!annotation && (!applicationId || !forceApplicationArmed || applicationId !== selectedForceId)) continue;
      const controls = controlsRef.current;
      dragRef.current = { pointerId: event.pointerId, kind: annotation?.kind || 'force',
        id: annotation?.id || applicationId!, target: annotation ? 'label' : 'application', object,
        start: start.clone(), original: object.position.clone(), current: object.position.clone(),
        clientX: event.clientX, clientY: event.clientY, moved: false,
        controlsEnabled: controls?.enabled ?? true };
      if (controls) controls.enabled = false;
      rendererRef.current?.domElement.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
  };
  pointerMoveRef.current = (event) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const point = pointerRay(event)?.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3());
    if (!point) return;
    if (Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) > 3) drag.moved = true;
    if (drag.moved) {
      drag.current = drag.original.clone().add(point.sub(drag.start));
      drag.object.position.copy(drag.current);
    }
  };
  pointerUpRef.current = (event) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    if (controlsRef.current) controlsRef.current.enabled = drag.controlsEnabled;
    if (rendererRef.current?.domElement.hasPointerCapture(event.pointerId))
      rendererRef.current.domElement.releasePointerCapture(event.pointerId);
    drag.object.position.copy(drag.original);
    if (event.type === 'pointercancel') return;
    if (!drag.moved) {
      setSelectedForceId(drag.kind === 'force' ? drag.id : null);
      setSelectedMomentId(drag.kind === 'moment' ? drag.id : null);
      setSelectedDimensionId(drag.kind === 'dimension' ? drag.id : null);
      setSelectedAngleId(drag.kind === 'angle' ? drag.id : null);
      setSelectedLabelId(drag.kind === 'label' ? drag.id : null);
      return;
    }
    const before = getFBDElement(fbdState, drag.kind, drag.id);
    if (!before) return;
    const at = { x: drag.current.x, y: drag.current.y };
    const next = drag.target === 'application'
      ? moveFBDForceApplication(fbdState, drag.id, at, workspace)
      : repositionFBDLabel(fbdState, drag.kind, drag.id, at);
    const after = getFBDElement(next, drag.kind, drag.id)!;
    setFbdState(next);
    setSelectedForceId(drag.kind === 'force' ? drag.id : null);
    setSelectedMomentId(drag.kind === 'moment' ? drag.id : null);
    setSelectedDimensionId(drag.kind === 'dimension' ? drag.id : null);
    setSelectedAngleId(drag.kind === 'angle' ? drag.id : null);
    setSelectedLabelId(drag.kind === 'label' ? drag.id : null);
    setForceApplicationArmed(false);
    suppressClickRef.current = true;
    setTimeout(() => { suppressClickRef.current = false; }, 0);
    onVisualizationInteraction('fbd_element_drag', undefined, undefined, undefined, undefined,
      undefined, undefined, { elementKind: drag.kind, elementId: drag.id, before, after,
        dragTarget: drag.target }, { before: fbdState, after: next });
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
    const handlePointerDown = (event: PointerEvent) => pointerDownRef.current(event);
    const handlePointerMove = (event: PointerEvent) => pointerMoveRef.current(event);
    const handlePointerUp = (event: PointerEvent) => pointerUpRef.current(event);
    renderer.domElement.addEventListener('click', handleCanvasClick);
    renderer.domElement.addEventListener('pointerdown', handlePointerDown, true);
    renderer.domElement.addEventListener('pointermove', handlePointerMove, true);
    renderer.domElement.addEventListener('pointerup', handlePointerUp, true);
    renderer.domElement.addEventListener('pointercancel', handlePointerUp, true);
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
      // Keep CSS pixels equal to the container; the drawing buffer also scales for devicePixelRatio.
      renderer.setSize(width, height);
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
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown, true);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove, true);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp, true);
      renderer.domElement.removeEventListener('pointercancel', handlePointerUp, true);
      dragRef.current = null;
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
    const model = buildFBDModel(workspace, fbdState, selectedForceId, selectedMomentId,
      selectedDimensionId, selectedAngleId, selectedLabelId, givenVisibility,
      !showFbd, selectedPrimitive);
    modelRef.current = model.group;
    viewBoundsRef.current = { center: model.center, span: model.span };
    scene.add(model.group);
    if (!framedRef.current || framedSpanRef.current !== model.span) {
      frameModel(model.center, model.span, viewMode);
      framedRef.current = true;
      framedSpanRef.current = model.span;
    }
  }, [ready, workspace, showFbd, fbdState, selectedForceId, selectedMomentId, selectedDimensionId, selectedAngleId, selectedLabelId, givenVisibility, selectedPrimitive]);

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

  const previousDisplayModeRef = useRef(displayMode);
  useEffect(() => {
    const previous = previousDisplayModeRef.current;
    previousDisplayModeRef.current = displayMode;
    if (!ready || displayMode !== 'fbd' || previous === 'fbd') return;
    const bounds = viewBoundsRef.current;
    if (bounds) frameModel(bounds.center, bounds.span, 'front');
    setViewMode('front');
  }, [ready, displayMode]);

  useEffect(() => {
    if (!ready || !viewCommand) return;
    if (viewCommand.view === 'reset') resetView();
    else selectView(viewCommand.view);
  }, [ready, viewCommand?.sequence]);

  const targetOptions = fbdTargetOptions(workspace);
  const visibleTargetOptions = fbdTargetOptions(workspace, targetSearch);
  const selectedTargetOption = targetOptions.find((item) =>
    item.target.kind === fbdState.selectedTarget?.kind && item.target.id === fbdState.selectedTarget?.id);
  if (selectedTargetOption && !visibleTargetOptions.some((item) =>
    item.target.kind === selectedTargetOption.target.kind && item.target.id === selectedTargetOption.target.id))
    visibleTargetOptions.unshift(selectedTargetOption);
  const dimensionChoices = [
    ...workspace.nodes.map((node) => ({ value: `node:${node.id}`, label: `Joint · ${node.label || node.id}`,
      point: { x: node.x, y: node.y } })),
    ...workspace.members.flatMap((member) => {
      const start = workspace.nodes.find((node) => node.id === member.startNodeId);
      const end = workspace.nodes.find((node) => node.id === member.endNodeId);
      return start && end ? [{ value: `member:${member.id}`, label: `Midpoint · ${member.label || member.id}`,
        point: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } }] : [];
    }),
  ];
  const labelAssociations = [
    ...workspace.nodes.map((node) => ({ value: `node:${node.id}`, text: `Node · ${node.label || node.id}` })),
    ...workspace.members.map((member) => ({ value: `member:${member.id}`, text: `Member · ${member.label || member.id}` })),
    ...fbdState.forces.map((force) => ({ value: `force:${force.id}`, text: `Force · ${force.label || force.id}` })),
    ...fbdState.moments.map((moment) => ({ value: `moment:${moment.id}`, text: `Moment · ${moment.label || moment.id}` })),
    ...fbdState.dimensions.map((dimension) => ({ value: `dimension:${dimension.id}`, text: `Dimension · ${dimension.label || dimension.id}` })),
    ...fbdState.angles.map((angle) => ({ value: `angle:${angle.id}`, text: `Angle · ${angle.label || angle.id}` })),
  ];
  const selectedKind: FBDElementKind | null = selectedForceId ? 'force' : selectedMomentId ? 'moment' :
    selectedDimensionId ? 'dimension' : selectedAngleId ? 'angle' : selectedLabelId ? 'label' : null;
  const selectedId = selectedForceId || selectedMomentId || selectedDimensionId || selectedAngleId || selectedLabelId;
  const selectedElement = selectedKind && selectedId ? getFBDElement(fbdState, selectedKind, selectedId) : undefined;
  const commitTarget = (target: FBDTarget | null) => {
    const before = fbdState;
    const after = selectFBDTarget(before, target, workspace);
    if (after === before) { setPendingTarget(undefined); return; }
    setFbdState(after);
    setSelectedForceId(null); setSelectedMomentId(null); setSelectedDimensionId(null);
    setSelectedAngleId(null); setSelectedLabelId(null);
    setForceFormOpen(false); setMomentFormOpen(false); setDimensionFormOpen(false);
    setAngleFormOpen(false); setLabelFormOpen(false); setLabelMoveMode(false);
    setPendingTarget(undefined);
    onVisualizationInteraction(target ? 'fbd_select' : 'fbd_delete', target || undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, { before, after });
  };
  const selectTarget = (target: FBDTarget | null) => {
    if (fbdState.selectedTarget?.kind === target?.kind && fbdState.selectedTarget?.id === target?.id) return;
    setResetPending(false);
    if (hasStudentFBDElements(fbdState)) { setPendingTarget(target); return; }
    commitTarget(target);
  };
  const selectedTargetPoint = () => {
    const target = fbdState.selectedTarget;
    if (!target) {
      const body = fbdState.bodies[0];
      if (body) {
        const corners = fbdBodyCorners(body);
        return { x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 };
      }
      const member = fbdState.members[0];
      if (member) return { x: (member.start.x + member.end.x) / 2, y: (member.start.y + member.end.y) / 2 };
      return { x: 0, y: 0 };
    }
    const joint = target.kind === 'joint' ? workspace.nodes.find((node) => node.id === target.id) : null;
    const member = target.kind === 'member' ? workspace.members.find((item) => item.id === target.id) : null;
    const start = member ? workspace.nodes.find((node) => node.id === member.startNodeId) : null;
    const end = member ? workspace.nodes.find((node) => node.id === member.endNodeId) : null;
    return { x: joint?.x ?? (start && end ? (start.x + end.x) / 2 : 0),
      y: joint?.y ?? (start && end ? (start.y + end.y) / 2 : 0) };
  };
  const openForceForm = () => {
    const { x, y } = selectedTargetPoint();
    setForceDraft({ x: String(x), y: String(y), label: 'F', angle: '-90', magnitude: '', role: 'applied' });
    setForceError('');
    setMomentFormOpen(false);
    setDimensionFormOpen(false);
    setAngleFormOpen(false);
    setForceFormOpen(true);
    setLabelFormOpen(false);
  };
  const submitForce = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const forceId = crypto.randomUUID();
      const input = { at: { x: Number(forceDraft.x), y: Number(forceDraft.y) },
        label: forceDraft.label, angle: Number(forceDraft.angle), role: forceDraft.role as 'applied' | 'reaction',
        ...(forceDraft.magnitude.trim() ? { magnitude: Number(forceDraft.magnitude) } : {}) };
      const next = addFBDForce(fbdState, input, workspace, forceId);
      const force = next.forces[next.forces.length - 1];
      setFbdState(next);
      setSelectedForceId(force.id);
      setSelectedMomentId(null);
      setSelectedDimensionId(null);
      setSelectedAngleId(null);
      setSelectedLabelId(null);
      setForceFormOpen(false);
      setForceError('');
      onVisualizationInteraction('fbd_force_add', undefined, force, undefined, undefined, undefined,
        undefined, undefined, { before: fbdState, after: next });
    } catch (caught) {
      setForceError(caught instanceof Error ? caught.message : 'Could not add force.');
    }
  };
  const openMomentForm = () => {
    const { x, y } = selectedTargetPoint();
    setMomentDraft({ x: String(x), y: String(y), label: 'M', clockwise: 'clockwise', magnitude: '' });
    setMomentError('');
    setForceFormOpen(false);
    setDimensionFormOpen(false);
    setAngleFormOpen(false);
    setMomentFormOpen(true);
    setLabelFormOpen(false);
  };
  const submitMoment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const momentId = crypto.randomUUID();
      const input = { at: { x: Number(momentDraft.x), y: Number(momentDraft.y) },
        label: momentDraft.label, clockwise: momentDraft.clockwise === 'clockwise',
        ...(momentDraft.magnitude.trim() ? { magnitude: Number(momentDraft.magnitude) } : {}) };
      const next = addFBDMoment(fbdState, input, workspace, momentId);
      const moment = next.moments[next.moments.length - 1];
      setFbdState(next);
      setSelectedMomentId(moment.id);
      setSelectedForceId(null);
      setSelectedDimensionId(null);
      setSelectedAngleId(null);
      setSelectedLabelId(null);
      setMomentFormOpen(false);
      setMomentError('');
      onVisualizationInteraction('fbd_moment_add', undefined, undefined, moment, undefined, undefined,
        undefined, undefined, { before: fbdState, after: next });
    } catch (caught) {
      setMomentError(caught instanceof Error ? caught.message : 'Could not add moment.');
    }
  };
  const openDimensionForm = () => {
    const target = fbdState.selectedTarget;
    const member = target?.kind === 'member' ? workspace.members.find((item) => item.id === target.id) : null;
    const firstId = member?.startNodeId || (target?.kind === 'joint' ? target.id : workspace.nodes[0]?.id);
    const lastId = member?.endNodeId || workspace.nodes.find((node) => node.id !== firstId)?.id;
    const start = dimensionChoices.find((item) => item.value === `node:${firstId}`);
    const end = dimensionChoices.find((item) => item.value === `node:${lastId}`);
    setDimensionDraft({ startChoice: start?.value || 'custom', endChoice: end?.value || 'custom',
      startX: String(start?.point.x ?? 0), startY: String(start?.point.y ?? 0),
      endX: String(end?.point.x ?? 0), endY: String(end?.point.y ?? 0), label: '' });
    setDimensionPick('start');
    setDimensionError('');
    setForceFormOpen(false);
    setMomentFormOpen(false);
    setAngleFormOpen(false);
    setDimensionFormOpen(true);
    setLabelFormOpen(false);
  };
  const submitDimension = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const dimensionId = crypto.randomUUID();
      const input = { start: { x: Number(dimensionDraft.startX), y: Number(dimensionDraft.startY) },
        end: { x: Number(dimensionDraft.endX), y: Number(dimensionDraft.endY) },
        label: dimensionDraft.label };
      const next = addFBDDimension(fbdState, input, workspace, dimensionId);
      const dimension = next.dimensions[next.dimensions.length - 1];
      setFbdState(next);
      setSelectedDimensionId(dimension.id);
      setSelectedForceId(null);
      setSelectedMomentId(null);
      setSelectedAngleId(null);
      setSelectedLabelId(null);
      setDimensionFormOpen(false);
      setDimensionError('');
      onVisualizationInteraction('fbd_dimension_add', undefined, undefined, undefined, dimension, undefined,
        undefined, undefined, { before: fbdState, after: next });
    } catch (caught) {
      setDimensionError(caught instanceof Error ? caught.message : 'Could not add dimension.');
    }
  };
  const openAngleForm = () => {
    const vertex = selectedTargetPoint();
    const vertexChoice = fbdState.selectedTarget?.kind === 'joint'
      ? `node:${fbdState.selectedTarget.id}` : 'custom';
    setAngleDraft({ vertexChoice, fromChoice: 'custom', toChoice: 'custom',
      vertexX: String(vertex.x), vertexY: String(vertex.y),
      fromX: String(vertex.x + 1), fromY: String(vertex.y),
      toX: String(vertex.x), toY: String(vertex.y + 1), label: '' });
    setAnglePick('vertex');
    setAngleError('');
    setForceFormOpen(false);
    setMomentFormOpen(false);
    setDimensionFormOpen(false);
    setAngleFormOpen(true);
    setLabelFormOpen(false);
  };
  const submitAngle = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const angleId = crypto.randomUUID();
      const input = { vertex: { x: Number(angleDraft.vertexX), y: Number(angleDraft.vertexY) },
        from: { x: Number(angleDraft.fromX), y: Number(angleDraft.fromY) },
        to: { x: Number(angleDraft.toX), y: Number(angleDraft.toY) },
        label: angleDraft.label };
      const next = addFBDAngle(fbdState, input, workspace, angleId);
      const angle = next.angles[next.angles.length - 1];
      setFbdState(next);
      setSelectedAngleId(angle.id);
      setSelectedForceId(null);
      setSelectedMomentId(null);
      setSelectedDimensionId(null);
      setSelectedLabelId(null);
      setAngleFormOpen(false);
      setAngleError('');
      onVisualizationInteraction('fbd_angle_add', undefined, undefined, undefined, undefined, angle,
        undefined, undefined, { before: fbdState, after: next });
    } catch (caught) {
      setAngleError(caught instanceof Error ? caught.message : 'Could not add angle.');
    }
  };

  const openLabelForm = () => {
    const { x, y } = selectedTargetPoint();
    setLabelDraft({ x: String(x), y: String(y), text: '', association: '' });
    setLabelError('');
    setForceFormOpen(false); setMomentFormOpen(false); setDimensionFormOpen(false); setAngleFormOpen(false);
    setLabelMoveMode(false);
    setLabelFormOpen(true);
  };
  const submitLabel = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const association = labelAssociations.find((item) => item.value === labelDraft.association);
      if (labelDraft.association && !association) throw new Error('Unknown FBD label association.');
      const input = { at: { x: Number(labelDraft.x), y: Number(labelDraft.y) }, text: labelDraft.text,
        ...(association ? { associatedWith: {
          kind: labelDraft.association.split(':')[0] as FBDLabelAssociation['kind'],
          id: labelDraft.association.slice(labelDraft.association.indexOf(':') + 1),
        } } : {}) };
      const next = addFBDLabel(fbdState, input, workspace, crypto.randomUUID());
      const label = next.labels[next.labels.length - 1];
      setFbdState(next);
      setSelectedLabelId(label.id);
      setSelectedForceId(null); setSelectedMomentId(null); setSelectedDimensionId(null); setSelectedAngleId(null);
      setLabelFormOpen(false);
      setLabelError('');
      onVisualizationInteraction('fbd_label_add', undefined, undefined, undefined, undefined, undefined,
        label, undefined, { before: fbdState, after: next });
    } catch (caught) {
      setLabelError(caught instanceof Error ? caught.message : 'Could not add label.');
    }
  };
  const submitSelectedEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedKind || !selectedId || !selectedElement) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '');
    const number = (name: string) => {
      const raw = value(name).trim();
      if (!raw) throw new Error(`Enter ${name}.`);
      return Number(raw);
    };
    const point = (prefix: string) => ({ x: number(`${prefix}X`), y: number(`${prefix}Y`) });
    try {
      let next: FBDState;
      if (selectedKind === 'force') next = editFBDForce(fbdState, selectedId, {
        at: point('at'), angle: number('angle'), label: value('label'),
        role: value('role') === 'reaction' ? 'reaction' : 'applied',
        ...(value('magnitude').trim() ? { magnitude: number('magnitude') } : {}),
      }, workspace);
      else if (selectedKind === 'moment') next = editFBDMoment(fbdState, selectedId, {
        at: point('at'), clockwise: value('direction') === 'clockwise', label: value('label'),
        ...(value('magnitude').trim() ? { magnitude: number('magnitude') } : {}),
      }, workspace);
      else if (selectedKind === 'dimension') next = editFBDDimension(fbdState, selectedId, {
        start: point('start'), end: point('end'), label: value('label'),
      }, workspace);
      else if (selectedKind === 'angle') next = editFBDAngle(fbdState, selectedId, {
        vertex: point('vertex'), from: point('from'), to: point('to'), label: value('label'),
      }, workspace);
      else {
        const association = value('association');
        const chosen = labelAssociations.find((item) => item.value === association);
        if (association && !chosen) throw new Error('Unknown FBD label association.');
        next = editFBDLabel(fbdState, selectedId, { at: point('at'), text: value('text'),
          ...(chosen ? { associatedWith: { kind: association.split(':')[0] as FBDLabelAssociation['kind'],
            id: association.slice(association.indexOf(':') + 1) } } : {}),
        }, workspace);
      }
      const after = getFBDElement(next, selectedKind, selectedId)!;
      setFbdState(next);
      setEditError('');
      onVisualizationInteraction('fbd_element_edit', undefined, undefined, undefined, undefined,
        undefined, undefined, { elementKind: selectedKind, elementId: selectedId, before: selectedElement, after },
        { before: fbdState, after: next });
    } catch (caught) {
      setEditError(caught instanceof Error ? caught.message : 'Could not edit FBD element.');
    }
  };
  const deleteSelected = () => {
    if (!selectedKind || !selectedId || !selectedElement) return;
    const next = deleteFBDElement(fbdState, selectedKind, selectedId);
    setFbdState(next);
    onVisualizationInteraction('fbd_element_delete', undefined, undefined, undefined, undefined,
      undefined, undefined, { elementKind: selectedKind, elementId: selectedId,
        before: selectedElement, after: null }, { before: fbdState, after: next });
    setSelectedForceId(null); setSelectedMomentId(null); setSelectedDimensionId(null);
    setSelectedAngleId(null); setSelectedLabelId(null); setLabelMoveMode(false); setEditError('');
  };
  const selectedPrimitiveElement = selectedPrimitive
    ? getFBDElement(fbdState, selectedPrimitive.kind, selectedPrimitive.id) : undefined;
  const recordPrimitiveChange = (kind: FBDPrimitiveKind, action: 'add' | 'edit' | 'move' | 'delete',
    id: string, next: FBDState) => {
    setFbdState(next);
    onVisualizationInteraction(`fbd_${kind}_${action}` as VisualizationAction,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      { before: fbdState, after: next }, { kind, id });
  };
  const openPrimitiveForm = (kind: FBDPrimitiveKind, editing = false) => {
    const item = editing && selectedPrimitive?.kind === kind ? selectedPrimitiveElement : undefined;
    const draft = { id: item?.id || '', label: item && 'label' in item ? item.label || '' : '',
      x: '0', y: '0', endX: '4', endY: '0', width: '4', height: '0.6', angle: '0', length: '4', jointKind: 'free',
      startJointKind: 'none', endJointKind: 'none' };
    if (item && kind === 'body') {
      const body = item as FBDBody;
      draft.x = String(body.origin.x); draft.y = String(body.origin.y);
      draft.width = String(body.width); draft.height = String(body.height);
      draft.angle = String(body.angle ?? 0);
      draft.startJointKind = body.startJointKind && body.startJointKind !== 'free' ? body.startJointKind : 'none';
      draft.endJointKind = body.endJointKind && body.endJointKind !== 'free' ? body.endJointKind : 'none';
    } else if (item && kind === 'joint') {
      const joint = item as FBDJoint;
      draft.x = String(joint.at.x); draft.y = String(joint.at.y); draft.jointKind = joint.kind || 'free';
    } else if (item && kind === 'member') {
      const member = item as FBDMember;
      draft.x = String(member.start.x); draft.y = String(member.start.y);
      draft.endX = String(member.end.x); draft.endY = String(member.end.y);
      draft.angle = String(Math.atan2(member.end.y - member.start.y,
        member.end.x - member.start.x) * 180 / Math.PI);
      draft.length = String(Math.hypot(member.end.x - member.start.x,
        member.end.y - member.start.y));
      draft.startJointKind = member.startJointKind && member.startJointKind !== 'free' ? member.startJointKind : 'none';
      draft.endJointKind = member.endJointKind && member.endJointKind !== 'free' ? member.endJointKind : 'none';
    }
    setPrimitiveDraft(draft); setPrimitiveEditing(editing); setPrimitiveMode(kind); setPrimitiveError('');
  };
  const updateMemberCoordinate = (key: 'x' | 'y' | 'endX' | 'endY', value: string) => {
    const draft = { ...primitiveDraft, [key]: value };
    const x = Number(draft.x); const y = Number(draft.y);
    const endX = Number(draft.endX); const endY = Number(draft.endY);
    if ([draft.x, draft.y, draft.endX, draft.endY].every((item) => item.trim() !== '') &&
      [x, y, endX, endY].every(Number.isFinite)) {
      draft.length = String(Math.hypot(endX - x, endY - y));
      draft.angle = String(Math.atan2(endY - y, endX - x) * 180 / Math.PI);
    }
    setPrimitiveDraft(draft);
  };
  const updateMemberPolar = (key: 'angle' | 'length', value: string) => {
    const draft = { ...primitiveDraft, [key]: value };
    const angle = Number(draft.angle); const length = Number(draft.length);
    if (draft.angle.trim() && draft.length.trim() && Number.isFinite(angle) &&
      Number.isFinite(length) && length > 0) {
      const end = fbdMemberEndFromAngle({ x: Number(draft.x), y: Number(draft.y) }, length, angle);
      draft.endX = String(Number(end.x.toFixed(6)));
      draft.endY = String(Number(end.y.toFixed(6)));
    }
    setPrimitiveDraft(draft);
  };
  const submitPrimitive = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!primitiveMode) return;
    const id = primitiveDraft.id.trim();
    const label = primitiveDraft.label.trim();
    const at = { x: Number(primitiveDraft.x), y: Number(primitiveDraft.y) };
    try {
      const item = primitiveMode === 'body'
        ? { id, origin: at, width: Number(primitiveDraft.width), height: Number(primitiveDraft.height),
          angle: Number(primitiveDraft.angle),
          ...(primitiveDraft.startJointKind === 'none' ? {} : { startJointKind: primitiveDraft.startJointKind as FBDJoint['kind'] }),
          ...(primitiveDraft.endJointKind === 'none' ? {} : { endJointKind: primitiveDraft.endJointKind as FBDJoint['kind'] }),
          ...(label ? { label } : {}) } as FBDBody
        : primitiveMode === 'joint' ? { id, at, kind: primitiveDraft.jointKind as FBDJoint['kind'],
          ...(label ? { label } : {}) } as FBDJoint
          : { id, start: at, end: { x: Number(primitiveDraft.endX), y: Number(primitiveDraft.endY) },
            ...(primitiveDraft.startJointKind === 'none' ? {} : { startJointKind: primitiveDraft.startJointKind as FBDJoint['kind'] }),
            ...(primitiveDraft.endJointKind === 'none' ? {} : { endJointKind: primitiveDraft.endJointKind as FBDJoint['kind'] }),
            ...(label ? { label } : {}) } as FBDMember;
      const next = primitiveEditing ? editFBDPrimitive(fbdState, primitiveMode, id, item) :
        primitiveMode === 'body' ? addFBDBody(fbdState, item as FBDBody) :
          primitiveMode === 'joint' ? addFBDJoint(fbdState, item as FBDJoint) :
            addFBDMember(fbdState, item as FBDMember);
      recordPrimitiveChange(primitiveMode, primitiveEditing ? 'edit' : 'add', id, next);
      setSelectedPrimitive({ kind: primitiveMode, id });
      setPrimitiveMode(null); setPrimitiveError('');
    } catch (caught) { setPrimitiveError(caught instanceof Error ? caught.message : 'Could not save FBD element.'); }
  };
  const moveSelectedPrimitive = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedPrimitive || !selectedPrimitiveElement) return;
    const dx = Number(moveDraft.dx); const dy = Number(moveDraft.dy);
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
      setPrimitiveError('Enter a nonzero finite movement.'); return;
    }
    const translate = (point: { x: number; y: number }) => ({ x: point.x + dx, y: point.y + dy });
    const item = selectedPrimitive.kind === 'body' ? {
      ...(selectedPrimitiveElement as FBDBody), origin: translate((selectedPrimitiveElement as FBDBody).origin),
    } : selectedPrimitive.kind === 'joint' ? {
      ...(selectedPrimitiveElement as FBDJoint), at: translate((selectedPrimitiveElement as FBDJoint).at),
    } : { ...(selectedPrimitiveElement as FBDMember),
      start: translate((selectedPrimitiveElement as FBDMember).start),
      end: translate((selectedPrimitiveElement as FBDMember).end) };
    const next = editFBDPrimitive(fbdState, selectedPrimitive.kind, selectedPrimitive.id, item);
    recordPrimitiveChange(selectedPrimitive.kind, 'move', selectedPrimitive.id, next);
    setMoveDraft({ dx: '0', dy: '0' }); setPrimitiveError('');
  };
  const deleteSelectedPrimitive = () => {
    if (!selectedPrimitive) return;
    const next = deleteFBDElement(fbdState, selectedPrimitive.kind, selectedPrimitive.id);
    recordPrimitiveChange(selectedPrimitive.kind, 'delete', selectedPrimitive.id, next);
    setSelectedPrimitive(null); setPrimitiveMode(null);
  };
  const submitLabelPosition = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedKind || !selectedId || !selectedElement) return;
    const form = new FormData(event.currentTarget);
    const x = String(form.get('x') ?? '').trim();
    const y = String(form.get('y') ?? '').trim();
    if (!x || !y) { setEditError('Enter both label coordinates.'); return; }
    try {
      const next = repositionFBDLabel(fbdState, selectedKind, selectedId,
        { x: Number(x), y: Number(y) });
      setFbdState(next);
      setEditError('');
      onVisualizationInteraction('fbd_element_reposition', undefined, undefined, undefined, undefined,
        undefined, undefined, { elementKind: selectedKind, elementId: selectedId,
          before: selectedElement, after: getFBDElement(next, selectedKind, selectedId)!, dragTarget: 'label' },
        { before: fbdState, after: next });
    } catch (caught) {
      setEditError(caught instanceof Error ? caught.message : 'Could not reposition label.');
    }
  };
  const editNumber = (name: string, title: string, initial: number | undefined, optional = false) =>
    <label key={name}>{title}<input name={name} type="number" step="any" required={!optional}
      min={optional ? 0 : undefined} defaultValue={initial ?? ''}
      className="block w-full rounded border border-slate-300 px-2 py-1" /></label>;
  const editText = (name: string, title: string, initial: string, maxLength = 120) =>
    <label key={name} className="col-span-2">{title}<input name={name} required maxLength={maxLength}
      defaultValue={initial} className="block w-full rounded border border-slate-300 px-2 py-1" /></label>;

  return (
    <aside className="absolute inset-0 z-20 flex h-full max-h-full min-h-0 flex-col overflow-hidden border-l border-slate-200 bg-white md:relative md:inset-auto md:z-auto md:w-[64vw] md:min-w-[600px] md:flex-shrink-0" aria-label="Engineering visualization">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Box className="size-4 text-blue-600" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-900">Engineering visualization</h2>
            <p className="text-[11px] text-slate-500">Your FBD · {fbdState.bodies.length + fbdState.joints.length + fbdState.members.length +
              fbdState.forces.length + fbdState.moments.length + fbdState.dimensions.length +
              fbdState.angles.length + fbdState.labels.length} elements</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onClose} className="rounded p-1.5 text-slate-600 hover:bg-slate-100" title="Close visualization" aria-label="Close visualization"><X className="size-4" /></button>
        </div>
      </div>
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 px-2 py-2" aria-label="Engineering display modes and camera views">
        {DISPLAY_MODES.map(({ mode, label }) => <button key={mode} type="button"
          onClick={() => onDisplayModeChange(mode)} aria-pressed={displayMode === mode}
          className={`shrink-0 rounded px-2 py-1 text-xs ${displayMode === mode ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
          {label}
        </button>)}
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
        {showFbd && <button type="button" onClick={() => {
          setDiagramActionNotice('');
          if (selectedElement) deleteSelected();
          else if (selectedPrimitiveElement) deleteSelectedPrimitive();
          else setDiagramActionNotice('Select an element in the diagram or from the list below to delete it.');
        }} className="shrink-0 rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-800">
          Delete Selected
        </button>}
        {showFbd && <button type="button" onClick={() => {
          if (!hasStudentFBDElements(fbdState)) {
            setDiagramActionNotice('The diagram is already empty.');
            return;
          }
          setDiagramActionNotice(''); setPendingTarget(undefined); setResetPending(true);
        }} className="shrink-0 rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-800">
          Clear Diagram
        </button>}
      </div>
      {showFbd && diagramActionNotice && <p role="status"
        className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
        {diagramActionNotice}
      </p>}
      {showFbd && resetPending && hasStudentFBDElements(fbdState) && <div role="group" aria-label="Confirm Reset FBD"
        className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-300 bg-amber-50 px-3 py-2 text-xs">
        <span>Clear all student-created FBD elements? You can undo this.</span>
        <button type="button" className="rounded bg-amber-600 px-2 py-1 text-white" onClick={() => {
          const before = fbdState;
          const after = resetStudentFBDElements(before);
          if (after === before) { setResetPending(false); return; }
          setFbdState(after);
          setSelectedPrimitive(null); setPrimitiveMode(null);
          setSelectedForceId(null); setSelectedMomentId(null); setSelectedDimensionId(null);
          setSelectedAngleId(null); setSelectedLabelId(null);
          setForceFormOpen(false); setMomentFormOpen(false); setDimensionFormOpen(false);
          setAngleFormOpen(false); setLabelFormOpen(false); setLabelMoveMode(false);
          setResetPending(false);
          onVisualizationInteraction('fbd_reset', undefined, undefined, undefined,
            undefined, undefined, undefined, undefined, { before, after });
        }}>Clear FBD</button>
        <button type="button" className="rounded bg-slate-100 px-2 py-1" onClick={() => setResetPending(false)}>
          Cancel
        </button>
      </div>}
      <div className={`min-h-0 basis-0 flex-1 ${displayMode === 'split' ? 'flex flex-col' : ''}`}>
        {displayMode === 'split' && <div className="relative flex min-h-0 flex-1 flex-col border-b border-slate-300">
          <span className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-white/90 px-2 py-1 text-xs font-semibold text-slate-700">Structure</span>
          <StructurePreview workspace={workspace} fbdState={fbdState} />
          {!hasStudentFBDBaseGeometry(fbdState) &&
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4 text-center text-sm text-slate-500">
              No rigid body, joint, or member has been added yet.
            </div>}
        </div>}
        <div ref={containerRef} className={`relative min-h-0 bg-slate-50 touch-none ${displayMode === 'split' ? 'flex-1' : 'h-full'}`} aria-label={showFbd ? 'FBD canvas' : 'Structure canvas'}>
        {displayMode === 'split' && <span className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-white/90 px-2 py-1 text-xs font-semibold text-slate-700">FBD</span>}
        {showFbd && fbdState.selectedTarget && <span className="pointer-events-none absolute right-2 top-2 z-10 max-w-[70%] truncate rounded border border-emerald-300 bg-white/95 px-2 py-1 text-xs font-semibold text-emerald-800">
          Isolated: {targetOptions.find(({ target }) => target.kind === fbdState.selectedTarget?.kind && target.id === fbdState.selectedTarget?.id)?.label || fbdState.selectedTarget.id}
        </span>}
        {error && <div className="absolute inset-0 z-10 flex items-center justify-center p-4 text-sm text-slate-600">{error}</div>}
        {!(showFbd ? hasStudentFBDElements(fbdState) : hasStudentFBDBaseGeometry(fbdState)) && !error &&
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4 text-center text-sm text-slate-500">
            {showFbd ? 'No diagram yet. Start building your free-body diagram.' :
              'No rigid body, joint, or member has been added yet.'}
          </div>}
        </div>
      </div>
      {showFbd && <div className="max-h-[45%] min-h-0 shrink-0 overflow-y-auto border-t border-slate-200 px-3 py-2" aria-label="FBD construction toolbar">
        <p className="mb-2 text-xs text-slate-600">Build the diagram yourself. Nothing is copied from the engineering problem into this canvas.</p>
        <div className="mb-2 flex flex-wrap gap-1.5" aria-label="FBD base geometry tools">
          {(['body', 'member'] as const).map((kind) => <button key={kind} type="button"
            onClick={() => openPrimitiveForm(kind)} className="rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-900">
            Add {kind === 'member' ? 'Member / Line' : 'Body'}
          </button>)}
          <button type="button" onClick={() => selectedPrimitive && openPrimitiveForm(selectedPrimitive.kind, true)}
            disabled={!selectedPrimitiveElement} className="rounded bg-slate-100 px-2 py-1 text-xs disabled:text-slate-400">Edit Base Element</button>
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <label>Student base element<select aria-label="Select student-created body or member"
            value={selectedPrimitive ? `${selectedPrimitive.kind}:${selectedPrimitive.id}` : ''}
            onChange={(event) => { const [kind, ...parts] = event.target.value.split(':');
              setSelectedPrimitive(kind ? { kind: kind as FBDPrimitiveKind, id: parts.join(':') } : null);
              setSelectedForceId(null); setSelectedMomentId(null); setSelectedDimensionId(null);
              setSelectedAngleId(null); setSelectedLabelId(null); }}
            className="ml-1 max-w-48 rounded border border-slate-300 bg-white px-2 py-1">
            <option value="">Choose element</option>
            {fbdState.bodies.map((item) => <option key={`body:${item.id}`} value={`body:${item.id}`}>Body · {item.label || item.id}</option>)}
            {fbdState.members.map((item) => <option key={`member:${item.id}`} value={`member:${item.id}`}>Member · {item.label || item.id}</option>)}
          </select></label>
        </div>
        {primitiveMode && <form onSubmit={submitPrimitive} className="mb-2 grid grid-cols-2 gap-2 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs"
          aria-label={`${primitiveEditing ? 'Edit' : 'Add'} ${primitiveMode} details`}>
          <strong className="col-span-2">{primitiveEditing ? 'Edit' : 'Add'} {primitiveMode}</strong>
          <label>ID<input required maxLength={128} value={primitiveDraft.id} disabled={primitiveEditing}
            onChange={(event) => setPrimitiveDraft({ ...primitiveDraft, id: event.target.value })}
            className="block w-full rounded border px-2 py-1" /></label>
          <label>Display label (optional)<input maxLength={120} value={primitiveDraft.label}
            onChange={(event) => setPrimitiveDraft({ ...primitiveDraft, label: event.target.value })}
            className="block w-full rounded border px-2 py-1" /></label>
          {(['x', 'y'] as const).map((key) => <label key={key}>{primitiveMode === 'member' ? 'Start ' : 'Position '}{key.toUpperCase()}
            <input required type="number" step="any" value={primitiveDraft[key]}
              onChange={(event) => primitiveMode === 'member'
                ? updateMemberCoordinate(key, event.target.value)
                : setPrimitiveDraft({ ...primitiveDraft, [key]: event.target.value })}
              className="block w-full rounded border px-2 py-1" /></label>)}
          {primitiveMode === 'joint' && <label>Joint type<select aria-label="Joint type"
            value={primitiveDraft.jointKind}
            onChange={(event) => setPrimitiveDraft({ ...primitiveDraft, jointKind: event.target.value })}
            className="block w-full rounded border px-2 py-1">
            <option value="free">Free point</option><option value="pin">Pin</option>
            <option value="roller">Roller</option><option value="fixed">Fixed</option>
          </select></label>}
          {primitiveMode === 'body' && (['width', 'height'] as const).map((key) => <label key={key}>{key}
            <input required type="number" min="0.000001" step="any" value={primitiveDraft[key]}
              onChange={(event) => setPrimitiveDraft({ ...primitiveDraft, [key]: event.target.value })}
              className="block w-full rounded border px-2 py-1" /></label>)}
          {primitiveMode === 'body' && <label>Body tilt (degrees from +X)
            <input required type="number" step="any" value={primitiveDraft.angle}
              onChange={(event) => setPrimitiveDraft({ ...primitiveDraft, angle: event.target.value })}
              className="block w-full rounded border px-2 py-1" /></label>}
          {primitiveMode === 'member' && (['endX', 'endY'] as const).map((key) => <label key={key}>End {key.slice(-1)}
            <input required type="number" step="any" value={primitiveDraft[key]}
              onChange={(event) => updateMemberCoordinate(key, event.target.value)}
              className="block w-full rounded border px-2 py-1" /></label>)}
          {primitiveMode === 'member' && <>
            <label>Member length<input required type="number" min="0.000001" step="any"
              value={primitiveDraft.length} onChange={(event) => updateMemberPolar('length', event.target.value)}
              className="block w-full rounded border px-2 py-1" /></label>
            <label>Member tilt (degrees from +X)<input required type="number" step="any"
              value={primitiveDraft.angle} onChange={(event) => updateMemberPolar('angle', event.target.value)}
              className="block w-full rounded border px-2 py-1" /></label>
          </>}
          {(primitiveMode === 'body' || primitiveMode === 'member') && (['startJointKind', 'endJointKind'] as const).map((key) =>
            <label key={key}>{key === 'startJointKind' ? 'Start joint in Structure View' : 'End joint in Structure View'}
              <select value={primitiveDraft[key]}
                onChange={(event) => setPrimitiveDraft({ ...primitiveDraft, [key]: event.target.value })}
                className="block w-full rounded border px-2 py-1">
                <option value="none">No joint</option><option value="pin">Pin</option>
                <option value="roller">Roller</option><option value="fixed">Fixed</option>
              </select>
            </label>)}
          <div className="col-span-2 flex gap-2"><button type="submit" className="rounded bg-emerald-700 px-2 py-1 text-white">Save {primitiveMode}</button>
            <button type="button" onClick={() => setPrimitiveMode(null)} className="rounded bg-white px-2 py-1">Cancel</button></div>
          {primitiveError && <p role="alert" className="col-span-2 text-red-700">{primitiveError}</p>}
        </form>}
        {selectedPrimitiveElement && <form onSubmit={moveSelectedPrimitive} className="mb-2 flex flex-wrap items-end gap-2 text-xs"
          aria-label="Move selected FBD base element">
          <strong>Move {selectedPrimitive?.kind} {selectedPrimitive?.id}</strong>
          <label>ΔX<input type="number" step="any" required value={moveDraft.dx}
            onChange={(event) => setMoveDraft({ ...moveDraft, dx: event.target.value })}
            className="ml-1 w-20 rounded border px-2 py-1" /></label>
          <label>ΔY<input type="number" step="any" required value={moveDraft.dy}
            onChange={(event) => setMoveDraft({ ...moveDraft, dy: event.target.value })}
            className="ml-1 w-20 rounded border px-2 py-1" /></label>
          <button type="submit" className="rounded bg-blue-600 px-2 py-1 text-white">Move Selected</button>
        </form>}
        <div className="flex flex-wrap items-center gap-1.5">
          <details className="w-full text-xs"><summary className="cursor-pointer font-medium text-slate-600">Optional problem object for FBD checking</summary>
          <label className="text-xs font-medium text-slate-700" htmlFor="fbd-target-select">Select Body/Member/Joint</label>
          <input type="search" aria-label="Search bodies, members, and joints" value={targetSearch}
            onChange={(event) => setTargetSearch(event.target.value)} placeholder="Search joints or members"
            className="w-44 max-w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs" />
          <select id="fbd-target-select" aria-label="Select Body/Member/Joint"
            className="max-w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
            value={fbdState.selectedTarget ? JSON.stringify(fbdState.selectedTarget) : ''}
            onChange={(event) => {
              const option = targetOptions.find((item) => JSON.stringify(item.target) === event.target.value);
              selectTarget(option?.target || null);
            }}>
            <option value="">Select a body, member, or joint</option>
            {visibleTargetOptions.map(({ label, target }) =>
              <option key={`${target.kind}:${target.id}`} value={JSON.stringify(target)}>{label}</option>)}
          </select>
          <span className="text-[11px] text-slate-500">Choosing a problem object does not draw it.</span>
          </details>
          <button type="button" onClick={openForceForm}
            className="rounded bg-slate-100 px-2 py-1 text-xs disabled:text-slate-400">Add Force</button>
          <button type="button" onClick={openMomentForm}
            className="rounded bg-slate-100 px-2 py-1 text-xs disabled:text-slate-400">Add Moment</button>
          <button type="button" onClick={openDimensionForm}
            className="rounded bg-slate-100 px-2 py-1 text-xs disabled:text-slate-400">Add Dimension</button>
          <button type="button" onClick={openAngleForm}
            className="rounded bg-slate-100 px-2 py-1 text-xs disabled:text-slate-400">Add Angle</button>
          <button type="button" onClick={openLabelForm}
            className="rounded bg-slate-100 px-2 py-1 text-xs disabled:text-slate-400">Add Label</button>
          <button type="button" disabled={!canUndoFbd} onClick={() => { const transition = undoFbd();
            if (transition) onVisualizationInteraction('fbd_undo', undefined, undefined, undefined,
              undefined, undefined, undefined, undefined, transition); }}
            className="rounded bg-slate-100 px-2 py-1 text-xs disabled:text-slate-400">Undo</button>
          <button type="button" disabled={!canRedoFbd} onClick={() => { const transition = redoFbd();
            if (transition) onVisualizationInteraction('fbd_redo', undefined, undefined, undefined,
              undefined, undefined, undefined, undefined, transition); }}
            className="rounded bg-slate-100 px-2 py-1 text-xs disabled:text-slate-400">Redo</button>
          <button type="button" onClick={onCheckFBD}
            className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white">Check My FBD</button>
        </div>
        {pendingTarget !== undefined && <div role="group" aria-label="Confirm isolated object change"
          className="mt-2 flex flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs">
          <span>This workspace holds one FBD. Switching the isolated object will clear its student-created elements. Undo can restore this diagram.</span>
          <button type="button" className="rounded bg-amber-600 px-2 py-1 text-white"
            onClick={() => commitTarget(pendingTarget)}>Replace diagram</button>
          <button type="button" className="rounded bg-slate-100 px-2 py-1"
            onClick={() => setPendingTarget(undefined)}>Cancel</button>
        </div>}
        {selectedElement && selectedKind && <form key={`${selectedKind}:${selectedElement.id}:${JSON.stringify(selectedElement)}`}
          onSubmit={submitSelectedEdit} className="mt-2 grid grid-cols-2 gap-2 rounded border border-blue-200 bg-blue-50 p-2 text-xs"
          aria-label={`Edit selected ${selectedKind}`}>
          <div className="col-span-2 font-semibold text-blue-900">Edit selected {selectedKind}</div>
          {selectedKind === 'force' && (() => {
            const item = selectedElement as FBDForce;
            return <>{editText('label', 'Force label', item.label || '', 80)}
              {editNumber('atX', `Point X (${workspace.units.length})`, item.at.x)}
              {editNumber('atY', `Point Y (${workspace.units.length})`, item.at.y)}
              {editNumber('angle', 'Direction (degrees from +X)', item.angle)}
              <label>Force type<select name="role" defaultValue={item.role || 'applied'}
                className="block w-full rounded border border-slate-300 bg-white px-2 py-1">
                <option value="applied">External applied force</option><option value="reaction">Support reaction</option>
              </select></label>
              {editNumber('magnitude', `Magnitude (${workspace.units.force}, optional)`, item.magnitude, true)}
              <button type="button" aria-pressed={forceApplicationArmed}
                onClick={() => setForceApplicationArmed((current) => !current)}
                className={`col-span-2 rounded px-2 py-1 ${forceApplicationArmed ? 'bg-amber-200' : 'bg-slate-100'}`}>
                {forceApplicationArmed ? 'Drag arrow to new application point' : 'Move application point (drag arrow)'}
              </button></>;
          })()}
          {selectedKind === 'moment' && (() => {
            const item = selectedElement as FBDMoment;
            return <>{editText('label', 'Moment label', item.label || '', 80)}
              {editNumber('atX', `Point X (${workspace.units.length})`, item.at.x)}
              {editNumber('atY', `Point Y (${workspace.units.length})`, item.at.y)}
              <label>Direction<select name="direction" defaultValue={item.clockwise ? 'clockwise' : 'counterclockwise'}
                className="block w-full rounded border border-slate-300 bg-white px-2 py-1">
                <option value="clockwise">Clockwise</option><option value="counterclockwise">Counterclockwise</option>
              </select></label>
              {editNumber('magnitude', `Magnitude (${workspace.units.force}·${workspace.units.length}, optional)`, item.magnitude, true)}</>;
          })()}
          {selectedKind === 'dimension' && (() => {
            const item = selectedElement as FBDDimension;
            return <>{editText('label', 'Dimension text', item.label || '')}
              {editNumber('startX', 'Start X', item.start.x)}{editNumber('startY', 'Start Y', item.start.y)}
              {editNumber('endX', 'End X', item.end.x)}{editNumber('endY', 'End Y', item.end.y)}</>;
          })()}
          {selectedKind === 'angle' && (() => {
            const item = selectedElement as FBDAngle;
            return <>{editText('label', 'Angle text', item.label || '')}
              {editNumber('vertexX', 'Vertex X', item.vertex.x)}{editNumber('vertexY', 'Vertex Y', item.vertex.y)}
              {editNumber('fromX', 'First reference X', item.from.x)}{editNumber('fromY', 'First reference Y', item.from.y)}
              {editNumber('toX', 'Second reference X', item.to.x)}{editNumber('toY', 'Second reference Y', item.to.y)}</>;
          })()}
          {selectedKind === 'label' && (() => {
            const item = selectedElement as FBDLabel;
            return <>{editText('text', 'Label text', item.text)}
              {editNumber('atX', `Position X (${workspace.units.length})`, item.at.x)}
              {editNumber('atY', `Position Y (${workspace.units.length})`, item.at.y)}
              <label className="col-span-2">Associate with (optional)<select name="association"
                defaultValue={item.associatedWith ? `${item.associatedWith.kind}:${item.associatedWith.id}` : ''}
                className="block w-full rounded border border-slate-300 bg-white px-2 py-1">
                <option value="">No association</option>
                {labelAssociations.map((choice) => <option key={choice.value} value={choice.value}>{choice.text}</option>)}
              </select></label>
              <button type="button" aria-pressed={labelMoveMode} onClick={() => setLabelMoveMode((current) => !current)}
                className="rounded bg-slate-100 px-2 py-1">{labelMoveMode ? 'Click destination on canvas' : 'Move on canvas'}</button></>;
          })()}
          <div className="col-span-2 flex gap-2"><button type="submit" className="rounded bg-blue-600 px-2 py-1 text-white">Save changes</button>
            <button type="button" onClick={deleteSelected} className="rounded bg-red-50 px-2 py-1 text-red-800">Delete Selected</button></div>
          {editError && <p className="col-span-2 text-red-700" role="alert">{editError}</p>}
        </form>}
        {selectedElement && selectedKind && <form onSubmit={submitLabelPosition}
          key={`label-position:${selectedKind}:${selectedElement.id}:${JSON.stringify(selectedElement)}`}
          aria-label="Position selected FBD label" className="mt-2 flex flex-wrap items-end gap-2 text-xs">
          <span className="font-medium">Display label position</span>
          <label>X ({workspace.units.length})<input name="x" required type="number" step="any"
            defaultValue={fbdLabelPosition(selectedKind, selectedElement, viewBoundsRef.current?.span || 1).x}
            className="block w-20 rounded border border-slate-300 px-2 py-1" /></label>
          <label>Y ({workspace.units.length})<input name="y" required type="number" step="any"
            defaultValue={fbdLabelPosition(selectedKind, selectedElement, viewBoundsRef.current?.span || 1).y}
            className="block w-20 rounded border border-slate-300 px-2 py-1" /></label>
          <button type="submit" className="rounded bg-blue-600 px-2 py-1 text-white">Set label position</button>
        </form>}
        {labelFormOpen && <form onSubmit={submitLabel} className="mt-2 grid grid-cols-2 gap-2 text-xs" aria-label="Add label details">
          <p className="col-span-2 text-slate-600">Enter text and position. Click the canvas to choose a position; association is optional.</p>
          <label className="col-span-2">Label text<input required maxLength={120} value={labelDraft.text}
            onChange={(event) => setLabelDraft({ ...labelDraft, text: event.target.value })}
            className="block w-full rounded border border-slate-300 px-2 py-1" /></label>
          <label>Position X ({workspace.units.length})<input required type="number" step="any" value={labelDraft.x}
            onChange={(event) => setLabelDraft({ ...labelDraft, x: event.target.value })}
            className="block w-full rounded border border-slate-300 px-2 py-1" /></label>
          <label>Position Y ({workspace.units.length})<input required type="number" step="any" value={labelDraft.y}
            onChange={(event) => setLabelDraft({ ...labelDraft, y: event.target.value })}
            className="block w-full rounded border border-slate-300 px-2 py-1" /></label>
          <label className="col-span-2">Associate with (optional)<select value={labelDraft.association}
            onChange={(event) => setLabelDraft({ ...labelDraft, association: event.target.value })}
            className="block w-full rounded border border-slate-300 bg-white px-2 py-1">
            <option value="">No association</option>
            {labelAssociations.map((item) => <option key={item.value} value={item.value}>{item.text}</option>)}
          </select></label>
          <div className="col-span-2 flex gap-2"><button type="submit" className="rounded bg-blue-600 px-2 py-1 text-white">Add label</button>
            <button type="button" onClick={() => setLabelFormOpen(false)} className="rounded bg-slate-100 px-2 py-1">Cancel</button></div>
          {labelError && <p className="col-span-2 text-red-700" role="alert">{labelError}</p>}
        </form>}
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
          <label>Force tilt / direction (degrees from +X)<input required type="number" step="any" list="fbd-force-angles" value={forceDraft.angle}
            onChange={(event) => setForceDraft({ ...forceDraft, angle: event.target.value })}
            className="block w-full rounded border border-slate-300 px-2 py-1" />
            <datalist id="fbd-force-angles"><option value="0" /><option value="90" /><option value="180" /><option value="-90" /></datalist></label>
          <label>Magnitude ({workspace.units.force}, optional)<input type="number" min="0" step="any" value={forceDraft.magnitude}
            onChange={(event) => setForceDraft({ ...forceDraft, magnitude: event.target.value })}
            className="block w-full rounded border border-slate-300 px-2 py-1" /></label>
          <label>Force type<select value={forceDraft.role}
            onChange={(event) => setForceDraft({ ...forceDraft, role: event.target.value })}
            className="block w-full rounded border border-slate-300 bg-white px-2 py-1">
            <option value="applied">External applied force</option><option value="reaction">Support reaction</option>
          </select></label>
          <div className="flex items-end gap-2"><button type="submit" className="rounded bg-blue-600 px-2 py-1 text-white">Add force</button>
            <button type="button" onClick={() => setForceFormOpen(false)} className="rounded bg-slate-100 px-2 py-1">Cancel</button></div>
          {forceError && <p className="col-span-2 text-red-700" role="alert">{forceError}</p>}
        </form>}
        {momentFormOpen && <form onSubmit={submitMoment} className="mt-2 grid grid-cols-2 gap-2 text-xs" aria-label="Add moment details">
          <p className="col-span-2 text-slate-600">Choose the application point on the canvas or enter its coordinates.</p>
          <label>Point X ({workspace.units.length})<input required type="number" step="any" value={momentDraft.x}
            onChange={(event) => setMomentDraft({ ...momentDraft, x: event.target.value })}
            className="block w-full rounded border border-slate-300 px-2 py-1" /></label>
          <label>Point Y ({workspace.units.length})<input required type="number" step="any" value={momentDraft.y}
            onChange={(event) => setMomentDraft({ ...momentDraft, y: event.target.value })}
            className="block w-full rounded border border-slate-300 px-2 py-1" /></label>
          <label>Moment label<input required maxLength={80} value={momentDraft.label}
            onChange={(event) => setMomentDraft({ ...momentDraft, label: event.target.value })}
            className="block w-full rounded border border-slate-300 px-2 py-1" /></label>
          <label>Direction<select value={momentDraft.clockwise}
            onChange={(event) => setMomentDraft({ ...momentDraft, clockwise: event.target.value })}
            className="block w-full rounded border border-slate-300 bg-white px-2 py-1">
            <option value="clockwise">Clockwise</option><option value="counterclockwise">Counterclockwise</option>
          </select></label>
          <label>Magnitude ({workspace.units.force}·{workspace.units.length}, optional)<input type="number" min="0" step="any" value={momentDraft.magnitude}
            onChange={(event) => setMomentDraft({ ...momentDraft, magnitude: event.target.value })}
            className="block w-full rounded border border-slate-300 px-2 py-1" /></label>
          <div className="flex items-end gap-2"><button type="submit" className="rounded bg-blue-600 px-2 py-1 text-white">Add moment</button>
            <button type="button" onClick={() => setMomentFormOpen(false)} className="rounded bg-slate-100 px-2 py-1">Cancel</button></div>
          {momentError && <p className="col-span-2 text-red-700" role="alert">{momentError}</p>}
        </form>}
        {dimensionFormOpen && <form onSubmit={submitDimension} className="mt-2 grid grid-cols-2 gap-2 text-xs" aria-label="Add dimension details">
          <p className="col-span-2 text-slate-600">Choose two entities, enter coordinates, or pick each endpoint on the canvas. Enter the dimension text yourself.</p>
          <label>Start entity<select value={dimensionDraft.startChoice}
            onChange={(event) => {
              const choice = dimensionChoices.find((item) => item.value === event.target.value);
              setDimensionDraft({ ...dimensionDraft, startChoice: event.target.value,
                startX: choice ? String(choice.point.x) : dimensionDraft.startX,
                startY: choice ? String(choice.point.y) : dimensionDraft.startY });
            }} className="block w-full rounded border border-slate-300 bg-white px-2 py-1">
            <option value="custom">Custom point</option>
            {dimensionChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
          </select></label>
          <label>End entity<select value={dimensionDraft.endChoice}
            onChange={(event) => {
              const choice = dimensionChoices.find((item) => item.value === event.target.value);
              setDimensionDraft({ ...dimensionDraft, endChoice: event.target.value,
                endX: choice ? String(choice.point.x) : dimensionDraft.endX,
                endY: choice ? String(choice.point.y) : dimensionDraft.endY });
            }} className="block w-full rounded border border-slate-300 bg-white px-2 py-1">
            <option value="custom">Custom point</option>
            {dimensionChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
          </select></label>
          <label>Start X ({workspace.units.length})<input required type="number" step="any" value={dimensionDraft.startX}
            onChange={(event) => setDimensionDraft({ ...dimensionDraft, startChoice: 'custom', startX: event.target.value })}
            className="block w-full rounded border border-slate-300 px-2 py-1" /></label>
          <label>Start Y ({workspace.units.length})<input required type="number" step="any" value={dimensionDraft.startY}
            onChange={(event) => setDimensionDraft({ ...dimensionDraft, startChoice: 'custom', startY: event.target.value })}
            className="block w-full rounded border border-slate-300 px-2 py-1" /></label>
          <label>End X ({workspace.units.length})<input required type="number" step="any" value={dimensionDraft.endX}
            onChange={(event) => setDimensionDraft({ ...dimensionDraft, endChoice: 'custom', endX: event.target.value })}
            className="block w-full rounded border border-slate-300 px-2 py-1" /></label>
          <label>End Y ({workspace.units.length})<input required type="number" step="any" value={dimensionDraft.endY}
            onChange={(event) => setDimensionDraft({ ...dimensionDraft, endChoice: 'custom', endY: event.target.value })}
            className="block w-full rounded border border-slate-300 px-2 py-1" /></label>
          <div className="col-span-2 flex flex-wrap gap-2">
            <button type="button" aria-pressed={dimensionPick === 'start'} onClick={() => setDimensionPick('start')}
              className={`rounded px-2 py-1 ${dimensionPick === 'start' ? 'bg-blue-600 text-white' : 'bg-slate-100'}`}>Pick start on canvas</button>
            <button type="button" aria-pressed={dimensionPick === 'end'} onClick={() => setDimensionPick('end')}
              className={`rounded px-2 py-1 ${dimensionPick === 'end' ? 'bg-blue-600 text-white' : 'bg-slate-100'}`}>Pick end on canvas</button>
          </div>
          <label className="col-span-2">Dimension text<input required maxLength={120} value={dimensionDraft.label}
            placeholder={`e.g. 2 ${workspace.units.length}`}
            onChange={(event) => setDimensionDraft({ ...dimensionDraft, label: event.target.value })}
            className="block w-full rounded border border-slate-300 px-2 py-1" /></label>
          <div className="col-span-2 flex gap-2"><button type="submit" className="rounded bg-blue-600 px-2 py-1 text-white">Add dimension</button>
            <button type="button" onClick={() => setDimensionFormOpen(false)} className="rounded bg-slate-100 px-2 py-1">Cancel</button></div>
          {dimensionError && <p className="col-span-2 text-red-700" role="alert">{dimensionError}</p>}
        </form>}
        {angleFormOpen && <form onSubmit={submitAngle} className="mt-2 grid grid-cols-2 gap-2 text-xs" aria-label="Add angle details">
          <p className="col-span-2 text-slate-600">Choose a vertex and two reference points or entities. The angle text is entered by you; no angle is calculated.</p>
          {(['vertex', 'from', 'to'] as const).map((part) => <div key={part} className="col-span-2 grid grid-cols-2 gap-2">
            <label className="col-span-2">{part === 'vertex' ? 'Vertex' : part === 'from' ? 'First reference direction/entity' : 'Second reference direction/entity'}
              <select value={angleDraft[`${part}Choice`]}
                onChange={(event) => {
                  const choice = dimensionChoices.find((item) => item.value === event.target.value);
                  setAngleDraft((current) => ({ ...current, [`${part}Choice`]: event.target.value,
                    [`${part}X`]: choice ? String(choice.point.x) : current[`${part}X`],
                    [`${part}Y`]: choice ? String(choice.point.y) : current[`${part}Y`] }));
                }} className="block w-full rounded border border-slate-300 bg-white px-2 py-1">
                <option value="custom">Custom point/direction</option>
                {dimensionChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
              </select>
            </label>
            <label>{part === 'vertex' ? 'Vertex' : part === 'from' ? 'First reference' : 'Second reference'} X ({workspace.units.length})
              <input required type="number" step="any" value={angleDraft[`${part}X`]}
                onChange={(event) => setAngleDraft((current) => ({ ...current, [`${part}Choice`]: 'custom', [`${part}X`]: event.target.value }))}
                className="block w-full rounded border border-slate-300 px-2 py-1" /></label>
            <label>{part === 'vertex' ? 'Vertex' : part === 'from' ? 'First reference' : 'Second reference'} Y ({workspace.units.length})
              <input required type="number" step="any" value={angleDraft[`${part}Y`]}
                onChange={(event) => setAngleDraft((current) => ({ ...current, [`${part}Choice`]: 'custom', [`${part}Y`]: event.target.value }))}
                className="block w-full rounded border border-slate-300 px-2 py-1" /></label>
          </div>)}
          <div className="col-span-2 flex flex-wrap gap-2">
            {(['vertex', 'from', 'to'] as const).map((part) => <button key={part} type="button"
              aria-pressed={anglePick === part} onClick={() => setAnglePick(part)}
              className={`rounded px-2 py-1 ${anglePick === part ? 'bg-blue-600 text-white' : 'bg-slate-100'}`}>
              Pick {part === 'from' ? 'first reference' : part === 'to' ? 'second reference' : 'vertex'} on canvas</button>)}
          </div>
          <label className="col-span-2">Angle text<input required maxLength={120} value={angleDraft.label}
            placeholder="e.g. 30°" onChange={(event) => setAngleDraft({ ...angleDraft, label: event.target.value })}
            className="block w-full rounded border border-slate-300 px-2 py-1" /></label>
          <div className="col-span-2 flex gap-2"><button type="submit" className="rounded bg-blue-600 px-2 py-1 text-white">Add angle</button>
            <button type="button" onClick={() => setAngleFormOpen(false)} className="rounded bg-slate-100 px-2 py-1">Cancel</button></div>
          {angleError && <p className="col-span-2 text-red-700" role="alert">{angleError}</p>}
        </form>}
        {fbdState.forces.length > 0 && <div className="mt-2 flex flex-wrap gap-1" aria-label="FBD forces">
          {fbdState.forces.map((force) => <button key={force.id} type="button" aria-pressed={selectedForceId === force.id}
            onClick={() => { setSelectedForceId(force.id); setSelectedMomentId(null); setSelectedDimensionId(null); setSelectedAngleId(null); setSelectedLabelId(null); setLabelMoveMode(false); }}
            className={`rounded px-2 py-1 text-xs ${selectedForceId === force.id ? 'bg-orange-100 text-orange-800' : 'bg-slate-100 text-slate-700'}`}>
            {force.label || 'F'} ({force.at.x}, {force.at.y})</button>)}
        </div>}
        {fbdState.moments.length > 0 && <div className="mt-2 flex flex-wrap gap-1" aria-label="FBD moments">
          {fbdState.moments.map((moment) => <button key={moment.id} type="button" aria-pressed={selectedMomentId === moment.id}
            onClick={() => { setSelectedMomentId(moment.id); setSelectedForceId(null); setSelectedDimensionId(null); setSelectedAngleId(null); setSelectedLabelId(null); setLabelMoveMode(false); }}
            className={`rounded px-2 py-1 text-xs ${selectedMomentId === moment.id ? 'bg-orange-100 text-orange-800' : 'bg-slate-100 text-slate-700'}`}>
            {moment.label || 'M'} · {moment.clockwise ? 'CW' : 'CCW'} ({moment.at.x}, {moment.at.y})</button>)}
        </div>}
        {fbdState.dimensions.length > 0 && <div className="mt-2 flex flex-wrap gap-1" aria-label="FBD dimensions">
          {fbdState.dimensions.map((dimension) => <button key={dimension.id} type="button" aria-pressed={selectedDimensionId === dimension.id}
            onClick={() => { setSelectedDimensionId(dimension.id); setSelectedForceId(null); setSelectedMomentId(null); setSelectedAngleId(null); setSelectedLabelId(null); setLabelMoveMode(false); }}
            className={`rounded px-2 py-1 text-xs ${selectedDimensionId === dimension.id ? 'bg-orange-100 text-orange-800' : 'bg-slate-100 text-slate-700'}`}>
            {dimension.label || 'Dimension'} ({dimension.start.x}, {dimension.start.y})–({dimension.end.x}, {dimension.end.y})</button>)}
        </div>}
        {fbdState.angles.length > 0 && <div className="mt-2 flex flex-wrap gap-1" aria-label="FBD angles">
          {fbdState.angles.map((angle) => <button key={angle.id} type="button" aria-pressed={selectedAngleId === angle.id}
            onClick={() => { setSelectedAngleId(angle.id); setSelectedForceId(null); setSelectedMomentId(null); setSelectedDimensionId(null); setSelectedLabelId(null); setLabelMoveMode(false); }}
            className={`rounded px-2 py-1 text-xs ${selectedAngleId === angle.id ? 'bg-orange-100 text-orange-800' : 'bg-slate-100 text-slate-700'}`}>
            {angle.label} ({angle.vertex.x}, {angle.vertex.y})</button>)}
        </div>}
        {fbdState.labels.length > 0 && <div className="mt-2 flex flex-wrap gap-1" aria-label="FBD labels">
          {fbdState.labels.map((item) => <button key={item.id} type="button" aria-pressed={selectedLabelId === item.id}
            onClick={() => { setSelectedLabelId(item.id); setSelectedForceId(null); setSelectedMomentId(null);
              setSelectedDimensionId(null); setSelectedAngleId(null); setLabelMoveMode(false); }}
            className={`rounded px-2 py-1 text-xs ${selectedLabelId === item.id ? 'bg-orange-100 text-orange-800' : 'bg-slate-100 text-slate-700'}`}>
            {item.text} ({item.at.x.toFixed(2)}, {item.at.y.toFixed(2)})</button>)}
        </div>}
      </div>}
      {!showFbd && <div className="border-t border-slate-200 px-3 py-2 text-[11px] text-slate-500">
        <p>Ask the chat to move or add loads, change supports, or resize the beam.</p>
        <p>{viewMode === 'free' ? 'Drag to rotate' : 'Free Orbit enables rotation'} · Scroll to zoom · Right drag to pan · Length: {workspace.units.length} · Force: {workspace.units.force}</p>
      </div>}
    </aside>
  );
}
