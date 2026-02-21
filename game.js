// game.js - Starry Snake (With 8-bit BGM)

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const uiOverlay = document.getElementById('ui-overlay');
const startBtn = document.getElementById('start-btn');
const statusText = document.getElementById('status-text');
const diffBtns = document.querySelectorAll('.diff-btn');
const hud = {
    score: document.getElementById('score-display'),
    level: document.getElementById('level-display'),
    speed: document.getElementById('speed-display')
};

// --- Config ---
const GRID_SIZE = 25; 
const PARTICLE_LIFETIME = 30;
let BASE_SPEED = 120; 
const MIN_SPEED = 30;
const LEVEL_THRESHOLD = 10; 
const COLORS = {
    snakeHead: '#00e5ff',
    snakeBody: 'rgba(0, 229, 255, 0.4)',
    food: '#ffab40',
    warp: '#b388ff',
    star: '#ffffff'
};

// --- State ---
let width, height;
let cols, rows;
let gameInterval = null;
let animationId = null;
let score = 0;
let level = 1;
let speed = BASE_SPEED;
let isRunning = false;
let isPaused = false;
let snake = [];
let direction = { x: 1, y: 0 };
let nextDirection = { x: 1, y: 0 };
let food = { x: 0, y: 0 };
let particles = [];
let stars = [];
let isWarping = false;
let warpTimer = 0;

// --- Audio System (SFX + BGM) ---
let audioCtx;
let isAudioInit = false;
let bgmNodes = []; // Store oscillators to stop them
let bgmInterval = null;
let bgmStep = 0;

function initAudio() {
    if (isAudioInit) return;
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
        isAudioInit = true;
    } catch (e) {
        console.warn('Web Audio API not supported');
    }
}

function playSound(type) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    const now = audioCtx.currentTime;

    if (type === 'eat') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(1600, now + 0.1);
        gainNode.gain.setValueAtTime(0.1, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
    } else if (type === 'die') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, now);
        osc.frequency.exponentialRampToValueAtTime(20, now + 0.5);
        gainNode.gain.setValueAtTime(0.2, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        osc.start(now);
        osc.stop(now + 0.5);
    } else if (type === 'warp') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.linearRampToValueAtTime(800, now + 1.5);
        gainNode.gain.setValueAtTime(0.1, now);
        gainNode.gain.linearRampToValueAtTime(0, now + 1.5);
        osc.start(now);
        osc.stop(now + 1.5);
    }
}

// --- 8-bit BGM Synthesizer ---
// A simple sequencer playing a looping melody
const BGM_TEMPO = 150; // BPM
const NOTE_LENGTH = 60 / BGM_TEMPO / 4; // 16th notes

// Notes frequencies (Hz)
const N = {
    C2: 65.41, D2: 73.42, Eb2: 77.78, E2: 82.41, F2: 87.31, G2: 98.00,
    C3: 130.81, Eb3: 155.56, G3: 196.00, Bb3: 233.08,
    C4: 261.63, Eb4: 311.13, F4: 349.23, G4: 392.00, Bb4: 466.16, C5: 523.25
};

// Melody Pattern (Bass + Lead interleaved logic)
// We will procedurally generate a tense arpeggio
function startBGM() {
    if (!audioCtx || bgmInterval) return;
    
    bgmStep = 0;
    const lookahead = 0.1; // seconds
    let nextNoteTime = audioCtx.currentTime;

    bgmInterval = setInterval(() => {
        if (!isRunning || isPaused) return;

        while (nextNoteTime < audioCtx.currentTime + lookahead) {
            playBGMStep(nextNoteTime);
            nextNoteTime += NOTE_LENGTH;
        }
    }, 50);
}

function stopBGM() {
    if (bgmInterval) {
        clearInterval(bgmInterval);
        bgmInterval = null;
    }
    // Cancel scheduled sounds? Not easily possible without storing every node, 
    // but they are short enough to just finish naturally.
}

