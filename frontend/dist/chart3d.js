import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function createPlot3D(container) {
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.replaceChildren(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(5.7, 4.1, 7.3);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 6;
    controls.maxDistance = 15;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0xffdfcb, 0x17191f, 2.1));
    const key = new THREE.DirectionalLight(0xff6b35, 2.7);
    key.position.set(-2, 5, 5);
    scene.add(key);

    const grid = new THREE.Group();
    const gridMaterial = new THREE.LineBasicMaterial({ color: 0x45404a, transparent: true, opacity: 0.7 });
    const softGridMaterial = new THREE.LineBasicMaterial({ color: 0x302d35, transparent: true, opacity: 0.55 });
    const axisMaterial = new THREE.LineBasicMaterial({ color: 0xff752e, transparent: true, opacity: 0.95 });
    const addLine = (a, b, material, target = grid) => {
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
      target.add(new THREE.Line(geometry, material));
    };
    const left = -3.1, right = 3.1, bottom = -1.65, top = 1.65, back = -1.65;
    for (let i = 0; i <= 8; i++) {
      const x = left + (right - left) * i / 8;
      addLine([x, bottom, back], [x, top, back], i === 0 || i === 8 ? gridMaterial : softGridMaterial);
      addLine([x, bottom, back], [x, bottom, 1.55], softGridMaterial);
      const y = bottom + (top - bottom) * i / 8;
      addLine([left, y, back], [right, y, back], i === 0 || i === 8 ? gridMaterial : softGridMaterial);
    }
    addLine([left, bottom, back], [right, bottom, back], axisMaterial);
    addLine([left, bottom, back], [left, top, back], axisMaterial);
    scene.add(grid);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(right - left, 3.2),
      new THREE.MeshStandardMaterial({ color: 0x17191f, roughness: 0.72, metalness: 0.12, transparent: true, opacity: 0.72, side: THREE.DoubleSide }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, bottom - 0.015, -0.05);
    scene.add(floor);

    const plot = new THREE.Group();
    scene.add(plot);
    const resize = new ResizeObserver(() => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resize.observe(container);
    controls.addEventListener('change', () => renderer.render(scene, camera));

    let active = true;
    const renderFrame = () => {
      if (!active) return;
      controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(renderFrame);
    };
    renderFrame();

    const update = ({ points, profile, start, end, style = 'line' }) => {
      for (const child of [...plot.children]) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) child.material.forEach(material => material.dispose());
        else child.material?.dispose();
        plot.remove(child);
      }
      const data = points.filter(point => point.t >= start && point.t <= end && Number.isFinite(point.value));
      if (data.length < 2) return;
      const values = [...data.map(point => point.value), profile.lower, profile.upper, profile.target];
      let low = Math.min(...values), high = Math.max(...values);
      const padding = Math.max((high - low) * 0.22, 0.012);
      low -= padding;
      high += padding;
      const mapX = t => left + clamp((t - start) / Math.max(0.001, end - start), 0, 1) * (right - left);
      const mapY = value => bottom + clamp((value - low) / (high - low), 0, 1) * (top - bottom);
      const stride = Math.max(1, Math.ceil(data.length / 360));
      const sample = data.filter((_, index) => index % stride === 0 || index === data.length - 1);
      const mapZ = point => -1.45 + clamp((Number.isFinite(point.intensity) ? point.intensity : 50) / 100, 0, 1) * 2.9;
      const curvePoints = sample.map(point => new THREE.Vector3(mapX(point.t), mapY(point.value), mapZ(point)));

      const specMaterial = new THREE.MeshBasicMaterial({ color: 0xff8a32, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false });
      const specBand = new THREE.Mesh(new THREE.BoxGeometry(right - left, Math.max(0.025, mapY(profile.upper) - mapY(profile.lower)), 3.1), specMaterial);
      specBand.position.set(0, (mapY(profile.upper) + mapY(profile.lower)) / 2, -0.05);
      plot.add(specBand);

      if (style === 'area') {
        const vertices = [];
        for (let index = 0; index < curvePoints.length - 1; index++) {
          const a = curvePoints[index], b = curvePoints[index + 1];
          vertices.push(a.x, a.y, a.z, a.x, bottom, a.z, b.x, b.y, b.z);
          vertices.push(a.x, bottom, a.z, b.x, bottom, b.z, b.x, b.y, b.z);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.computeVertexNormals();
        const material = new THREE.MeshStandardMaterial({ color: 0xff5b35, emissive: 0x681d12, emissiveIntensity: 0.8, transparent: true, opacity: 0.58, side: THREE.DoubleSide, roughness: 0.38, metalness: 0.12 });
        plot.add(new THREE.Mesh(geometry, material));
      }

      if (style === 'points') {
        const geometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
        const material = new THREE.PointsMaterial({ color: 0xff6339, size: 0.095, sizeAttenuation: true, transparent: true, opacity: 0.96 });
        plot.add(new THREE.Points(geometry, material));
      } else {
        const curve = new THREE.CatmullRomCurve3(curvePoints, false, 'centripetal');
        const geometry = new THREE.TubeGeometry(curve, Math.max(40, curvePoints.length * 2), 0.025, 7, false);
        const material = new THREE.MeshStandardMaterial({ color: 0xff4936, emissive: 0x8c180d, emissiveIntensity: 0.72, roughness: 0.32, metalness: 0.1 });
        plot.add(new THREE.Mesh(geometry, material));
        const glow = new THREE.Mesh(
          new THREE.TubeGeometry(curve, Math.max(40, curvePoints.length * 2), 0.052, 7, false),
          new THREE.MeshBasicMaterial({ color: 0xff762d, transparent: true, opacity: 0.16 }),
        );
        plot.add(glow);
      }
      renderer.render(scene, camera);
    };

    return {
      update,
      dispose() {
        active = false;
        resize.disconnect();
        controls.dispose();
        for (const child of [...plot.children, ...grid.children, floor]) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) child.material.forEach(material => material.dispose());
          else child.material?.dispose();
        }
        gridMaterial.dispose();
        softGridMaterial.dispose();
        axisMaterial.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      },
    };
  } catch {
    container.innerHTML = '<div class="plot3d-fallback">La vue 3D nécessite WebGL. Active WebGL dans les réglages de Safari ou utilise la courbe de secours.</div>';
    return null;
  }
}
