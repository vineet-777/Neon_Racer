// Three.js is now loaded globally via script tag

// Game State
const state = {
    isPlaying: false,
    score: 0,
    speed: 0.1, // Start at minSpeed (20 km/h)
    targetSpeed: 0,
    lane: 0, // -1 (left), 0 (center), 1 (right)
    gameOver: false,
    lastObstacleTime: 0,
    input: { up: false, down: false }
};

// Configuration
const CONFIG = {
    laneWidth: 3,
    cameraHeight: 5,
    cameraDistance: 8,
    fogColor: 0x300060, // Brighter Purple for visible sky
    gridColor: 0xff00de,
    roadLength: 400,
    roadWidth: 12,
    maxSpeed: 1.5,
    minSpeed: 0.1,
    acceleration: 0.005, // Much slower acceleration
    deceleration: 0.03,
    friction: 0.002
};

// Scene Setup
const scene = new THREE.Scene();
// Linear Fog for smooth horizon
scene.fog = new THREE.Fog(CONFIG.fogColor, 50, 900);
scene.background = new THREE.Color(CONFIG.fogColor);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('game-container').appendChild(renderer.domElement);

// Lights
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(5, 10, 7);
scene.add(dirLight);

// Objects
let playerCar;
let roadPlane;
let laneMarkers = [];
let obstacles = [];
let environment = [];
let sun;
let gridHelper;

function init() {
    createEnvironment();
    createRoad();
    createPlayer();

    // Initial Camera Position
    camera.position.set(0, CONFIG.cameraHeight, CONFIG.cameraDistance);
    camera.lookAt(0, 0, -10);

    // Event Listeners
    window.addEventListener('resize', onWindowResize, false);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    // Touch Controls for Steering (Screen Tap)
    document.addEventListener('touchstart', handleTouch);

    // Button Controls (Gas/Brake/Left/Right)
    const btnGas = document.getElementById('btn-gas');
    const btnBrake = document.getElementById('btn-brake');
    const btnLeft = document.getElementById('btn-left');
    const btnRight = document.getElementById('btn-right');

    if (btnGas && btnBrake) {
        btnGas.addEventListener('touchstart', (e) => { e.preventDefault(); state.input.up = true; });
        btnGas.addEventListener('touchend', (e) => { e.preventDefault(); state.input.up = false; });
        btnGas.addEventListener('mousedown', (e) => { state.input.up = true; });
        btnGas.addEventListener('mouseup', (e) => { state.input.up = false; });

        btnBrake.addEventListener('touchstart', (e) => { e.preventDefault(); state.input.down = true; });
        btnBrake.addEventListener('touchend', (e) => { e.preventDefault(); state.input.down = false; });
        btnBrake.addEventListener('mousedown', (e) => { state.input.down = true; });
        btnBrake.addEventListener('mouseup', (e) => { state.input.down = false; });
    }

    if (btnLeft && btnRight) {
        btnLeft.addEventListener('touchstart', (e) => { e.preventDefault(); changeLane(-1); });
        btnLeft.addEventListener('mousedown', (e) => { changeLane(-1); });

        btnRight.addEventListener('touchstart', (e) => { e.preventDefault(); changeLane(1); });
        btnRight.addEventListener('mousedown', (e) => { changeLane(1); });
    }

    // About Modal Logic
    const aboutBtn = document.getElementById('btn-about');
    const aboutModal = document.getElementById('about-modal');
    const closeAbout = document.getElementById('close-about');

    if (aboutBtn && aboutModal && closeAbout) {
        aboutBtn.addEventListener('click', () => {
            aboutModal.classList.remove('hidden');
        });
        closeAbout.addEventListener('click', () => {
            aboutModal.classList.add('hidden');
        });
    }

    document.getElementById('start-screen').addEventListener('click', startGame);
    document.getElementById('game-over').addEventListener('click', resetGame);

    animate();
}

