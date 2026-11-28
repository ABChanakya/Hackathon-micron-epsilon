import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';

const LED_COLORS = {
  green: 0x32efaa,
  yellow: 0xffd05a,
  red: 0xff545e,
  off: 0x17212a,
  unknown: 0x77828c,
};

const LED_MEANINGS = {
  state: {
    green: 'Objekt im Messbereich',
    yellow: 'Objekt in der Messbereichsmitte',
    red: 'Kein Abstandswert, etwa außerhalb des Messbereichs oder bei schwacher Reflexion',
    off: 'Laser ausgeschaltet',
    unknown: 'Status nicht verfügbar',
  },
  output: {
    green: 'Digitale Messwertausgabe über RS422',
    yellow: 'Schaltausgänge aktiv',
    red: 'Analogausgang für Strom oder Spannung aktiv',
    off: 'Sensor ohne Versorgung',
    unknown: 'Status nicht verfügbar',
  },
};

function normalizedStatus(value) {
  return Object.hasOwn(LED_COLORS, value) ? value : 'unknown';
}

function updateLedButton(button, name, value) {
  const title = `${name === 'state' ? 'State' : 'Output'}-LED: ${LED_MEANINGS[name][value]}`;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.dataset.state = value;
  button.dataset.lit = String(value !== 'off' && value !== 'unknown');
  button.style.setProperty('--led-glow', `#${LED_COLORS[value].toString(16).padStart(6, '0')}`);
}

function makeFallback(container, onSelect, initialState) {
  const wrapper = document.createElement('div');
  wrapper.className = 'sensor3d-fallback';
  wrapper.style.cssText = 'height:100%;display:grid;align-content:center;justify-items:center;gap:12px;padding:10px;text-align:center';
  const explanation = document.createElement('p');
  explanation.textContent = '3D-Ansicht in diesem Browser nicht verfügbar.';
  explanation.style.cssText = 'font-size:14px;line-height:1.4;margin:0';
  const viewerHelp = container.querySelector('.viewer-help');
  const helpWasHidden = viewerHelp?.hidden;
  if (viewerHelp) viewerHelp.hidden = true;
  const buttons = {};
  const currentStatus = { state: 'unknown', output: 'unknown' };
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:center;gap:7px';
  for (const name of ['state', 'output']) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sensor3d-fallback-led';
    button.textContent = name === 'state' ? 'State-LED' : 'Output-LED';
    button.style.cssText = 'min-height:44px;border:1px solid var(--line);border-radius:8px;padding:6px 10px;background:var(--surface);color:inherit;font:inherit;font-size:14px;cursor:pointer';
    button.onclick = () => onSelect?.(name);
    buttons[name] = button;
    row.append(button);
  }
  wrapper.append(explanation, row);
  container.append(wrapper);
  const setStatus = (status = {}) => {
    for (const name of ['state', 'output']) {
      if (status[name] !== undefined) currentStatus[name] = normalizedStatus(status[name]);
      const value = currentStatus[name];
      updateLedButton(buttons[name], name, value);
      buttons[name].style.boxShadow = `inset 3px 0 #${LED_COLORS[value].toString(16).padStart(6, '0')}`;
    }
  };
  setStatus(initialState);
  return {
    setStatus,
    reset() {},
    dispose() {
      wrapper.remove();
      if (viewerHelp) viewerHelp.hidden = helpWasHidden;
    },
  };
}

/** Distance needed to contain projected model corners, including the laser, with an 8% gutter. */
export function fitCameraDistance(corners, aspect, verticalFov = 35) {
  const vertical = Math.tan(verticalFov * Math.PI / 360);
  const horizontal = vertical * Math.max(.05, aspect);
  return Math.max(.1, ...corners.flatMap(([x, y, z]) => [z + Math.abs(x) * 1.08 / horizontal, z + Math.abs(y) * 1.08 / vertical]));
}

/**
 * Interactive schematic based on pages 31 and 33 of the optoNCDT 1900 manual. This is intentionally not a
 * manufacturer CAD model. Hardware LED meaning is independent of tolerance.
 */
