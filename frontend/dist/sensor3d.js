import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';

const LED_COLORS = {
  green: 0x50d8a2,
  yellow: 0xf1c96b,
  red: 0xee6c72,
  off: 0x17212a,
  unknown: 0x77828c,
};

const LED_MEANINGS = {
  state: {
    green: 'Objekt im Messbereich',
    yellow: 'Objekt in der Messbereichsmitte',
    red: 'Messfehler oder Objekt außerhalb des Messbereichs',
    off: 'Laser ausgeschaltet',
    unknown: 'Status nicht verfügbar',
  },
  output: {
    green: 'Digitale Messwertausgabe über RS422',
    yellow: 'Messwertausgänge deaktiviert',
    red: 'Analoge Messwertausgabe über 4–20 mA',
    off: 'Sensor ohne Versorgung',
    unknown: 'Status nicht verfügbar',
  },
};

function normalizedStatus(value) {
  return Object.hasOwn(LED_COLORS, value) ? value : 'unknown';
}

function makeFallback(container, onSelect, initialState) {
  const wrapper = document.createElement('div');
  wrapper.className = 'sensor3d-fallback';
  wrapper.style.cssText = 'min-height:200px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:20px;color:inherit;font:inherit;text-align:center';
  const title = document.createElement('div');
  title.textContent = 'optoNCDT 1420';
  title.style.cssText = 'font-size:18px;font-weight:600';
  const explanation = document.createElement('p');
  explanation.textContent = 'Die 3D-Ansicht ist in diesem Browser nicht verfügbar. Die LED-Erklärungen bleiben bedienbar.';
  explanation.style.cssText = 'font-size:12px;line-height:1.6;opacity:.7;max-width:280px;margin:0';
  const buttons = {};
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:12px';
  for (const name of ['state', 'output']) {
    const button = document.createElement('button');
    button.type = 'button';
    button.style.cssText = 'border:1px solid #65727b66;border-radius:7px;padding:9px 13px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer';
    button.onclick = () => onSelect?.(name);
    buttons[name] = button;
    row.append(button);
  }
  wrapper.append(title, explanation, row);
  container.append(wrapper);
  const setStatus = (status = {}) => {
    for (const name of ['state', 'output']) {
      const value = normalizedStatus(status[name]);
      buttons[name].textContent = `${name === 'state' ? 'State' : 'Output'}-LED`;
      buttons[name].title = LED_MEANINGS[name][value];
      buttons[name].setAttribute('aria-label', `${buttons[name].textContent}: ${LED_MEANINGS[name][value]}`);
      buttons[name].style.boxShadow = `inset 3px 0 #${LED_COLORS[value].toString(16).padStart(6, '0')}`;
    }
  };
  setStatus(initialState);
  return { setStatus, reset() {}, dispose() { wrapper.remove(); } };
}

/**
 * Interactive schematic of the optoNCDT 1420. This is intentionally not a
 * manufacturer CAD model. Hardware LED meaning is independent of tolerance.
 */
