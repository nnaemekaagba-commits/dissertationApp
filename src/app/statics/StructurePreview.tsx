import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { StaticsWorkspace } from './model';
import type { FBDState } from './fbdState';
import { DEFAULT_GIVEN_VISIBILITY } from './fbdGiven';
import { buildFBDModel, disposeGroup } from './fbdCanvasScene';

export function StructurePreview({ workspace, fbdState }: {
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