function playBGMStep(time) {
    const oscBass = audioCtx.createOscillator();
    const gainBass = audioCtx.createGain();
    oscBass.connect(gainBass);
    gainBass.connect(audioCtx.destination);

    const oscLead = audioCtx.createOscillator();
    const gainLead = audioCtx.createGain();
    oscLead.connect(gainLead);
    gainLead.connect(audioCtx.destination);

    // 16-step pattern loop
    const step = bgmStep % 16;

    // Bass Line (Driving C Minor)
    // C2 C2 C2 C2 Eb2 Eb2 G2 G2
    let bassFreq = N.C2;
    if (step >= 8 && step < 12) bassFreq = N.Eb2;
    if (step >= 12) bassFreq = N.G2;
    
    // Rhythm: play on every step but emphasize beat
    oscBass.type = 'sawtooth';
    oscBass.frequency.value = bassFreq;
    gainBass.gain.setValueAtTime(0.15, time);
    gainBass.gain.exponentialRampToValueAtTime(0.01, time + NOTE_LENGTH);
    oscBass.start(time);
    oscBass.stop(time + NOTE_LENGTH);

    // Lead Arpeggio (Tense)
    // C4 Eb4 G4 C5 ...
    const arp = [N.C4, N.Eb4, N.G4, N.C5];
    let leadFreq = arp[step % 4];
    
    // Variation every 4 bars
    if (Math.floor(bgmStep / 32) % 2 === 1) {
        // Higher octave variation
        leadFreq *= 2; 
    }

    // Only play lead on certain steps to create rhythm
    // x x x - x x - x
    const pattern = [1, 1, 1, 0, 1, 1, 0, 1]; 
    if (pattern[step % 8]) {
        oscLead.type = 'square';
        oscLead.frequency.value = leadFreq;
        gainLead.gain.setValueAtTime(0.08, time);
        gainLead.gain.exponentialRampToValueAtTime(0.01, time + NOTE_LENGTH);
        oscLead.start(time);
        oscLead.stop(time + NOTE_LENGTH);
    }

    bgmStep++;
}

