import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Box, RotateCcw, X } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { useStaticsWorkspace } from './StaticsWorkspaceProvider';
import { fbdTargetOptions } from './fbdTargetOptions';
import type { VisualizationAction } from './researchLog';
import type { BeamReactionResult } from './calculations';
import { visibleCalculation, type RequestedVisualCalculation } from './calculationPolicy';
import type { EngineeringView } from './engineeringTools';
import type { StaticsWorkspace } from './model';
import { DISPLAY_MODES, displayModeLayout, type EngineeringDisplayMode } from './displayMode';
import { fbdMemberEndFromAngle,
  fbdStateForMemberCanvas,
  hasStudentFBDElements, resetStudentFBDElements, selectFBDTarget,
  addFBDBody, addFBDJoint, addFBDMember, editFBDPrimitive,
  addFBDForce, addFBDMoment, addFBDDimension, addFBDAngle, addFBDLabel, moveFBDLabel,
  editFBDForce, editFBDMoment, editFBDDimension, editFBDAngle, editFBDLabel,
  deleteFBDElement, getFBDElement, repositionFBDLabel, moveFBDForceApplication,
  type FBDForce, type FBDMoment, type FBDDimension, type FBDAngle, type FBDLabel,
  type FBDBody, type FBDJoint, type FBDMember, type FBDPrimitiveKind,
  type FBDElement, type FBDElementKind, type FBDLabelAssociation, type FBDState, type FBDTarget } from './fbdState';
import { DEFAULT_GIVEN_VISIBILITY, GIVEN_TOGGLES, type GivenVisibility } from './fbdGiven';
import { forceApplicationPointAfterDrag, pointAfterSceneDrag } from './fbdDrag';
import { buildFBDModel, buildStructureModel, disposeGroup, hasStudentFBDBaseGeometry } from './fbdCanvasScene';
import { StructurePreview } from './StructurePreview';

type ViewMode = 'front' | 'top' | 'right' | 'isometric' | 'free';
type FBDDrag = { pointerId: number; kind: FBDElementKind; id: string;
  target: 'label' | 'application' | 'body' | 'member'; object: THREE.Object3D;
  start: THREE.Vector3; original: THREE.Vector3; current: THREE.Vector3;
  originalApplication?: { x: number; y: number };
  clientX: number; clientY: number; moved: boolean; controlsEnabled: boolean };
