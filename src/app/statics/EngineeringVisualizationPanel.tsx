import { useEffect, useRef, useState } from 'react';
import { Box, RotateCcw, X } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { useStaticsWorkspace } from './StaticsWorkspaceProvider';
import type { StaticsWorkspace } from './model';

const TEST_BEAM: StaticsWorkspace = {
  nodes: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 4, y: 0 }],
  members: [{ id: 'AB', startNodeId: 'A', endNodeId: 'B', label: 'Test beam' }],
  supports: [], loads: [], dimensions: [], units: { length: 'm', force: 'kN' },
};

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

function buildModel(workspace: StaticsWorkspace) {
  const group = new THREE.Group();
  const nodes = new Map(workspace.nodes.map((node) => [node.id, node]));
  const points = workspace.nodes.map((node) => new THREE.Vector3(node.x, node.y, 0));
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

  workspace.members.forEach((member) => {
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

  workspace.nodes.forEach((node) => {
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

  workspace.supports.forEach((support) => {
    const point = at(support.nodeId);
    if (!point) return;
    const marker = new THREE.Mesh(
      support.kind === 'fixed'
        ? new THREE.BoxGeometry(radius * 4, radius * 4, radius * 2)
        : new THREE.ConeGeometry(radius * 2.5, radius * 4, 3),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b }),
    );
    marker.position.copy(point).add(new THREE.Vector3(0, -radius * 3, 0));
    group.add(marker);
  });

  const angleToRadians = (angle: number) => workspace.units.angle === 'rad' ? angle : THREE.MathUtils.degToRad(angle);
  const addForceArrow = (point: THREE.Vector3, angle: number, length: number) => {
    const radians = angleToRadians(angle);
    const direction = new THREE.Vector3(Math.cos(radians), Math.sin(radians), 0).normalize();
    const origin = point.clone().addScaledVector(direction, -length);
    group.add(new THREE.ArrowHelper(direction, origin, length, 0xef4444, length * 0.28, length * 0.18));
  };
  workspace.loads.forEach((load) => {
    if (load.kind === 'force') {
      const point = at(load.nodeId);
      if (point) addForceArrow(point, load.angle, Math.max(0.55, span * 0.26));
    } else if (load.kind === 'distributed') {
      const member = workspace.members.find((item) => item.id === load.memberId);
      const start = member && at(member.startNodeId);
      const end = member && at(member.endNodeId);
      if (!start || !end) return;
      [0.15, 0.5, 0.85].forEach((t) => {
        const point = start.clone().lerp(end, t);
        addForceArrow(point, load.angle, Math.max(0.4, span * 0.18));
      });
    } else {
      const point = at(load.nodeId);
      if (!point) return;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 2.8, radius * 0.45, 8, 32, Math.PI * 1.65),
        new THREE.MeshBasicMaterial({ color: 0xef4444 }),
      );
      ring.position.copy(point).add(new THREE.Vector3(0, 0, radius * 2));
      group.add(ring);
    }
  });

  workspace.dimensions.forEach((dimension) => {
    const start = at(dimension.startNodeId);
    const end = at(dimension.endNodeId);
    if (!start || !end) return;
    const direction = end.clone().sub(start).normalize();
    const offset = new THREE.Vector3(-direction.y, direction.x, 0).multiplyScalar(Math.max(0.28, span * 0.09));
    const from = start.clone().add(offset);
    const to = end.clone().add(offset);
    addLine(group, from, to, 0x7c3aed);
    const label = textSprite(dimension.label || `${dimension.value} ${workspace.units.length}`, '#6d28d9', 0.48);
    if (label) {
      label.position.copy(from.add(to).multiplyScalar(0.5)).add(new THREE.Vector3(0, 0, 0.05));
      group.add(label);
    }
  });

  workspace.angles?.forEach((angle) => {
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
    const label = textSprite(angle.label || `${angle.value}${workspace.units.angle === 'rad' ? ' rad' : '°'}`, '#7e22ce', 0.42);
    if (label) {
      label.position.set(vertex.x + Math.cos(start + sweep / 2) * arcRadius * 1.7,
        vertex.y + Math.sin(start + sweep / 2) * arcRadius * 1.7, 0.08);
      group.add(label);
    }
  });

  return { group, center, span };
}

export function EngineeringVisualizationPanel({ onClose }: { onClose: () => void }) {
  const { workspace } = useStaticsWorkspace();
  const isExample = workspace.nodes.length === 0 && workspace.members.length === 0;
  const visibleWorkspace = isExample ? TEST_BEAM : workspace;
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const framedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  const frameModel = (center: THREE.Vector3, span: number) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    controls.target.copy(center);
    camera.position.set(center.x + span * 0.12, center.y + span * 0.16, Math.max(7, span * 3.2));
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
      if (modelRef.current) {
        scene.remove(modelRef.current);
        disposeGroup(modelRef.current);
        modelRef.current = null;
      }
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      framedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene) return;
    if (modelRef.current) {
      scene.remove(modelRef.current);
      disposeGroup(modelRef.current);
    }
    const model = buildModel(visibleWorkspace);
    modelRef.current = model.group;
    scene.add(model.group);
    if (!framedRef.current) {
      frameModel(model.center, model.span);
      framedRef.current = true;
    }
  }, [ready, visibleWorkspace]);

  const resetView = () => {
    const model = buildModel(visibleWorkspace);
    frameModel(model.center, model.span);
    disposeGroup(model.group);
  };

  return (
    <aside className="absolute inset-0 z-20 flex flex-col border-l border-slate-200 bg-white md:relative md:inset-auto md:z-auto md:w-[min(40vw,480px)] md:flex-shrink-0" aria-label="Engineering visualization">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Box className="size-4 text-blue-600" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-900">Engineering visualization</h2>
            <p className="text-[11px] text-slate-500">{isExample ? 'Example beam · A to B' : `${workspace.nodes.length} nodes · ${workspace.members.length} members`}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={resetView} className="rounded p-1.5 text-slate-600 hover:bg-slate-100" title="Reset view" aria-label="Reset view"><RotateCcw className="size-4" /></button>
          <button type="button" onClick={onClose} className="rounded p-1.5 text-slate-600 hover:bg-slate-100" title="Close visualization" aria-label="Close visualization"><X className="size-4" /></button>
        </div>
      </div>
      <div ref={containerRef} className="relative min-h-0 flex-1 bg-slate-50 touch-none">
        {error && <div className="absolute inset-0 z-10 flex items-center justify-center p-4 text-sm text-slate-600">{error}</div>}
      </div>
      <div className="border-t border-slate-200 px-3 py-2 text-[11px] text-slate-500">
        Drag to rotate · Scroll to zoom · Right drag to pan · Length: {visibleWorkspace.units.length} · Force: {visibleWorkspace.units.force}
      </div>
    </aside>
  );
}