export function createSensorViewer(container, { onSelect, onActivate, initialState = {} } = {}) {
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
  canvas.setAttribute('role', onActivate ? 'button' : 'img');
  if (onActivate) canvas.setAttribute('aria-haspopup', 'dialog');
  canvas.setAttribute('aria-label', 'Schematisches 3D-Modell des optoNCDT 1900-10. Zum Drehen ziehen oder Pfeiltasten verwenden. Plus und Minus zum Zoomen, Pos1 für die Ausgangsansicht.' + (onActivate ? ' Klicken, Enter oder Leertaste öffnet das Video.' : ''));
  container.append(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  const initialCamera = new THREE.Vector3(2.6, 3.35, 5.2);
  camera.position.copy(initialCamera);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, -0.10, 0);
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

  scene.add(new THREE.HemisphereLight(0xffffff, 0x4c5965, 2.1));
  const keyLight = new THREE.DirectionalLight(0xffffff, 3.8);
  keyLight.position.set(3, 6, 5);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xe2ebf3, 2.1);
  fillLight.position.set(-5, 1, 3);
  scene.add(fillLight);
  const rimLight = new THREE.DirectionalLight(0xffffff, 2);
  rimLight.position.set(1, 3, -4);
  scene.add(rimLight);

  const sensor = new THREE.Group();
  scene.add(sensor);

  const textures = [];
  const aluminum = new THREE.MeshStandardMaterial({ color: 0xb4b6b8, metalness: 0.28, roughness: 0.4 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x35383d, metalness: 0.31, roughness: 0.42 });
  const consoleMaterial = new THREE.MeshStandardMaterial({ color: 0x202329, metalness: 0.15, roughness: 0.43 });
  const black = new THREE.MeshStandardMaterial({ color: 0x101217, roughness: 0.68 });
  const screwMetal = new THREE.MeshStandardMaterial({ color: 0x8b9196, metalness: 0.55, roughness: 0.36 });
  const redInsert = new THREE.MeshStandardMaterial({ color: 0xb9232c, metalness: 0.13, roughness: 0.39 });
  const lens = new THREE.MeshPhysicalMaterial({ color: 0x334866, metalness: 0.45, roughness: 0.18, clearcoat: 0.85 });

  const addMesh = (geometry, material, position) => {
    const mesh = new THREE.Mesh(geometry, material);
    if (position) mesh.position.set(...position);
    sensor.add(mesh);
    return mesh;
  };

  function prism(shape, depth, material) {
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 14 });
    geometry.translate(0, 0, -depth / 2);
    return addMesh(geometry, material);
  }

  function outline(points) {
    const shape = new THREE.Shape();
    shape.moveTo(...points[0]);
    for (const point of points.slice(1)) shape.lineTo(...point);
    shape.closePath();
    return shape;
  }

  // 25 mm per scene unit. ILD1900 housing 70 × 45 × 31 mm, mounting rail 32 mm deep.
  // Housing and cap share the slightly sloped seam visible in the manual's side view.
  const body = outline([
    [-1.40, -0.57], [1.40, -0.57], [1.40, 0.72], [-1.40, 0.81],
  ]);
  prism(body, 1.24, aluminum);

  const cap = new THREE.Shape();
  cap.moveTo(-1.40, 0.81);
  cap.quadraticCurveTo(-1.40, 0.90, -1.31, 0.90);
  cap.lineTo(1.31, 0.90);
  cap.quadraticCurveTo(1.40, 0.90, 1.40, 0.81);
  cap.lineTo(1.40, 0.72);
  cap.closePath();
  prism(cap, 1.24, consoleMaterial);

  const rail = outline([
    [-1.40, -0.57], [-1.40, -0.83], [-1.33, -0.90], [1.33, -0.90],
    [1.40, -0.83], [1.40, -0.57],
  ]);
  for (const x of [-1.20, 1.20]) {
    const bore = new THREE.Path();
    bore.absarc(x, -0.74, 0.069, 0, 2 * Math.PI, true);
    rail.holes.push(bore);
  }
  prism(rail, 1.28, darkMetal);

  // Raised locating pads and through-bores spaced 60 mm apart, on both faces.
  for (const x of [-1.20, 1.20]) {
    const lining = addMesh(new THREE.CylinderGeometry(0.068, 0.068, 1.299, 28, 1, true), black, [x, -0.74, 0]);
    lining.rotation.x = Math.PI / 2;
    for (const side of [-1, 1]) {
      const pad = addMesh(new THREE.RingGeometry(0.068, 0.116, 32), screwMetal, [x, -0.74, side * 0.648]);
      if (side < 0) pad.rotation.y = Math.PI;
      const counterbore = addMesh(new THREE.RingGeometry(0.069, 0.086, 32), consoleMaterial, [x, -0.74, side * 0.650]);
      if (side < 0) counterbore.rotation.y = Math.PI;
    }
  }

  // Dark gasket along each return of the side panels.
  for (const x of [-1.401, 1.401]) {
    for (const z of [-0.43, 0.43]) {
      addMesh(new THREE.BoxGeometry(0.014, 1.34, 0.021), darkMetal, [x, 0.10, z]);
    }
  }

  // Optical openings point down, with separate emitter and receiver on the underside.
  addMesh(new THREE.BoxGeometry(2.12, 0.022, 0.77), consoleMaterial, [0, -0.901, 0.01]);
  addMesh(new THREE.BoxGeometry(0.51, 0.014, 0.39), black, [-0.31, -0.915, 0.07]);
  addMesh(new THREE.BoxGeometry(0.39, 0.013, 0.29), lens, [-0.31, -0.924, 0.07]);
  const glassGlint = new THREE.MeshBasicMaterial({ color: 0x91adcc, transparent: true, opacity: 0.45 });
  addMesh(new THREE.BoxGeometry(0.29, 0.001, 0.025), glassGlint, [-0.31, -0.931, 0.14]);
  addMesh(new THREE.CylinderGeometry(0.115, 0.115, 0.032, 32), black, [0.96, -0.917, 0.085]);
  const laserMaterial = new THREE.MeshStandardMaterial({ color: 0x8a2333, emissive: 0xc62941, roughness: 0.27 });
  addMesh(new THREE.CylinderGeometry(0.059, 0.059, 0.013, 24), laserMaterial, [0.96, -0.940, 0.085]);

  // A fine schematic beam exits the actual aperture, with a subtle halo and no post-processing.
  const laserBeam = new THREE.Group();
  laserBeam.position.set(0.96, -0.949, 0.085);
  laserBeam.visible = false;
  sensor.add(laserBeam);
  const beamLength = 0.95;
  for (const [radius, opacity] of [[0.022, 0.12], [0.006, 0.95]]) {
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, beamLength, 12),
      new THREE.MeshBasicMaterial({ color: 0xff243a, transparent: true, opacity,
        depthTest: true, depthWrite: false, toneMapped: false }),
    );
    beam.position.y = -beamLength / 2;
    beam.renderOrder = radius > 0.01 ? 1 : 2;
    beam.raycast = () => {};
    laserBeam.add(beam);
  }

  // Top plate with molded red cable seat, four fasteners and a shortened cable.
  const cableX = 0.48;
  addMesh(new THREE.BoxGeometry(1.02, 0.023, 0.81), redInsert, [0.57, 0.908, 0]);
  addMesh(new THREE.CylinderGeometry(0.140, 0.174, 0.055, 28), redInsert, [cableX, 0.939, 0]);
  addMesh(new THREE.CylinderGeometry(0.083, 0.103, 0.134, 24), black, [cableX, 0.980, 0]);
  for (const x of [-1.12, 1.16]) {
    for (const z of [-0.441, 0.441]) {
      addMesh(new THREE.CylinderGeometry(0.053, 0.053, 0.014, 24), screwMetal, [x, 0.906, z]);
      addMesh(new THREE.BoxGeometry(0.055, 0.006, 0.010), black, [x, 0.914, z]);
    }
  }
  const cablePath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(cableX, 0.981, 0),
    new THREE.Vector3(cableX, 1.20, -0.01),
    new THREE.Vector3(0.61, 1.43, -0.15),
    new THREE.Vector3(0.88, 1.54, -0.34),
    new THREE.Vector3(1.26, 1.59, -0.46),
  ]);
  addMesh(new THREE.TubeGeometry(cablePath, 30, 0.067, 14, false), black);
  const cableEnd = addMesh(new THREE.CircleGeometry(0.067, 14), black, [1.26, 1.59, -0.46]);
  cableEnd.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), cablePath.getTangent(1).normalize());

  for (const x of [-0.69, -1.05]) {
    addMesh(new THREE.CylinderGeometry(0.135, 0.135, 0.012, 32), black, [x, 0.904, 0]);
    addMesh(new THREE.CylinderGeometry(0.101, 0.101, 0.015, 32), darkMetal, [x, 0.912, 0]);
  }

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

  for (const side of [-1, 1]) {
    const brand = addLabel('MICRO-EPSILON', 1.03, 0.13, [-0.70 * side, 0.22, 0.622 * side], { fontSize: 88, weight: 700 });
    const name = addLabel('optoNCDT', 1.13, 0.20, [0.56 * side, 0.22, 0.623 * side], { fontSize: 128, weight: 700 });
    const id = addLabel('ILD1900-10', 0.94, 0.15, [0.54 * side, -0.02, 0.624 * side], { color: '#851c31', fontSize: 91, weight: 700 });
    if (side < 0) {
      for (const label of [brand, name, id]) label.rotation.y = Math.PI;
    }
  }
  const warning = addLabel('✴', 0.29, 0.29, [1.405, 0.17, 0], { color: '#211e16', background: '#e3bd4e', fontSize: 450, weight: 700 });
  warning.rotation.y = Math.PI / 2;

  function consoleLabel(text, x, z, width = 0.32) {
    const label = addLabel(text, width, 0.11, [x, 0.904, z], { color: '#d2d5d8', fontSize: 104, weight: 700 });
    label.rotation.x = -Math.PI / 2;
  }
  consoleLabel('FUNCTION', -0.69, 0.24, 0.39);
  consoleLabel('SELECT', -1.05, 0.24);

  const ledMeshes = {};
  const ledGlows = {};
  const ledButtons = {};
  const currentStatus = { state: 'unknown', output: 'unknown' };

  // A shared radial texture gives the actual emitters a soft halo without a post-processing pass.
  // Depth testing keeps the light behind the housing when the sensor is viewed from below.
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 128;
  const glowContext = glowCanvas.getContext('2d');
  const glowGradient = glowContext.createRadialGradient(64, 64, 0, 64, 64, 64);
  glowGradient.addColorStop(0, 'rgba(255,255,255,1)');
  glowGradient.addColorStop(0.12, 'rgba(255,255,255,0.9)');
  glowGradient.addColorStop(0.32, 'rgba(255,255,255,0.4)');
  glowGradient.addColorStop(0.62, 'rgba(255,255,255,0.08)');
  glowGradient.addColorStop(1, 'rgba(255,255,255,0)');
  glowContext.fillStyle = glowGradient;
  glowContext.fillRect(0, 0, 128, 128);
  const glowTexture = new THREE.CanvasTexture(glowCanvas);
  textures.push(glowTexture);

  for (const [name, x] of [['state', -0.05], ['output', -0.35]]) {
    addMesh(new THREE.CylinderGeometry(0.072, 0.072, 0.017, 24), black, [x, 0.902, 0]);
    const material = new THREE.MeshStandardMaterial({ color: LED_COLORS.unknown, emissive: LED_COLORS.unknown,
      emissiveIntensity: 0, roughness: 0.18, toneMapped: false });
    const mesh = addMesh(new THREE.SphereGeometry(0.046, 20, 12), material, [x, 0.913, 0]);
    mesh.scale.y = 0.5;
    mesh.userData.ledName = name;
    ledMeshes[name] = mesh;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: LED_COLORS.unknown,
      transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, toneMapped: false }));
    glow.position.set(x, 0.945, 0);
    glow.scale.set(0.36, 0.36, 1);
    glow.visible = false;
    glow.raycast = () => {}; // The halo must not intercept clicks intended for the physical LED.
    sensor.add(glow);
    ledGlows[name] = glow;
    consoleLabel(name.toUpperCase(), x, 0.24);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sensor3d-led-hotspot';
    button.style.cssText = 'position:absolute;transform:translate(-50%, -50%);border:1px solid transparent;border-radius:50%;background:transparent;cursor:pointer;padding:0;z-index:1';
    button.addEventListener('focus', () => { button.style.borderColor = 'var(--accent)'; });
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
    camera.updateMatrixWorld();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    sensor.getWorldQuaternion(quaternion);
    normal.set(0, 1, 0).applyQuaternion(quaternion);
    const hotspots = Object.keys(ledMeshes).map(name => {
      ledMeshes[name].getWorldPosition(position);
      direction.copy(camera.position).sub(position);
      const controlsVisible = normal.dot(direction) > 0;
      ledGlows[name].visible = controlsVisible && !['off', 'unknown'].includes(currentStatus[name]);
      position.project(camera);
      return {
        button: ledButtons[name],
        x: (position.x * 0.5 + 0.5) * width,
        y: (-position.y * 0.5 + 0.5) * height,
        visible: controlsVisible && position.z < 1 && Math.abs(position.x) <= 1 && Math.abs(position.y) <= 1,
      };
    });
    const [state, output] = hotspots;
    const distance = Math.hypot(state.x - output.x, state.y - output.y);
    // Keep both projected controls independently clickable even when the view is small.
    // The corresponding full-size buttons remain available outside the model.
    const size = Math.min(34, state.visible && output.visible ? distance - 2 : 34);
    for (const { button, x, y, visible } of hotspots) {
      button.style.left = `${x}px`;
      button.style.top = `${y}px`;
      button.style.width = button.style.height = `${Math.max(1, size)}px`;
      button.style.visibility = visible && size >= 5 ? 'visible' : 'hidden';
    }
    renderer.render(scene, camera);
  }

  const setStatus = (status = {}) => {
    for (const name of ['state', 'output']) {
      if (status[name] !== undefined) currentStatus[name] = normalizedStatus(status[name]);
      const value = currentStatus[name];
      const material = ledMeshes[name].material;
      material.color.setHex(LED_COLORS[value]);
      material.emissive.setHex(LED_COLORS[value]);
      material.emissiveIntensity = value === 'off' || value === 'unknown' ? 0 : 1.8;
      ledGlows[name].material.color.setHex(LED_COLORS[value]);
      updateLedButton(ledButtons[name], name, value);
    }
    const laserActive = !['off', 'unknown'].includes(currentStatus.state);
    laserBeam.visible = laserActive;
    laserMaterial.emissiveIntensity = laserActive ? 0.6 : 0;
    laserMaterial.color.setHex(laserActive ? 0x8a2333 : 0x202832);
    render();
  };

  sensor.updateWorldMatrix(true, true);
  const modelBounds = new THREE.Box3().setFromObject(sensor);
  const modelCorners = [];
  for (const x of [modelBounds.min.x, modelBounds.max.x])
    for (const y of [modelBounds.min.y, modelBounds.max.y])
      for (const z of [modelBounds.min.z, modelBounds.max.z]) modelCorners.push(new THREE.Vector3(x, y, z));
  const initialTarget = controls.target.clone();
  const initialDirection = initialCamera.clone().sub(initialTarget).normalize();
  const requiredDistance = (aspect, direction) => {
    const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const projected = modelCorners.map(corner => {
      const offset = corner.clone().sub(controls.target);
      return [offset.dot(right), offset.dot(up), offset.dot(direction)];
    });
    return fitCameraDistance(projected, aspect, camera.fov);
  };
  const resetView = () => {
    controls.target.copy(initialTarget);
    const distance = requiredDistance(camera.aspect, initialDirection);
    camera.position.copy(initialTarget).addScaledVector(initialDirection, distance);
    controls.update();
    render();
  };
  let sized = false;
  const resize = () => {
    if (disposed) return;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight || 260);
    const direction = camera.position.clone().sub(controls.target).normalize();
    const zoom = sized ? camera.position.distanceTo(controls.target) / requiredDistance(camera.aspect, direction) : 1;
    const aspect = width / height;
    const distance = requiredDistance(aspect, direction);
    renderer.setSize(width, height, false);
    camera.aspect = aspect;
    camera.position.copy(controls.target).addScaledVector(direction, distance * zoom);
    controls.minDistance = distance * .55;
    controls.maxDistance = distance * 2.4;
    camera.updateProjectionMatrix();
    controls.update();
    sized = true;
    render();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  controls.addEventListener('change', render);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerDown = null;
  const onPointerDown = event => { pointerDown = { x: event.clientX, y: event.clientY }; };
  const onClick = event => {
    const start = pointerDown;
    pointerDown = null;
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(sensor, true)[0];
    if (hit?.object.userData.ledName) onSelect?.(hit.object.userData.ledName);
    else if (hit) onActivate?.();
  };
  const onKeyDown = event => {
    if (onActivate && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onActivate();
    } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
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
      resetView();
    }
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('keydown', onKeyDown);
  resize();
  setStatus(initialState);

  return {
    setStatus,
    reset() { resetView(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      resizeObserver.disconnect();
      controls.removeEventListener('change', render);
      controls.dispose();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('keydown', onKeyDown);
      const geometries = new Set();
      const materials = new Set();
      scene.traverse(object => {
        if (object.geometry && !object.isSprite) geometries.add(object.geometry);
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
