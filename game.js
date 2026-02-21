// game.js - Starry Snake (Refined Logic)

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const uiOverlay = document.getElementById('ui-overlay');
const startBtn = document.getElementById('start-btn');
const statusText = document.getElementById('status-text');
const hud = {
    score: document.getElementById('score-display'),
    level: document.getElementById('level-display'),
    speed: document.getElementById('speed-display')
};

// --- Config ---
const GRID_SIZE = 25; 
const PARTICLE_LIFETIME = 30;
const BASE_SPEED = 120; 
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

// --- Audio ---
let audioCtx;
let isAudioInit = false;

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
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(1600, now + 0.1);
        gainNode.gain.setValueAtTime(0.2, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
    } else if (type === 'die') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, now);
        osc.frequency.exponentialRampToValueAtTime(20, now + 0.5);
        gainNode.gain.setValueAtTime(0.3, now);
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

// --- Star System (Background) ---
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
    // Get the computed size of the wrapper div
    const wrapper = document.getElementById('game-wrapper');
    const rect = wrapper.getBoundingClientRect();
    
    canvas.width = rect.width;
    canvas.height = rect.height;
    
    // Snap logical grid to fit exactly
    cols = Math.floor(canvas.width / GRID_SIZE);
    rows = Math.floor(canvas.height / GRID_SIZE);
    
    // Adjust canvas size to perfect multiple of GRID_SIZE to avoid edge gaps
    // We can center the playable area or just clip the excess
    // Let's adjust logical width/height to match cols*rows
    width = cols * GRID_SIZE;
    height = rows * GRID_SIZE;
    
    // Center the rendering context if needed, or just let the CSS border handle it.
    // Since we want strict bounds, let's keep it simple: 
    // Playable area is (0,0) to (width, height).
}

window.addEventListener('resize', () => {
    resize();
    initStars();
    if (!isRunning) spawnFood(); // Re-spawn food if resized while stopped
});
resize();
initStars();

function spawnFood() {
    let valid = false;
    while (!valid) {
        // Random grid position
        const c = Math.floor(Math.random() * cols);
        const r = Math.floor(Math.random() * rows);
        
        food.x = c * GRID_SIZE;
        food.y = r * GRID_SIZE;
        
        // Ensure not on snake
        valid = !snake.some(seg => seg.x === food.x && seg.y === food.y);
    }
}

function updateHUD() {
    hud.score.textContent = score;
    hud.level.textContent = level;
    const spd = Math.round((BASE_SPEED - speed + 10) / 10);
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
    playSound('die');
    statusText.textContent = "CRITICAL FAILURE";
    uiOverlay.classList.remove('hidden');
    document.querySelector('#ui-overlay h1').textContent = "MISSION FAILED";
    startBtn.textContent = "RETRY MISSION";
    if (gameInterval) clearInterval(gameInterval);
}

function resetGame() {
    initAudio();
    resize(); // Ensure dimensions are fresh
    
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
    
    if (!animationId) requestAnimationFrame(render);
}

function update() {
    if (!isRunning || isPaused) return;

    direction = nextDirection;
    const head = { x: snake[0].x + direction.x * GRID_SIZE, y: snake[0].y + direction.y * GRID_SIZE };

    // Wall collision (Strict bounds)
    // width/height are calculated as cols*GRID_SIZE, so valid range is 0 to width-GRID_SIZE
    if (head.x < 0 || head.x >= width || head.y < 0 || head.y >= height) {
        spawnParticles(snake[0].x, snake[0].y, 50, COLORS.snakeHead);
        gameOver();
        return;
    }

    // Self collision
    if (snake.some(seg => seg.x === head.x && seg.y === head.y)) {
        spawnParticles(head.x, head.y, 50, COLORS.snakeHead);
        gameOver();
        return;
    }

    snake.unshift(head);

    // Eat food logic
    if (head.x === food.x && head.y === food.y) {
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
    // Clear whole canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Background Grid (Optional visual guide for bounds)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Draw boundary box
    ctx.strokeRect(0, 0, width, height); 
    
    // Draw Stars
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

    // Draw Food
    ctx.shadowBlur = 20;
    ctx.shadowColor = COLORS.food;
    ctx.fillStyle = COLORS.food;
    ctx.beginPath();
    // Center in grid cell
    ctx.arc(food.x + GRID_SIZE/2, food.y + GRID_SIZE/2, GRID_SIZE/2 - 4, 0, Math.PI*2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Draw Snake
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

    // Draw Particles
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
                // Game Over state, ignore space or map to restart?
                // Let's make space restart if game over
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
                } else {
                    statusText.textContent = "SYSTEM NOMINAL";
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
    } else {
        resetGame();
    }
});