// --- Star System ---
class Star {
    constructor() {
        this.reset();
        this.z = Math.random() * width;
    }
    reset() {
        this.x = (Math.random() - 0.5) * width * 2; 
        this.y = (Math.random() - 0.5) * height * 2;
        this.z = width; 
        this.pz = this.z;
    }
    update(speedFactor) {
        this.z -= speedFactor;
        if (this.z < 1) {
            this.reset();
            this.z = width;
            this.pz = this.z;
        }
    }
    draw() {
        const sx = (this.x / this.z) * (width / 2) + width / 2;
        const sy = (this.y / this.z) * (height / 2) + height / 2;
        const r = (width - this.z) / width * 2; 

        if (isWarping) {
            const px = (this.x / this.pz) * (width / 2) + width / 2;
            const py = (this.y / this.pz) * (height / 2) + height / 2;
            
            ctx.strokeStyle = `rgba(200, 200, 255, ${(width - this.z)/width})`;
            ctx.lineWidth = r;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(sx, sy);
            ctx.stroke();
            this.pz = this.z; 
        } else {
            ctx.fillStyle = `rgba(255, 255, 255, ${(width - this.z)/width})`;
            ctx.beginPath();
            ctx.arc(sx, sy, r, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function initStars() {
    stars = [];
    for(let i=0; i<400; i++) {
        stars.push(new Star());
    }
}

// --- Particle System ---
class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.vx = (Math.random() - 0.5) * 10;
        this.vy = (Math.random() - 0.5) * 10;
        this.life = PARTICLE_LIFETIME;
        this.size = Math.random() * 4 + 1;
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life--;
        this.size *= 0.9;
    }
    draw() {
        ctx.globalAlpha = this.life / PARTICLE_LIFETIME;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

function spawnParticles(x, y, count = 20, color) {
    for (let i = 0; i < count; i++) {
        particles.push(new Particle(x, y, color));
    }
}

// --- Game Core ---
function resize() {
    const wrapper = document.getElementById('game-wrapper');
    const rect = wrapper.getBoundingClientRect();
    
    canvas.width = rect.width;
    canvas.height = rect.height;
    
    cols = Math.floor(canvas.width / GRID_SIZE);
    rows = Math.floor(canvas.height / GRID_SIZE);
    
    width = cols * GRID_SIZE;
    height = rows * GRID_SIZE;
}

window.addEventListener('resize', () => {
    resize();
    initStars();
    if (!isRunning) spawnFood();
});
resize();
initStars();

function spawnFood() {
    let valid = false;
    while (!valid) {
        const c = Math.floor(Math.random() * cols);
        const r = Math.floor(Math.random() * rows);
        food.x = c * GRID_SIZE;
        food.y = r * GRID_SIZE;
        valid = !snake.some(seg => seg.x === food.x && seg.y === food.y);
    }
}

function updateHUD() {
    hud.score.textContent = score;
    hud.level.textContent = level;
    // Speed display: Show relative factor based on BASE_SPEED
    const spd = Math.round((200 - speed) / 10);
    hud.speed.textContent = spd;
}

function checkLevelUp() {
    if (score > 0 && score % LEVEL_THRESHOLD === 0) {
        level++;
        speed = Math.max(MIN_SPEED, speed * 0.9);
        isWarping = true;
        warpTimer = 120;
        playSound('warp');
        statusText.textContent = "WARP DRIVE ACTIVE";
        clearInterval(gameInterval);
        gameInterval = setInterval(gameLoop, speed);
    }
}

function gameOver() {
    isRunning = false;
    isWarping = false;
    stopBGM(); // Stop music
    playSound('die');
    statusText.textContent = "CRITICAL FAILURE";
    uiOverlay.classList.remove('hidden');
    document.querySelector('#ui-overlay h1').textContent = "MISSION FAILED";
    startBtn.textContent = "RETRY MISSION";
    if (gameInterval) clearInterval(gameInterval);
}

function resetGame() {
    initAudio();
    resize(); 
    
    const startCol = Math.floor(cols / 2);
    const startRow = Math.floor(rows / 2);
    
    snake = [
        { x: startCol * GRID_SIZE, y: startRow * GRID_SIZE },
        { x: (startCol - 1) * GRID_SIZE, y: startRow * GRID_SIZE },
        { x: (startCol - 2) * GRID_SIZE, y: startRow * GRID_SIZE }
    ];
    
    direction = { x: 1, y: 0 };
    nextDirection = { x: 1, y: 0 };
    score = 0;
    level = 1;
    speed = BASE_SPEED; 
    particles = [];
    isWarping = false;
    
    spawnFood();
    updateHUD();
    statusText.textContent = "SYSTEM NOMINAL";
    
    isRunning = true;
    isPaused = false;
    uiOverlay.classList.add('hidden');
    
    if (gameInterval) clearInterval(gameInterval);
    gameInterval = setInterval(gameLoop, speed);
    
    startBGM(); // Start music
    
    if (!animationId) requestAnimationFrame(render);
}

function update() {
    if (!isRunning || isPaused) return;

    direction = nextDirection;
    const head = { x: snake[0].x + direction.x * GRID_SIZE, y: snake[0].y + direction.y * GRID_SIZE };

    if (head.x < 0 || head.x >= width || head.y < 0 || head.y >= height) {
        spawnParticles(snake[0].x, snake[0].y, 50, COLORS.snakeHead);
        gameOver();
        return;
    }

    if (snake.some(seg => seg.x === head.x && seg.y === head.y)) {
        spawnParticles(head.x, head.y, 50, COLORS.snakeHead);
        gameOver();
        return;
    }

    snake.unshift(head);

    // Eat food logic
    const dist = Math.hypot(head.x - food.x, head.y - food.y);
    if (dist < 5) {
        score += 1;
        spawnParticles(food.x + GRID_SIZE/2, food.y + GRID_SIZE/2, 30, COLORS.food);
        playSound('eat');
        spawnFood();
        checkLevelUp();
        updateHUD();
    } else {
        snake.pop();
    }
}

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.strokeRect(0, 0, width, height); 
    
    let starSpeed = isWarping ? 40 : 2;
    if (!isWarping && isRunning) starSpeed = 2 + (level * 0.5);
    
    stars.forEach(star => {
        star.update(starSpeed);
        star.draw();
    });

    if (isWarping) {
        warpTimer--;
        if (warpTimer <= 0) {
            isWarping = false;
            statusText.textContent = "SYSTEM NOMINAL";
        }
    }

    ctx.shadowBlur = 20;
    ctx.shadowColor = COLORS.food;
    ctx.fillStyle = COLORS.food;
    ctx.beginPath();
    ctx.arc(food.x + GRID_SIZE/2, food.y + GRID_SIZE/2, GRID_SIZE/2 - 4, 0, Math.PI*2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.shadowBlur = 25;
    ctx.shadowColor = COLORS.snakeHead;
    
    snake.forEach((seg, index) => {
        if (index === 0) {
            ctx.fillStyle = COLORS.snakeHead;
            ctx.fillRect(seg.x + 1, seg.y + 1, GRID_SIZE - 2, GRID_SIZE - 2);
            ctx.shadowBlur = 0; 
        } else {
            const opacity = Math.max(0.2, 1 - index / (snake.length + 5));
            ctx.fillStyle = COLORS.snakeBody.replace('0.4', opacity);
            ctx.fillRect(seg.x + 1, seg.y + 1, GRID_SIZE - 2, GRID_SIZE - 2);
        }
    });

    particles.forEach((p, index) => {
        if (p.life <= 0) particles.splice(index, 1);
        else {
            p.update();
            p.draw();
        }
    });

    animationId = requestAnimationFrame(render);
}

function gameLoop() {
    update();
}

// --- Difficulty Handling ---
diffBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        diffBtns.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        BASE_SPEED = parseInt(e.target.dataset.speed);
    });
});