const VIEW_BUTTONS: { label: string; mode: Exclude<ViewMode, 'free'> }[] = [
  { label: 'Front', mode: 'front' },
  { label: 'Top', mode: 'top' },
  { label: 'Right', mode: 'right' },
  { label: 'Isometric', mode: 'isometric' },
];

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
  const { workspace, fbdState, setFbdState, undoFbd, redoFbd, canUndoFbd, canRedoFbd,
    activeFbdMemberId, setActiveFbdMemberId } = useStaticsWorkspace();
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
  const [momentDraft, setMomentDraft] = useState({ x: '0', y: '0', label: 'M', clockwise: 'clockwise', magnitude: '', role: 'applied' });
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
  const activeMemberId = activeFbdMemberId ?? fbdState.members[0]?.id ?? null;
  const [primitiveMode, setPrimitiveMode] = useState<FBDPrimitiveKind | null>(null);
  const [primitiveEditing, setPrimitiveEditing] = useState(false);
  const [primitiveDraft, setPrimitiveDraft] = useState({ id: '', label: '', x: '0', y: '0',
    endX: '4', endY: '0', width: '4', height: '0.6', angle: '0', length: '4', jointKind: 'free',
    startJointKind: 'none', endJointKind: 'none' });
  const [primitiveError, setPrimitiveError] = useState('');
  const [diagramActionNotice, setDiagramActionNotice] = useState('');
  const [moveDraft, setMoveDraft] = useState({ dx: '0', dy: '0' });
  useEffect(() => {
    if (selectedPrimitive) return;
    const bases = [...fbdState.bodies.map((item) => ({ kind: 'body' as const, id: item.id })),
      ...fbdState.members.map((item) => ({ kind: 'member' as const, id: item.id }))];
    if (bases.length === 1) setSelectedPrimitive(bases[0]);
  }, [fbdState.bodies, fbdState.members, selectedPrimitive]);
  useEffect(() => {
    if (!hasStudentFBDElements(fbdState)) onVisualizationInteraction('fbd_blank_workspace');
  }, []);
  const [labelMoveMode, setLabelMoveMode] = useState(false);
  const [targetSearch, setTargetSearch] = useState('');
  const [editError, setEditError] = useState('');
  const dragRef = useRef<FBDDrag | null>(null);
  const suppressClickRef = useRef(false);
  useEffect(() => {
    if (selectedForceId && !fbdState.forces.some((force) => force.id === selectedForceId))
      setSelectedForceId(null);
  }, [fbdState.forces, selectedForceId]);
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
      while (object && !object.userData.fbdDragLabel && !object.userData.fbdDragApplication &&
        !object.userData.fbdDragBody && !object.userData.fbdDragMember) object = object.parent;
      if (!object) continue;
      const annotation = object.userData.fbdDragLabel as { kind: FBDElementKind; id: string } | undefined;
      const applicationId = object.userData.fbdDragApplication as string | undefined;
      const bodyId = object.userData.fbdDragBody as string | undefined;
      const memberId = object.userData.fbdDragMember as string | undefined;
      if (!annotation && !applicationId && !bodyId && !memberId) continue;
      const controls = controlsRef.current;
      const originalApplication = applicationId
        ? fbdState.forces.find((force) => force.id === applicationId)?.at
        : bodyId ? fbdState.bodies.find((body) => body.id === bodyId)?.origin
        : memberId ? fbdState.members.find((member) => member.id === memberId)?.start : undefined;
      dragRef.current = { pointerId: event.pointerId,
        kind: annotation?.kind || (bodyId ? 'body' : memberId ? 'member' : 'force'),
        id: annotation?.id || applicationId || bodyId || memberId!,
        target: annotation ? 'label' : bodyId ? 'body' : memberId ? 'member' : 'application', object,
        start: start.clone(), original: object.position.clone(), current: object.position.clone(),
        originalApplication: originalApplication ? { ...originalApplication } : undefined,
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
      event.preventDefault();
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
    const at = (drag.target === 'application' || drag.target === 'body' || drag.target === 'member') && drag.originalApplication
      ? forceApplicationPointAfterDrag(drag.originalApplication, drag.original, drag.current)
      : { x: drag.current.x, y: drag.current.y };
    const next = drag.target === 'application'
      ? moveFBDForceApplication(fbdState, drag.id, at, workspace)
      : drag.target === 'body'
        ? editFBDPrimitive(fbdState, 'body', drag.id,
          { ...(before as FBDBody), origin: pointAfterSceneDrag((before as FBDBody).origin, drag.original, drag.current) })
      : drag.target === 'member'
        ? editFBDPrimitive(fbdState, 'member', drag.id, {
          ...(before as FBDMember),
          start: pointAfterSceneDrag((before as FBDMember).start, drag.original, drag.current),
          end: pointAfterSceneDrag((before as FBDMember).end, drag.original, drag.current),
        })
      : repositionFBDLabel(fbdState, drag.kind, drag.id, at);
    const after = getFBDElement(next, drag.kind, drag.id)!;
    setFbdState(next);
    setSelectedForceId(drag.kind === 'force' ? drag.id : null);
    setSelectedMomentId(drag.kind === 'moment' ? drag.id : null);
    setSelectedDimensionId(drag.kind === 'dimension' ? drag.id : null);
    setSelectedAngleId(drag.kind === 'angle' ? drag.id : null);
    setSelectedLabelId(drag.kind === 'label' ? drag.id : null);
    if (drag.target === 'body' || drag.target === 'member') setSelectedPrimitive({ kind: drag.target, id: drag.id });
    suppressClickRef.current = true;
    setTimeout(() => { suppressClickRef.current = false; }, 0);
    if (drag.target === 'body' || drag.target === 'member') {
      onVisualizationInteraction(`fbd_${drag.target}_move`, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, { before: fbdState, after: next }, { kind: drag.target, id: drag.id });
    } else {
      onVisualizationInteraction('fbd_element_drag', undefined, undefined, undefined, undefined,
        undefined, undefined, { elementKind: drag.kind, elementId: drag.id, before, after,
          dragTarget: drag.target }, { before: fbdState, after: next });
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
    const visibleFbdState = showFbd ? fbdStateForMemberCanvas(fbdState, activeMemberId) : fbdState;
    const model = buildFBDModel(workspace, visibleFbdState, selectedForceId, selectedMomentId,
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
  }, [ready, workspace, showFbd, fbdState, activeMemberId, selectedForceId, selectedMomentId, selectedDimensionId, selectedAngleId, selectedLabelId, givenVisibility, selectedPrimitive]);

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
        ...(activeMemberId ? { canvasMemberId: activeMemberId } : {}),
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
        ...(activeMemberId ? { canvasMemberId: activeMemberId } : {}),
        label: momentDraft.label, clockwise: momentDraft.clockwise === 'clockwise',
        role: momentDraft.role === 'reaction' ? 'reaction' as const : 'applied' as const,
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
        ...(activeMemberId ? { canvasMemberId: activeMemberId } : {}),
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
        ...(activeMemberId ? { canvasMemberId: activeMemberId } : {}),
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
        ...(activeMemberId ? { canvasMemberId: activeMemberId } : {}),
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
        role: value('role') === 'reaction' ? 'reaction' : 'applied',
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
      if (primitiveMode === 'member') setActiveFbdMemberId(id);
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
              No member has been added yet.
            </div>}
        </div>}
        <div ref={containerRef} className={`relative min-h-0 bg-slate-50 touch-none ${displayMode === 'split' ? 'flex-1' : 'h-full'}`} aria-label={showFbd ? 'FBD canvas' : 'Structure canvas'}>
        {displayMode === 'split' && <span className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-white/90 px-2 py-1 text-xs font-semibold text-slate-700">FBD</span>}
        {error && <div className="absolute inset-0 z-10 flex items-center justify-center p-4 text-sm text-slate-600">{error}</div>}
        {!(showFbd ? hasStudentFBDElements(fbdState) : hasStudentFBDBaseGeometry(fbdState)) && !error &&
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4 text-center text-sm text-slate-500">
            {showFbd ? 'No diagram yet. Start building your free-body diagram.' :
              'No member has been added yet.'}
          </div>}
        </div>
      </div>
      {showFbd && <div className="max-h-[45%] min-h-0 shrink-0 overflow-y-auto border-t border-slate-200 px-3 py-2" aria-label="FBD construction toolbar">
        <p className="mb-2 text-xs text-slate-600">Build the diagram yourself. Nothing is copied from the engineering problem into this canvas.</p>
        <div className="mb-2 flex flex-wrap gap-1.5" aria-label="FBD base geometry tools">
          <button type="button" onClick={() => openPrimitiveForm('member')}
            className="rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-900">Add Member</button>
          <button type="button" onClick={() => selectedPrimitive?.kind === 'member' && openPrimitiveForm('member', true)}
            disabled={!selectedPrimitiveElement || selectedPrimitive?.kind !== 'member'}
            className="rounded bg-slate-100 px-2 py-1 text-xs disabled:text-slate-400">Edit Member</button>
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs"
          aria-label="Member canvas selector">
          <strong>Member canvas</strong>
          <label className="sr-only">Select member canvas<select aria-label="Select student-created member canvas"
            value={selectedPrimitive ? `${selectedPrimitive.kind}:${selectedPrimitive.id}` : ''}
            onChange={(event) => { const [kind, ...parts] = event.target.value.split(':');
              const id = parts.join(':');
              setSelectedPrimitive(kind ? { kind: kind as FBDPrimitiveKind, id } : null);
              setActiveFbdMemberId(kind === 'member' ? id : null);
              setSelectedForceId(null); setSelectedMomentId(null); setSelectedDimensionId(null);
              setSelectedAngleId(null); setSelectedLabelId(null); }}
            className="ml-1 max-w-48 rounded border border-slate-300 bg-white px-2 py-1">
            <option value="">Choose element</option>
            {fbdState.members.map((item) => <option key={`member:${item.id}`} value={`member:${item.id}`}>Member · {item.label || item.id}</option>)}
          </select></label>
          {fbdState.members.map((item, index) => <button key={item.id} type="button"
            aria-pressed={activeMemberId === item.id}
            onClick={() => { setSelectedPrimitive({ kind: 'member', id: item.id });
              setActiveFbdMemberId(item.id);
              setSelectedForceId(null); setSelectedMomentId(null); setSelectedDimensionId(null);
              setSelectedAngleId(null); setSelectedLabelId(null); }}
            className={`rounded px-2 py-1 ${activeMemberId === item.id
              ? 'bg-emerald-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300'}`}>
            Canvas {index + 1}: {item.label || item.id}
          </button>)}
          {!fbdState.members.length && <span className="text-slate-500">Add a member to create its canvas.</span>}
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
            <label key={key}>{key === 'startJointKind' ? 'Start joint in Rigid Body View' : 'End joint in Rigid Body View'}
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
          {selectedPrimitive?.kind === 'member' && <span className="text-slate-600">Drag the member directly or use ΔX and ΔY.</span>}
          <label>ΔX<input type="number" step="any" required value={moveDraft.dx}
            onChange={(event) => setMoveDraft({ ...moveDraft, dx: event.target.value })}
            className="ml-1 w-20 rounded border px-2 py-1" /></label>
          <label>ΔY<input type="number" step="any" required value={moveDraft.dy}
            onChange={(event) => setMoveDraft({ ...moveDraft, dy: event.target.value })}
            className="ml-1 w-20 rounded border px-2 py-1" /></label>
          <button type="submit" className="rounded bg-blue-600 px-2 py-1 text-white">Move Selected</button>
        </form>}
        <div className="flex flex-wrap items-center gap-1.5">
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
              <div className="col-span-2 rounded bg-slate-100 px-2 py-1 text-slate-700">
                Drag a force arrow to move its application point. You can also edit Point X and Point Y above.
              </div></>;
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
              <label>Moment type<select name="role" defaultValue={item.role || 'applied'}
                className="block w-full rounded border border-slate-300 bg-white px-2 py-1">
                <option value="applied">External applied moment</option><option value="reaction">Support reaction moment</option>
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
          <label>Moment type<select value={momentDraft.role}
            onChange={(event) => setMomentDraft({ ...momentDraft, role: event.target.value })}
            className="block w-full rounded border border-slate-300 bg-white px-2 py-1">
            <option value="applied">External applied moment</option><option value="reaction">Support reaction moment</option>
          </select></label>
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
