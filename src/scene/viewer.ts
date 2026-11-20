/**
 * Basis 3D-viewer: renderer, camera's, navigatie (MapControls) en licht.
 *
 * Twee weergaven:
 *  - 3D: perspectiefcamera, vrij draaien en kantelen;
 *  - 2D: orthografische camera recht van boven (geen perspectief), zodat daken
 *    exact boven hun footprint liggen en maten overal gelijk zijn. Alleen
 *    verschuiven, zoomen en draaien om de verticale as.
 */
import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { LocalFrame } from '../core/coords';

export type ViewMode = '3d' | '2d';

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly perspCam: THREE.PerspectiveCamera;
  readonly orthoCam: THREE.OrthographicCamera;
  readonly controls3d: MapControls;
  readonly controls2d: MapControls;
  mode: ViewMode = '3d';
  private animTarget: { pos: THREE.Vector3; target: THREE.Vector3; t0: number; from: [THREE.Vector3, THREE.Vector3] } | null = null;
  private frameHooks: (() => void)[] = [];
  private modeHooks: ((m: ViewMode) => void)[] = [];
  /** Halve hoogte van het 2D-beeld (m) bij zoom 1. */
  private orthoHalf = 100;

  constructor(public readonly container: HTMLElement, public readonly frame: LocalFrame) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#dfe7ee');
    const aspect = container.clientWidth / container.clientHeight;
    this.perspCam = new THREE.PerspectiveCamera(45, aspect, 0.5, 6000);
    this.perspCam.position.set(-120, 160, 180);
    this.orthoCam = new THREE.OrthographicCamera(-100 * aspect, 100 * aspect, 100, -100, 1, 5000);

    const mk = (cam: THREE.Camera) => {
      const c = new MapControls(cam, this.renderer.domElement);
      c.enableDamping = true;
      c.dampingFactor = 0.12;
      (c as any).zoomToCursor = true;
      return c;
    };
    this.controls3d = mk(this.perspCam);
    this.controls3d.screenSpacePanning = false;
    this.controls3d.maxPolarAngle = THREE.MathUtils.degToRad(88);
    this.controls3d.minDistance = 3;
    this.controls3d.maxDistance = 1500;
    this.controls2d = mk(this.orthoCam);
    this.controls2d.screenSpacePanning = true;
    this.controls2d.minPolarAngle = 0;
    this.controls2d.maxPolarAngle = 0; // alleen draaien om de verticale as
    this.controls2d.minZoom = 0.05;
    this.controls2d.maxZoom = 60;
    this.controls2d.enabled = false;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f80, 1.6);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-150, 300, 120); // zon uit het zuidwesten
    this.scene.add(sun);

    new ResizeObserver(() => this.resize()).observe(container);
    this.renderer.setAnimationLoop(() => this.tick());
  }

  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.mode === '2d' ? this.orthoCam : this.perspCam;
  }

  get controls(): MapControls {
    return this.mode === '2d' ? this.controls2d : this.controls3d;
  }

  onFrame(fn: () => void) {
    this.frameHooks.push(fn);
  }

  onModeChange(fn: (m: ViewMode) => void) {
    this.modeHooks.push(fn);
  }

  private resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.perspCam.aspect = w / h;
    this.perspCam.updateProjectionMatrix();
    this.setOrthoFrustum();
    this.renderer.setSize(w, h);
  }

  private setOrthoFrustum() {
    const a = this.container.clientWidth / Math.max(1, this.container.clientHeight);
    this.orthoCam.top = this.orthoHalf;
    this.orthoCam.bottom = -this.orthoHalf;
    this.orthoCam.left = -this.orthoHalf * a;
    this.orthoCam.right = this.orthoHalf * a;
    this.orthoCam.updateProjectionMatrix();
  }

  private tick() {
    if (this.animTarget && this.mode === '3d') {
      const an = this.animTarget;
      const t = Math.min(1, (performance.now() - an.t0) / 700);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      this.perspCam.position.lerpVectors(an.from[0], an.pos, e);
      this.controls3d.target.lerpVectors(an.from[1], an.target, e);
      if (t >= 1) this.animTarget = null;
    }
    this.controls.update();
    for (const f of this.frameHooks) f();
    this.renderer.render(this.scene, this.camera);
  }

  /** Meters per schermpixel in de 2D-weergave. */
  metersPerPixel(): number {
    return (this.orthoCam.top - this.orthoCam.bottom) / this.orthoCam.zoom / Math.max(1, this.container.clientHeight);
  }

  /** Schakel naar 2D (orthografisch, recht van boven) met hetzelfde beeldmidden en ongeveer dezelfde schaal. */
  to2D() {
    if (this.mode === '2d') return;
    const t = this.controls3d.target.clone();
    const d = this.perspCam.position.distanceTo(t);
    this.orthoHalf = Math.max(10, d * Math.tan(THREE.MathUtils.degToRad(this.perspCam.fov / 2)));
    this.setOrthoFrustum();
    this.orthoCam.zoom = 1;
    // noord boven (draaien kan daarna met rechtermuisknop)
    this.orthoCam.position.set(t.x, t.y + 1500, t.z + 0.001);
    this.controls2d.target.copy(t);
    this.orthoCam.updateProjectionMatrix();
    this.switchTo('2d');
  }

  /** Schakel naar 3D, schuin aanzicht op hetzelfde beeldmidden. */
  to3D() {
    if (this.mode === '3d') { this.obliqueView(); return; }
    const t = this.controls2d.target.clone();
    const visHalf = this.orthoHalf / this.orthoCam.zoom;
    const d = Math.min(1200, Math.max(20, visHalf / Math.tan(THREE.MathUtils.degToRad(this.perspCam.fov / 2))));
    const az = this.controls2d.getAzimuthalAngle();
    const dir = new THREE.Vector3(Math.sin(az) * 0.75, 0.65, Math.cos(az) * 0.75).normalize();
    this.controls3d.target.copy(t);
    this.perspCam.position.copy(t.clone().addScaledVector(dir, d));
    this.switchTo('3d');
  }

  private switchTo(m: ViewMode) {
    this.mode = m;
    this.controls3d.enabled = m === '3d';
    this.controls2d.enabled = m === '2d';
    this.animTarget = null;
    for (const f of this.modeHooks) f(m);
  }

  /** Vlieg (3D) of spring (2D) naar een punt, met ongeveer `radius` meter in beeld. */
  focus(target: THREE.Vector3, radius: number) {
    if (this.mode === '2d') {
      this.controls2d.target.copy(target);
      const az = this.controls2d.getAzimuthalAngle();
      this.orthoCam.position.set(target.x + Math.sin(az) * 0.001, target.y + 1500, target.z + Math.cos(az) * 0.001);
      this.orthoCam.zoom = this.orthoHalf / radius;
      this.orthoCam.updateProjectionMatrix();
      return;
    }
    const d = radius / Math.tan(THREE.MathUtils.degToRad(this.perspCam.fov / 2)) * 1.1;
    const dir = new THREE.Vector3(-0.45, 0.65, 0.6).normalize();
    this.flyTo(target.clone().addScaledVector(dir, d), target);
  }

  /** Vlieg de 3D-camera naar een nieuwe positie/doel. */
  flyTo(pos: THREE.Vector3, target: THREE.Vector3) {
    this.animTarget = { pos, target, t0: performance.now(), from: [this.perspCam.position.clone(), this.controls3d.target.clone()] };
  }

  /** Schuin 3D-aanzicht (vanuit het zuidwesten) op het huidige doel. */
  obliqueView() {
    const t = this.controls3d.target.clone();
    const d = Math.max(60, this.perspCam.position.distanceTo(t));
    const dir = new THREE.Vector3(-0.45, 0.65, 0.6).normalize();
    this.flyTo(t.clone().addScaledVector(dir, d), t);
  }

  /** Noord boven, met behoud van hoek, afstand en schaal. */
  northUp() {
    if (this.mode === '2d') {
      const t = this.controls2d.target;
      this.orthoCam.position.set(t.x, t.y + 1500, t.z + 0.001);
      return;
    }
    const t = this.controls3d.target.clone();
    const off = this.perspCam.position.clone().sub(t);
    const horiz = Math.hypot(off.x, off.z);
    this.flyTo(new THREE.Vector3(t.x, t.y + off.y, t.z + Math.max(horiz, 0.01)), t);
  }

  /** Kijkrichting t.o.v. noord (radialen, 0 = noord boven). */
  azimuth(): number {
    return this.controls.getAzimuthalAngle();
  }
}
