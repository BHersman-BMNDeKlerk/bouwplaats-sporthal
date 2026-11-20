/** Basis 3D-viewer: renderer, camera, navigatie (MapControls) en licht. */
import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { LocalFrame } from '../core/coords';

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: MapControls;
  private animTarget: { pos: THREE.Vector3; target: THREE.Vector3; t0: number; from: [THREE.Vector3, THREE.Vector3] } | null = null;
  private frameHooks: (() => void)[] = [];

  constructor(public readonly container: HTMLElement, public readonly frame: LocalFrame) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#dfe7ee');
    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.5, 6000);
    this.camera.position.set(-120, 160, 180);

    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = false;
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(88);
    this.controls.minDistance = 3;
    this.controls.maxDistance = 1500;
    (this.controls as any).zoomToCursor = true;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f80, 1.6);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-150, 300, 120); // zon uit het zuidwesten
    this.scene.add(sun);

    new ResizeObserver(() => this.resize()).observe(container);
    this.renderer.setAnimationLoop(() => this.tick());
  }

  onFrame(fn: () => void) {
    this.frameHooks.push(fn);
  }

  private resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private tick() {
    if (this.animTarget) {
      const a = this.animTarget;
      const t = Math.min(1, (performance.now() - a.t0) / 700);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      this.camera.position.lerpVectors(a.from[0], a.pos, e);
      this.controls.target.lerpVectors(a.from[1], a.target, e);
      if (t >= 1) this.animTarget = null;
    }
    this.controls.update();
    for (const f of this.frameHooks) f();
    this.renderer.render(this.scene, this.camera);
  }

  /** Vlieg de camera naar een nieuwe positie/doel. */
  flyTo(pos: THREE.Vector3, target: THREE.Vector3) {
    this.animTarget = { pos, target, t0: performance.now(), from: [this.camera.position.clone(), this.controls.target.clone()] };
  }

  /** Bovenaanzicht boven het huidige doel, noord boven. */
  topView() {
    const t = this.controls.target.clone();
    const d = Math.max(60, this.camera.position.distanceTo(t));
    this.flyTo(new THREE.Vector3(t.x, t.y + d, t.z + 0.01), t);
  }

  /** Schuin aanzicht (vanuit het zuidwesten) op het huidige doel. */
  obliqueView() {
    const t = this.controls.target.clone();
    const d = Math.max(60, this.camera.position.distanceTo(t));
    const dir = new THREE.Vector3(-0.45, 0.65, 0.6).normalize();
    this.flyTo(t.clone().addScaledVector(dir, d), t);
  }

  /** Draai de camera zodat noord boven is, met behoud van hoek en afstand. */
  northUp() {
    const t = this.controls.target.clone();
    const off = this.camera.position.clone().sub(t);
    const horiz = Math.hypot(off.x, off.z);
    this.flyTo(new THREE.Vector3(t.x, t.y + off.y, t.z + Math.max(horiz, 0.01)), t);
  }

  /** Kijkrichting van de camera t.o.v. noord (radialen, 0 = noord boven). */
  azimuth(): number {
    return this.controls.getAzimuthalAngle();
  }
}