// --- Input ---
window.addEventListener('keydown', e => {
    if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight", " "].indexOf(e.code) > -1) {
        e.preventDefault();
    }
    
    switch(e.key) {
        case 'ArrowUp': case 'w': case 'W':
            if (direction.y === 0) nextDirection = { x: 0, y: -1 }; break;
        case 'ArrowDown': case 's': case 'S':
            if (direction.y === 0) nextDirection = { x: 0, y: 1 }; break;
        case 'ArrowLeft': case 'a': case 'A':
            if (direction.x === 0) nextDirection = { x: -1, y: 0 }; break;
        case 'ArrowRight': case 'd': case 'D':
            if (direction.x === 0) nextDirection = { x: 1, y: 0 }; break;
        case ' ':
            if (!isRunning && uiOverlay.classList.contains('hidden')) {
                if (statusText.textContent === "CRITICAL FAILURE") resetGame();
            } else if (!isRunning) {
                resetGame();
            } else {
                isPaused = !isPaused;
                uiOverlay.classList.toggle('hidden', !isPaused);
                if (isPaused) {
                    document.querySelector('#ui-overlay h1').textContent = "PAUSED";
                    startBtn.textContent = "RESUME";
                    statusText.textContent = "PAUSED";
                    stopBGM(); // Stop music on pause
                } else {
                    statusText.textContent = "SYSTEM NOMINAL";
                    startBGM(); // Resume music
                }
            }
            break;
    }
});

startBtn.addEventListener('click', () => {
    if (isPaused) {
        isPaused = false;
        uiOverlay.classList.add('hidden');
        statusText.textContent = "SYSTEM NOMINAL";
        startBGM();
    } else {
        resetGame();
    }
});
