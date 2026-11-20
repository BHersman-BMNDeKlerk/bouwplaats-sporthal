/**
 * Fase 6: de scène in hoge resolutie renderen (in tegels), voor PDF en PNG.
 */
import * as THREE from 'three';

/** Render een camera naar een canvas van W×H pixels, in tegels van max. `tile` px. */
export async function renderTiled(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.OrthographicCamera | THREE.PerspectiveCamera, W: number, H: number, tile = 2048, onProgress?: (f: number) => void): Promise<HTMLCanvasElement> {
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d')!;
  const max = Math.min(tile, renderer.capabilities.maxTextureSize);
  const nx = Math.ceil(W / max), ny = Math.ceil(H / max);
  const prevTarget = renderer.getRenderTarget();
  const prevPR = renderer.getPixelRatio();
  let n = 0;
  for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) {
    const x = tx * max, y = ty * max, w = Math.min(max, W - x), h = Math.min(max, H - y);
    const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4, colorSpace: THREE.SRGBColorSpace });
    camera.setViewOffset(W, H, x, y, w, h);
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(1);
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    const buf = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    renderer.setRenderTarget(prevTarget);
    rt.dispose();
    const img = ctx.createImageData(w, h);
    for (let r = 0; r < h; r++) img.data.set(buf.subarray((h - 1 - r) * w * 4, (h - r) * w * 4), r * w * 4);
    ctx.putImageData(img, x, y);
    onProgress?.(++n / (nx * ny));
    await new Promise((res) => setTimeout(res, 0));
  }
  camera.clearViewOffset();
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(prevPR);
  return out;
}

/** Orthografische camera recht van boven, noord boven, over een gebied van w×h m rond (cx, cz) lokaal. */
export function topCamera(cx: number, cz: number, w: number, h: number, top = 2000): THREE.OrthographicCamera {
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 1, top + 1000);
  cam.up.set(0, 0, -1);
  cam.position.set(cx, top, cz);
  cam.lookAt(cx, 0, cz);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}