export function createSensorViewer(container, { onSelect, initialState = {} } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return makeFallback(container, onSelect, initialState);
  }

  let disposed = false;
  const previousPosition = container.style.position;
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline-offset:-4px';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Schematisches 3D-Modell des optoNCDT 1420. Zum Drehen ziehen oder Pfeiltasten verwenden. Plus und Minus zum Zoomen, Pos1 für die Ausgangsansicht.');
  container.append(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  const initialCamera = new THREE.Vector3(4.1, 2.7, 6.4);
  camera.position.copy(initialCamera);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.15, 0);
  controls.enableDamping = false;
  controls.enablePan = false;
  controls.minDistance = 3.8;
  controls.maxDistance = 12;
  controls.minPolarAngle = Math.PI * 0.16;
  controls.maxPolarAngle = Math.PI * 0.84;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.7;
  controls.update();
  controls.saveState();

  scene.add(new THREE.HemisphereLight(0xe4f2ff, 0x252d37, 2.3));
  const keyLight = new THREE.DirectionalLight(0xffffff, 4);
  keyLight.position.set(3, 6, 5);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xc8e4f1, 2.1);
  fillLight.position.set(-5, 1, 3);
  scene.add(fillLight);
  const rimLight = new THREE.DirectionalLight(0xffffff, 2);
  rimLight.position.set(1, 3, -4);
  scene.add(rimLight);

  const sensor = new THREE.Group();
  sensor.rotation.y = -0.12;
  scene.add(sensor);

  const textures = [];
  const metal = new THREE.MeshStandardMaterial({ color: 0x929b9f, metalness: 0.62, roughness: 0.38 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x38434c, metalness: 0.65, roughness: 0.35 });
  const black = new THREE.MeshStandardMaterial({ color: 0x121a22, metalness: 0.18, roughness: 0.58 });
  const screwMetal = new THREE.MeshStandardMaterial({ color: 0xc1cad0, metalness: 0.8, roughness: 0.3 });
  const lens = new THREE.MeshStandardMaterial({ color: 0x0f2539, metalness: 0.7, roughness: 0.15 });

  const addMesh = (geometry, material, position, parent = sensor) => {
    const mesh = new THREE.Mesh(geometry, material);
    if (position) mesh.position.set(...position);
    parent.add(mesh);
    return mesh;
  };

  const bodyShape = new THREE.Shape();
  const w = 1.65, h = 2.08, r = 0.075;
  bodyShape.moveTo(-w / 2 + r, -h / 2);
  bodyShape.lineTo(w / 2 - r, -h / 2);
  bodyShape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  bodyShape.lineTo(w / 2, h / 2 - r);
  bodyShape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  bodyShape.lineTo(-w / 2 + r, h / 2);
  bodyShape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  bodyShape.lineTo(-w / 2, -h / 2 + r);
  bodyShape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const bodyGeometry = new THREE.ExtrudeGeometry(bodyShape, { depth: 0.8, bevelEnabled: true, bevelThickness: 0.045, bevelSize: 0.045, bevelSegments: 3, curveSegments: 6 });
  bodyGeometry.translate(0, 0, -0.4);
  addMesh(bodyGeometry, metal);

  // A dark optical face, separate emitter and receiver, and two mounting points.
  addMesh(new THREE.BoxGeometry(1.21, 0.97, 0.052), black, [0, -0.32, 0.467]);
  addMesh(new THREE.BoxGeometry(0.4, 0.36, 0.024), darkMetal, [0.27, -0.38, 0.506]);
  addMesh(new THREE.BoxGeometry(0.30, 0.25, 0.028), lens, [0.27, -0.38, 0.525]);
  const glassGlint = new THREE.MeshBasicMaterial({ color: 0xa5baca, transparent: true, opacity: 0.22 });
  const glint = addMesh(new THREE.PlaneGeometry(0.23, 0.025), glassGlint, [0.27, -0.32, 0.542]);
  glint.rotation.z = -0.42;

  const emitterHousing = addMesh(new THREE.CylinderGeometry(0.125, 0.125, 0.04, 32), darkMetal, [-0.27, -0.4, 0.51]);
  emitterHousing.rotation.x = Math.PI / 2;
  const laserMaterial = new THREE.MeshStandardMaterial({ color: 0x8a2333, emissive: 0xc62941, emissiveIntensity: 0.3, roughness: 0.25, metalness: 0.1 });
  const laser = addMesh(new THREE.CylinderGeometry(0.065, 0.065, 0.045, 24), laserMaterial, [-0.27, -0.4, 0.54]);
  laser.rotation.x = Math.PI / 2;

  for (const [x, y] of [[-0.64, 0.83], [0.64, -0.83]]) {
    const ring = addMesh(new THREE.CylinderGeometry(0.087, 0.087, 0.025, 24), screwMetal, [x, y, 0.464]);
    ring.rotation.x = Math.PI / 2;
    const hole = addMesh(new THREE.CylinderGeometry(0.047, 0.047, 0.035, 6), black, [x, y, 0.48]);
    hole.rotation.x = Math.PI / 2;
  }

  // Cable and connector are schematic; neither is reported as a connected adapter.
  addMesh(new THREE.CylinderGeometry(0.155, 0.155, 0.26, 24), darkMetal, [0.32, 1.16, -0.04]);
  addMesh(new THREE.CylinderGeometry(0.125, 0.125, 0.15, 24), screwMetal, [0.32, 1.36, -0.04]);
  for (let i = 0; i < 4; i++) {
    const ring = addMesh(new THREE.TorusGeometry(0.14, 0.012, 8, 24), screwMetal, [0.32, 1.08 + i * 0.055, -0.04]);
    ring.rotation.x = Math.PI / 2;
  }
  const cablePath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.32, 1.43, -0.04),
    new THREE.Vector3(0.34, 1.72, -0.08),
    new THREE.Vector3(0.68, 1.91, -0.17),
    new THREE.Vector3(1.12, 1.91, -0.38),
  ]);
  addMesh(new THREE.TubeGeometry(cablePath, 30, 0.065, 12, false), black);

  function addLabel(text, width, height, position, { color = '#222c35', background = null, fontSize = 35, weight = 500 } = {}) {
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 768;
    labelCanvas.height = Math.max(96, Math.round(768 * height / width));
    const ctx = labelCanvas.getContext('2d');
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, labelCanvas.width, labelCanvas.height); }
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${weight} ${fontSize}px Arial, sans-serif`;
    ctx.fillText(text, labelCanvas.width / 2, labelCanvas.height / 2);
    const texture = new THREE.CanvasTexture(labelCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    textures.push(texture);
    return addMesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.FrontSide }), position);
  }

  addLabel('MICRO-EPSILON', 1.0, 0.17, [0.04, 0.81, 0.467], { color: '#d62037', fontSize: 86, weight: 700 });
  addLabel('optoNCDT 1420', 0.96, 0.15, [0.0, 0.61, 0.468], { fontSize: 58, weight: 600 });
  addLabel('LASER DISPLACEMENT', 0.94, 0.09, [0, -0.89, 0.469], { fontSize: 38, color: '#333e48' });

  const ledMeshes = {};
  const ledButtons = {};
  const currentStatus = { state: 'unknown', output: 'unknown' };
  for (const [index, name] of ['state', 'output'].entries()) {
    const x = index === 0 ? -0.27 : 0.27;
    const bezel = addMesh(new THREE.CylinderGeometry(0.079, 0.079, 0.025, 24), darkMetal, [x, 0.30, 0.474]);
    bezel.rotation.x = Math.PI / 2;
    const ledMaterial = new THREE.MeshStandardMaterial({ color: LED_COLORS.unknown, emissive: LED_COLORS.unknown, emissiveIntensity: 0.2, roughness: 0.22, metalness: 0 });
    const mesh = addMesh(new THREE.SphereGeometry(0.057, 20, 12), ledMaterial, [x, 0.30, 0.496]);
    mesh.scale.z = 0.45;
    mesh.userData.ledName = name;
    ledMeshes[name] = mesh;
    addLabel(name === 'state' ? 'STATE' : 'OUTPUT', 0.36, 0.09, [x, 0.13, 0.47], { fontSize: 57, weight: 500 });

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sensor3d-led-hotspot';
    button.style.cssText = 'position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border:1px solid transparent;border-radius:50%;background:transparent;cursor:pointer;padding:0;z-index:1';
    button.addEventListener('focus', () => { button.style.borderColor = '#7df4ff'; });
    button.addEventListener('blur', () => { button.style.borderColor = 'transparent'; });
    button.addEventListener('click', event => { event.stopPropagation(); onSelect?.(name); });
    ledButtons[name] = button;
    container.append(button);
  }

  const position = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  function render() {
    if (disposed) return;
    renderer.render(scene, camera);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    for (const name of ['state', 'output']) {
      ledMeshes[name].getWorldPosition(position);
      sensor.getWorldQuaternion(quaternion);
      normal.set(0, 0, 1).applyQuaternion(quaternion);
      direction.copy(camera.position).sub(position);
      const frontVisible = normal.dot(direction) > 0;
      position.project(camera);
      const button = ledButtons[name];
      button.style.left = `${(position.x * 0.5 + 0.5) * width}px`;
      button.style.top = `${(-position.y * 0.5 + 0.5) * height}px`;
      button.style.visibility = frontVisible && position.z < 1 ? 'visible' : 'hidden';
    }
  }

  const setStatus = (status = {}) => {
    for (const name of ['state', 'output']) {
      if (status[name] !== undefined) currentStatus[name] = normalizedStatus(status[name]);
      const value = currentStatus[name];
      const material = ledMeshes[name].material;
      material.color.setHex(LED_COLORS[value]);
      material.emissive.setHex(LED_COLORS[value]);
      material.emissiveIntensity = value === 'off' || value === 'unknown' ? 0.04 : 0.65;
      const title = `${name === 'state' ? 'State' : 'Output'}-LED: ${LED_MEANINGS[name][value]}`;
      ledButtons[name].title = title;
      ledButtons[name].setAttribute('aria-label', title);
    }
    const laserActive = !['off', 'unknown'].includes(currentStatus.state);
    laserMaterial.emissiveIntensity = laserActive ? 0.6 : 0;
    laserMaterial.color.setHex(laserActive ? 0x8a2333 : 0x202832);
    render();
  };

  const resize = () => {
    if (disposed) return;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight || 260);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  controls.addEventListener('change', render);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerDown = null;
  const onPointerDown = event => { pointerDown = { x: event.clientX, y: event.clientY }; };
  const onPointerUp = event => {
    if (!pointerDown || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) return;
    pointerDown = null;
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(sensor, true)[0];
    if (hit?.object.userData.ledName) onSelect?.(hit.object.userData.ledName);
  };
  const onKeyDown = event => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const offset = camera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      if (event.key === 'ArrowLeft') spherical.theta -= 0.15;
      if (event.key === 'ArrowRight') spherical.theta += 0.15;
      if (event.key === 'ArrowUp') spherical.phi = Math.max(controls.minPolarAngle, spherical.phi - 0.12);
      if (event.key === 'ArrowDown') spherical.phi = Math.min(controls.maxPolarAngle, spherical.phi + 0.12);
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
      controls.update();
      render();
    } else if (event.key === '+' || event.key === '=' || event.key === '-') {
      event.preventDefault();
      const offset = camera.position.clone().sub(controls.target);
      const nextLength = THREE.MathUtils.clamp(offset.length() * (event.key === '-' ? 1.15 : 0.87), controls.minDistance, controls.maxDistance);
      camera.position.copy(controls.target).add(offset.setLength(nextLength));
      controls.update();
      render();
    } else if (event.key === 'Home') {
      event.preventDefault();
      controls.reset();
      render();
    }
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('keydown', onKeyDown);
  resize();
  setStatus(initialState);

  return {
    setStatus,
    reset() { controls.reset(); render(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      resizeObserver.disconnect();
      controls.removeEventListener('change', render);
      controls.dispose();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('keydown', onKeyDown);
      const geometries = new Set();
      const materials = new Set();
      scene.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of objectMaterials) if (material) materials.add(material);
      });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      renderer.dispose();
      canvas.remove();
      for (const button of Object.values(ledButtons)) button.remove();
      container.style.position = previousPosition;
    },
  };
}