function createEnvironment() {
    // Neon Sun
    const sunGeo = new THREE.SphereGeometry(60, 32, 32);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xff0055, fog: false });
    sun = new THREE.Mesh(sunGeo, sunMat);
    // Top Right position
    sun.position.set(200, 100, -800);
    scene.add(sun);

    // Sun Glow (Sprite for smooth gradient)
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255, 0, 85, 1)'); // Core
    gradient.addColorStop(0.4, 'rgba(255, 0, 85, 0.4)'); // Mid
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)'); // Edge

    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);

    const glowTexture = new THREE.CanvasTexture(canvas);
    const glowMat = new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xff0055,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(400, 400, 1); // Large scale
    glow.position.copy(sun.position);
    scene.add(glow);

    // Starfield
    const starGeo = new THREE.BufferGeometry();
    const starCount = 500;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i++) {
        starPos[i] = (Math.random() - 0.5) * 1500; // Spread wide
        starPos[i + 1] = Math.abs(starPos[i + 1]); // Keep above ground mostly
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2, fog: false });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);
}

function createRoad() {
    // Shared Shader for Curvature
    const curvatureVertexShader = `
        varying vec2 vUv;
        varying float vDist;
        void main() {
            vUv = uv;
            vec3 pos = position;
            vec4 worldPos = modelMatrix * vec4(pos, 1.0);
            
            float zDist = worldPos.z - 10.0; 
            if (zDist < 0.0) {
                worldPos.y -= pow(zDist, 2.0) * 0.0002;
            }
            
            vDist = zDist;
            gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
    `;

    // Static Road Plane (Dark Asphalt)
    const geometry = new THREE.PlaneGeometry(CONFIG.roadWidth, CONFIG.roadLength, 1, 100);

    const roadMat = new THREE.ShaderMaterial({
        vertexShader: curvatureVertexShader,
        fragmentShader: `
            varying vec2 vUv;
            void main() {
                vec3 color = vec3(0.06, 0.06, 0.06); // Dark Asphalt
                gl_FragColor = vec4(color, 1.0);
            }
        `,
        side: THREE.DoubleSide
    });

    roadPlane = new THREE.Mesh(geometry, roadMat);
    roadPlane.rotation.x = -Math.PI / 2;
    roadPlane.position.y = 0.05;
    roadPlane.position.z = -100;
    scene.add(roadPlane);

    // Curved Neon Grid (Shader)
    const gridGeo = new THREE.PlaneGeometry(2000, 2000, 100, 100);

    const gridUniforms = {
        uColor: { value: new THREE.Color(CONFIG.gridColor) },
        uOffset: { value: 0 }
    };

    const gridMat = new THREE.ShaderMaterial({
        uniforms: gridUniforms,
        vertexShader: curvatureVertexShader,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uOffset;
            varying vec2 vUv;
            varying float vDist;
            void main() {
                float scale = 100.0;
                vec2 grid = fract(vUv * scale + vec2(0.0, uOffset));
                float lineThickness = 0.05;
                float line = step(1.0 - lineThickness, grid.x) + step(1.0 - lineThickness, grid.y);
                float fade = 1.0 - smoothstep(0.0, 800.0, abs(vDist));
                vec3 bgColor = vec3(0.0, 0.0, 0.0);
                vec3 lineColor = uColor;
                vec3 color = mix(bgColor, lineColor, line);
                gl_FragColor = vec4(color * fade, 1.0); 
            }
        `,
        transparent: false,
        side: THREE.DoubleSide
    });

    gridHelper = new THREE.Mesh(gridGeo, gridMat);
    gridHelper.rotation.x = -Math.PI / 2;
    gridHelper.position.y = 0;
    gridHelper.position.z = -500;
    scene.add(gridHelper);
    gridHelper.userData = { uniforms: gridUniforms };

    // Moving Lane Markers (White Dashes)
    const markerGeo = new THREE.PlaneGeometry(0.2, 3);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    for (let i = 0; i < 20; i++) {
        const zPos = -10 + (i * 20);

        const m1 = new THREE.Mesh(markerGeo, markerMat);
        m1.rotation.x = -Math.PI / 2;
        m1.position.set(-1.5, 0.1, zPos);
        m1.userData.initialY = 0.1;
        scene.add(m1);
        laneMarkers.push(m1);

        const m2 = new THREE.Mesh(markerGeo, markerMat);
        m2.rotation.x = -Math.PI / 2;
        m2.position.set(1.5, 0.1, zPos);
        m2.userData.initialY = 0.1;
        scene.add(m2);
        laneMarkers.push(m2);
    }

    // Road Borders (Neon Lines)
    const borderGeo = new THREE.PlaneGeometry(1, CONFIG.roadLength, 1, 100);
    const borderMat = new THREE.ShaderMaterial({
        vertexShader: curvatureVertexShader,
        fragmentShader: `
            void main() {
                gl_FragColor = vec4(0.0, 1.0, 1.0, 1.0); // Cyan Neon
            }
        `,
        side: THREE.DoubleSide
    });

    const leftBorder = new THREE.Mesh(borderGeo, borderMat);
    leftBorder.rotation.x = -Math.PI / 2;
    leftBorder.position.set(-CONFIG.roadWidth / 2 - 0.5, 0.1, -100);
    scene.add(leftBorder);

    const rightBorder = new THREE.Mesh(borderGeo, borderMat);
    rightBorder.rotation.x = -Math.PI / 2;
    rightBorder.position.set(CONFIG.roadWidth / 2 + 0.5, 0.1, -100);
    scene.add(rightBorder);
}

function createCarMesh(color) {
    const carGroup = new THREE.Group();

    // Chassis
    const chassisGeo = new THREE.BoxGeometry(1.6, 0.5, 3.2);
    const chassisMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.2, metalness: 0.8 });
    const chassis = new THREE.Mesh(chassisGeo, chassisMat);
    chassis.position.y = 0.5;
    carGroup.add(chassis);

    // Cabin
    const cabinGeo = new THREE.BoxGeometry(1.2, 0.4, 1.5);
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1 });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 0.95, -0.2);
    carGroup.add(cabin);

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.4, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222 });

    const positions = [
        { x: -0.9, z: 1 }, { x: 0.9, z: 1 },
        { x: -0.9, z: -1.2 }, { x: 0.9, z: -1.2 }
    ];

    positions.forEach(pos => {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(pos.x, 0.35, pos.z);
        carGroup.add(wheel);
    });

    // Lights
    const lightGeo = new THREE.BoxGeometry(0.3, 0.1, 0.1);

    // Create Glow Texture (Soft Gradient)
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
    const glowTex = new THREE.CanvasTexture(canvas);

    // Tail Lights (Bright Red Glow)
    const tailLightMat = new THREE.MeshStandardMaterial({
        color: 0xff0000,
        emissive: 0xff0000,
        emissiveIntensity: 4.0
    });

    const tailGlowMat = new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xff0000,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending
    });

    const tl1 = new THREE.Mesh(lightGeo, tailLightMat);
    tl1.position.set(-0.5, 0.6, 1.6);
    carGroup.add(tl1);
    const tGlow1 = new THREE.Sprite(tailGlowMat);
    tGlow1.scale.set(1.5, 1.5, 1);
    tGlow1.position.copy(tl1.position);
    carGroup.add(tGlow1);

    const tl2 = new THREE.Mesh(lightGeo, tailLightMat);
    tl2.position.set(0.5, 0.6, 1.6);
    carGroup.add(tl2);
    const tGlow2 = new THREE.Sprite(tailGlowMat);
    tGlow2.scale.set(1.5, 1.5, 1);
    tGlow2.position.copy(tl2.position);
    carGroup.add(tGlow2);

    // Headlights (Bright Yellow/White)
    const headLightMat = new THREE.MeshStandardMaterial({
        color: 0xffffaa,
        emissive: 0xffffaa,
        emissiveIntensity: 4.0
    });

    const headGlowMat = new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xffffaa,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending
    });

    const hl1 = new THREE.Mesh(lightGeo, headLightMat);
    hl1.position.set(-0.5, 0.6, -1.6);
    carGroup.add(hl1);
    const hGlow1 = new THREE.Sprite(headGlowMat);
    hGlow1.scale.set(2, 2, 1);
    hGlow1.position.copy(hl1.position);
    carGroup.add(hGlow1);

    const hl2 = new THREE.Mesh(lightGeo, headLightMat);
    hl2.position.set(0.5, 0.6, -1.6);
    carGroup.add(hl2);
    const hGlow2 = new THREE.Sprite(headGlowMat);
    hGlow2.scale.set(2, 2, 1);
    hGlow2.position.copy(hl2.position);
    carGroup.add(hGlow2);

    return carGroup;
}

function createPlayer() {
    playerCar = createCarMesh(0x00ffff); // Cyan Player
    scene.add(playerCar);
}

function spawnObstacle() {
    if (!state.isPlaying) return;

    // Minimum distance check
    const now = Date.now();
    if (now - state.lastObstacleTime < 800) return; // Wait at least 800ms
    state.lastObstacleTime = now;

    const lane = Math.floor(Math.random() * 3) - 1; // -1, 0, 1

    // Random Color
    const colors = [0xff0000, 0x00ff00, 0xffff00, 0xff00ff];
    const color = colors[Math.floor(Math.random() * colors.length)];

    const obstacle = createCarMesh(color);
    obstacle.position.set(lane * CONFIG.laneWidth, 0, -300); // Spawn much further away
    obstacle.userData.initialY = 0; // Store initial Y

    scene.add(obstacle);
    obstacles.push(obstacle);
}

function createWindowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    // Dark background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 64, 64);

    // Neon Windows
    const colors = ['#ff00ff', '#00ffff', '#ffff00', '#ff0000'];
    const color = colors[Math.floor(Math.random() * colors.length)];

    ctx.fillStyle = color;

    // Draw 4 windows
    if (Math.random() > 0.3) ctx.fillRect(8, 8, 20, 20);
    if (Math.random() > 0.3) ctx.fillRect(36, 8, 20, 20);
    if (Math.random() > 0.3) ctx.fillRect(8, 36, 20, 20);
    if (Math.random() > 0.3) ctx.fillRect(36, 36, 20, 20);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    return texture;
}

function spawnEnvironment() {
    if (!state.isPlaying) return;

    const side = Math.random() > 0.5 ? 1 : -1;
    const xPos = side * (15 + Math.random() * 30);

    let obj;
    let initialY = 0;

    if (Math.random() > 0.5) {
        // Neon Tree
        const group = new THREE.Group();
        const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(0.5, 0.5, 2),
            new THREE.MeshStandardMaterial({ color: 0x884400 })
        );
        trunk.position.y = 1;

        const leaves = new THREE.Mesh(
            new THREE.ConeGeometry(2, 5, 8),
            new THREE.MeshStandardMaterial({
                color: 0x00ff00,
                emissive: 0x00ff00,
                emissiveIntensity: 0.8
            })
        );
        leaves.position.y = 3.5;

        group.add(trunk);
        group.add(leaves);
        obj = group;
        initialY = 0;
    } else {
        // Neon Building
        const height = 10 + Math.random() * 20;
        const geometry = new THREE.BoxGeometry(5, height, 5);

        const texture = createWindowTexture();
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1, Math.floor(height / 5));

        const material = new THREE.MeshStandardMaterial({
            color: 0x111111,
            emissive: 0xffffff,
            emissiveMap: texture,
            emissiveIntensity: 1
        });

        obj = new THREE.Mesh(geometry, material);
        obj.position.y = height / 2;
        initialY = height / 2;
    }

    obj.position.x = xPos;
    obj.position.z = -300;
    obj.userData.initialY = initialY; // Store initial Y

    scene.add(obj);
    environment.push(obj);
}

function startGame() {
    if (state.isPlaying) return;
    state.isPlaying = true;
    state.gameOver = false;
    state.score = 0;
    state.speed = CONFIG.minSpeed; // Start at 20 km/h
    state.lastObstacleTime = Date.now();

    // Clear existing
    obstacles.forEach(obs => scene.remove(obs));
    obstacles = [];
    environment.forEach(env => scene.remove(env));
    environment = [];

    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('game-over').classList.add('hidden');
}

function resetGame() {
    state.lane = 0;
    playerCar.position.x = 0;
    startGame();
}

function gameOver() {
    state.isPlaying = false;
    state.gameOver = true;
    document.getElementById('game-over').classList.remove('hidden');
}

function handleKeyDown(event) {
    if (!state.isPlaying) {
        if (!state.gameOver) {
            startGame();
        } else {
            resetGame();
        }
        return;
    }

    if (event.key === 'ArrowLeft' || event.key === 'a') {
        changeLane(-1);
    } else if (event.key === 'ArrowRight' || event.key === 'd') {
        changeLane(1);
    } else if (event.key === 'ArrowUp' || event.key === 'w') {
        state.input.up = true;
    } else if (event.key === 'ArrowDown' || event.key === 's') {
        state.input.down = true;
    }
}

function handleKeyUp(event) {
    if (event.key === 'ArrowUp' || event.key === 'w') {
        state.input.up = false;
    } else if (event.key === 'ArrowDown' || event.key === 's') {
        state.input.down = false;
    }
}

function handleTouch(event) {
    if (!state.isPlaying) return;

    // Ignore touches on buttons (handled by their own listeners)
    if (event.target.tagName === 'BUTTON') return;

    const touchY = event.touches[0].clientY;
    const touchX = event.touches[0].clientX;

    // Ignore touches in the bottom 150px where controls are located
    if (touchY > window.innerHeight - 150) return;

    const halfWidth = window.innerWidth / 2;

    if (touchX < halfWidth) {
        changeLane(-1);
    } else {
        changeLane(1);
    }
}

function changeLane(direction) {
    const newLane = state.lane + direction;
    if (newLane >= -1 && newLane <= 1) {
        state.lane = newLane;
    }
}

function update() {
    if (!state.isPlaying) return;

    // Realistic Acceleration Curve
    const accelerationFactor = 1 - (state.speed / CONFIG.maxSpeed);

    if (state.input.up) {
        state.speed += CONFIG.acceleration * Math.max(0.1, accelerationFactor);
    } else if (state.input.down) {
        state.speed -= CONFIG.deceleration;
    } else {
        // Friction / Coasting
        state.speed -= CONFIG.friction;
    }

    // Clamp Speed
    if (state.speed > CONFIG.maxSpeed) state.speed = CONFIG.maxSpeed;
    if (state.speed < CONFIG.minSpeed) state.speed = CONFIG.minSpeed;

    // Move Car smoothly to lane
    const targetX = state.lane * CONFIG.laneWidth;
    playerCar.position.x += (targetX - playerCar.position.x) * 0.15;
    playerCar.rotation.z = (playerCar.position.x - targetX) * 0.1;

    // Move Lane Markers
    laneMarkers.forEach(marker => {
        marker.position.z += state.speed;
        if (marker.position.z > 10) {
            marker.position.z -= 400;
        }

        // Apply Curvature
        const zDist = marker.position.z - 10.0;
        if (zDist < 0) {
            const drop = Math.pow(zDist, 2) * 0.0002;
            marker.position.y = (marker.userData.initialY || 0.1) - drop;
        } else {
            marker.position.y = (marker.userData.initialY || 0.1);
        }
    });

    // Animate Grid (Shader Offset)
    if (gridHelper && gridHelper.userData.uniforms) {
        gridHelper.userData.uniforms.uOffset.value += state.speed / 20.0;
    }

    // Spawn Obstacles
    if (state.speed > 0) {
        if (Math.random() < 0.02 + (state.score / 10000)) {
            spawnObstacle();
        }

        if (Math.random() < 0.1) {
            spawnEnvironment();
        }
    }

    // Move & Check Obstacles
    for (let i = obstacles.length - 1; i >= 0; i--) {
        const obs = obstacles[i];
        obs.position.z += state.speed;

        // Apply Curvature to Y
        const zDist = obs.position.z - 10.0;
        if (zDist < 0) {
            const drop = Math.pow(zDist, 2) * 0.0002;
            obs.position.y = (obs.userData.initialY || 0) - drop;
        } else {
            obs.position.y = (obs.userData.initialY || 0);
        }

        if (obs.position.z > -2 && obs.position.z < 2) {
            if (Math.abs(obs.position.x - playerCar.position.x) < 1.2) {
                gameOver();
            }
        }

        if (obs.position.z > 10) {
            scene.remove(obs);
            obstacles.splice(i, 1);
        }
    }

    // Move Environment
    for (let i = environment.length - 1; i >= 0; i--) {
        const env = environment[i];
        env.position.z += state.speed;

        // Apply Curvature to Y
        const zDist = env.position.z - 10.0;
        if (zDist < 0) {
            const drop = Math.pow(zDist, 2) * 0.0002;
            env.position.y = (env.userData.initialY || 0) - drop;
        } else {
            env.position.y = (env.userData.initialY || 0);
        }

        if (env.position.z > 10) {
            scene.remove(env);
            environment.splice(i, 1);
        }
    }

    // Score based on distance traveled (speed)
    state.score += state.speed;
    document.getElementById('score').innerText = `SCORE: ${Math.floor(state.score / 10)}`;

    // Update Speedometer
    const kmh = Math.floor(state.speed * 200);
    document.getElementById('speedometer').innerText = `SPEED: ${kmh} km/h`;
}

function animate() {
    requestAnimationFrame(animate);
    update();
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

init();
