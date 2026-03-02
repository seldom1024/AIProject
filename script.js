const COLS = 10;
const ROWS = 20;

const BASE_FALL_SPEED = 0.82;
const SOFT_DROP_STEP = 0.65;
const DRAG_STEP_PX = 24;
const CLICK_MOVE_TOLERANCE = 6;
const MAX_PARTICLES = 260;

const LINE_POINTS = [0, 40, 100, 300, 1200];

const COLORS = {
  I: "#39c5ff",
  J: "#5670ff",
  L: "#ff9f46",
  O: "#ffd84d",
  S: "#49d785",
  T: "#b76bff",
  Z: "#ff5f78",
};

const SHAPES = {
  I: [[1, 1, 1, 1]],
  J: [[1, 0, 0], [1, 1, 1]],
  L: [[0, 0, 1], [1, 1, 1]],
  O: [[1, 1], [1, 1]],
  S: [[0, 1, 1], [1, 1, 0]],
  T: [[0, 1, 0], [1, 1, 1]],
  Z: [[1, 1, 0], [0, 1, 1]],
};

const gameCanvas = document.getElementById("gameCanvas");
const nextCanvas = document.getElementById("nextCanvas");
const holdCanvas = document.getElementById("holdCanvas");
const ctx = gameCanvas.getContext("2d");
const nextCtx = nextCanvas.getContext("2d");
const holdCtx = holdCanvas.getContext("2d");

const scoreEl = document.getElementById("score");
const linesEl = document.getElementById("lines");
const levelEl = document.getElementById("level");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlayTitle");
const overlayText = document.getElementById("overlayText");
const restartBtn = document.getElementById("restartBtn");
const touchButtons = Array.from(document.querySelectorAll(".touch-controls button"));

const CELL = gameCanvas.width / COLS;

const audioEngine = {
  context: null,
  master: null,
  lastPlayAt: {},
};

const state = {
  board: createMatrix(COLS, ROWS),
  bag: [],
  current: null,
  nextType: null,
  holdType: null,
  canHold: true,
  score: 0,
  lines: 0,
  level: 1,
  fallSpeed: BASE_FALL_SPEED,
  fallProgress: 0,
  lastTime: 0,
  renderTime: 0,
  boardPulse: 0,
  lineBursts: [],
  particles: [],
  screenFlash: 0,
  paused: false,
  gameOver: false,
  jelly: createJellyState(),
};

function createMatrix(w, h) {
  return Array.from({ length: h }, () => Array(w).fill(null));
}

function createJellyState() {
  return {
    scaleX: 1,
    scaleY: 1,
    rot: 0,
    velScaleX: 0,
    velScaleY: 0,
    velRot: 0,
    pulse: 0,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function calcFallSpeed(level) {
  const lv = Math.max(1, level);
  const earlyCurve = Math.pow(lv - 1, 1.15) * 0.08;
  const lateCurve = Math.pow(Math.max(0, lv - 12), 1.8) * 0.016;
  return BASE_FALL_SPEED + earlyCurve + lateCurve;
}

function hexToRgb(hex) {
  const raw = hex.replace("#", "");
  const parsed = Number.parseInt(raw, 16);
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255,
  };
}

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getNextType() {
  if (state.bag.length === 0) {
    state.bag = shuffle(Object.keys(SHAPES));
  }
  return state.bag.pop();
}

function cloneShape(shape) {
  return shape.map((row) => row.slice());
}

function createPiece(type) {
  return {
    type,
    matrix: cloneShape(SHAPES[type]),
    x: Math.floor(COLS / 2) - 2,
    y: -1,
  };
}

function collide(board, piece) {
  for (let y = 0; y < piece.matrix.length; y += 1) {
    for (let x = 0; x < piece.matrix[y].length; x += 1) {
      if (!piece.matrix[y][x]) {
        continue;
      }
      const bx = x + piece.x;
      const by = y + piece.y;
      if (bx < 0 || bx >= COLS || by >= ROWS) {
        return true;
      }
      if (by >= 0 && board[by][bx]) {
        return true;
      }
    }
  }
  return false;
}

function merge(board, piece) {
  piece.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (!value) {
        return;
      }
      const by = y + piece.y;
      const bx = x + piece.x;
      if (by >= 0) {
        board[by][bx] = piece.type;
      }
    });
  });
}

function rotate(matrix, dir) {
  const rotated = matrix[0].map((_, x) => matrix.map((row) => row[x]));
  return dir > 0 ? rotated.map((row) => row.reverse()) : rotated.reverse();
}

function kickJelly(scaleXDelta, scaleYDelta, rotDelta = 0, pulse = 0.06) {
  const jelly = state.jelly;
  jelly.scaleX += scaleXDelta * 0.45;
  jelly.scaleY += scaleYDelta * 0.45;
  jelly.velScaleX += scaleXDelta * 8.2;
  jelly.velScaleY += scaleYDelta * 8.2;
  jelly.velRot += rotDelta * 6;
  jelly.pulse = Math.min(1.65, jelly.pulse + pulse);
}

function springStep(value, velocity, target, stiffness, damping, dt) {
  const force = (target - value) * stiffness;
  velocity += force * dt;
  velocity *= Math.exp(-damping * dt);
  value += velocity * dt;
  return [value, velocity];
}

function updateJelly(dt) {
  const jelly = state.jelly;
  [jelly.scaleX, jelly.velScaleX] = springStep(jelly.scaleX, jelly.velScaleX, 1, 38, 11.5, dt);
  [jelly.scaleY, jelly.velScaleY] = springStep(jelly.scaleY, jelly.velScaleY, 1, 38, 11.5, dt);
  [jelly.rot, jelly.velRot] = springStep(jelly.rot, jelly.velRot, 0, 34, 10.4, dt);
  jelly.scaleX = clamp(jelly.scaleX, 0.78, 1.26);
  jelly.scaleY = clamp(jelly.scaleY, 0.78, 1.26);
  jelly.rot = clamp(jelly.rot, -0.22, 0.22);
  jelly.pulse = Math.max(0, jelly.pulse - dt * 1.85);
  state.boardPulse = Math.max(0, state.boardPulse - dt * 1.12);
}

function getAudioContext() {
  if (audioEngine.context) {
    return audioEngine.context;
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) {
    return null;
  }
  const context = new Ctx();
  const master = context.createGain();
  master.gain.value = 0.38;
  master.connect(context.destination);
  audioEngine.context = context;
  audioEngine.master = master;
  return context;
}

function unlockAudio() {
  const context = getAudioContext();
  if (!context) {
    return;
  }
  if (context.state === "suspended") {
    context.resume().catch(() => {});
  }
}

function canPlaySfx(key, cooldownMs = 0) {
  const now = performance.now();
  const last = audioEngine.lastPlayAt[key] ?? -Infinity;
  if (now - last < cooldownMs) {
    return false;
  }
  audioEngine.lastPlayAt[key] = now;
  return true;
}

function playTone({
  freq,
  toFreq = freq,
  type = "sine",
  duration = 0.09,
  volume = 0.22,
  attack = 0.005,
  release = 0.085,
  when = 0,
}) {
  const context = getAudioContext();
  if (!context || context.state !== "running") {
    return;
  }
  const osc = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime + when;
  const endTime = now + duration;
  const releaseTime = Math.max(now + attack, endTime - release);

  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(35, freq), now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(35, toFreq), endTime);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, releaseTime);
  gain.gain.setValueAtTime(0.0001, endTime);

  osc.connect(gain);
  gain.connect(audioEngine.master);
  osc.start(now);
  osc.stop(endTime + 0.012);
}

function playSfx(name, payload = {}) {
  if (!audioEngine.context || audioEngine.context.state !== "running") {
    return;
  }

  switch (name) {
    case "move": {
      if (!canPlaySfx("move", 34)) {
        return;
      }
      const base = payload.dir < 0 ? 198 : 224;
      playTone({ freq: base, toFreq: base * 1.03, type: "triangle", duration: 0.038, volume: 0.05 });
      break;
    }
    case "rotate": {
      if (!canPlaySfx("rotate", 62)) {
        return;
      }
      playTone({ freq: 310, toFreq: 520, type: "square", duration: 0.075, volume: 0.055 });
      break;
    }
    case "softDrop": {
      if (!canPlaySfx("softDrop", 58)) {
        return;
      }
      playTone({ freq: 176, toFreq: 148, type: "triangle", duration: 0.05, volume: 0.04 });
      break;
    }
    case "hardDrop": {
      playTone({ freq: 260, toFreq: 110, type: "sawtooth", duration: 0.12, volume: 0.07 });
      playTone({ freq: 90, toFreq: 72, type: "sine", duration: 0.09, volume: 0.055, when: 0.028 });
      break;
    }
    case "lock": {
      if (!canPlaySfx("lock", 45)) {
        return;
      }
      playTone({ freq: 120, toFreq: 96, type: "triangle", duration: 0.06, volume: 0.05 });
      break;
    }
    case "hold": {
      if (!canPlaySfx("hold", 80)) {
        return;
      }
      playTone({ freq: 340, toFreq: 248, type: "triangle", duration: 0.09, volume: 0.05 });
      break;
    }
    case "clear": {
      const lines = Math.max(1, Math.min(4, payload.lines || 1));
      const chord = [523.25, 659.25, 783.99, 987.77];
      for (let i = 0; i < lines; i += 1) {
        playTone({
          freq: chord[i],
          toFreq: chord[i] * 1.02,
          type: "square",
          duration: 0.11,
          volume: 0.06 + i * 0.01,
          when: i * 0.032,
        });
      }
      break;
    }
    case "levelUp": {
      [440, 554.37, 739.99, 880].forEach((freq, idx) => {
        playTone({
          freq,
          toFreq: freq * 1.04,
          type: "triangle",
          duration: 0.11,
          volume: 0.065,
          when: idx * 0.04,
        });
      });
      break;
    }
    case "pause": {
      playTone({ freq: 290, toFreq: 240, type: "sine", duration: 0.075, volume: 0.045 });
      break;
    }
    case "resume": {
      playTone({ freq: 240, toFreq: 305, type: "sine", duration: 0.075, volume: 0.045 });
      break;
    }
    case "gameOver": {
      [240, 182, 146, 110].forEach((freq, idx) => {
        playTone({
          freq,
          toFreq: Math.max(60, freq - 22),
          type: "sawtooth",
          duration: 0.12,
          volume: 0.06,
          when: idx * 0.055,
        });
      });
      break;
    }
    default:
      break;
  }
}

function updateLevelByLines(totalLines) {
  state.level = Math.floor(totalLines / 10) + 1;
  state.fallSpeed = calcFallSpeed(state.level);
}

function updateStats() {
  scoreEl.textContent = `${state.score}`;
  linesEl.textContent = `${state.lines}`;
  levelEl.textContent = `${state.level}`;
}

function clearLines() {
  const clearedRows = [];
  for (let y = ROWS - 1; y >= 0; y -= 1) {
    if (state.board[y].every((cell) => Boolean(cell))) {
      clearedRows.push(y);
      state.board.splice(y, 1);
      state.board.unshift(Array(COLS).fill(null));
      y += 1;
    }
  }
  return clearedRows;
}

function addParticle(x, y, color, energy = 1) {
  if (state.particles.length >= MAX_PARTICLES) {
    state.particles.shift();
  }
  state.particles.push({
    x,
    y,
    vx: (Math.random() * 2 - 1) * 210 * energy,
    vy: (-90 - Math.random() * 210) * energy,
    size: 1.8 + Math.random() * 3.4,
    age: 0,
    life: 0.42 + Math.random() * 0.34,
    color,
  });
}

function triggerLineClearFx(rows, colorHex) {
  const rowList = [...rows].sort((a, b) => a - b);
  rowList.forEach((row, index) => {
    state.lineBursts.push({
      row,
      age: 0,
      life: 0.36 + index * 0.04,
      strength: 0.85 + rowList.length * 0.16,
      color: colorHex,
    });

    const y = (row + 0.5) * CELL;
    const perRow = 18 + rowList.length * 4;
    for (let i = 0; i < perRow; i += 1) {
      const x = (i / Math.max(1, perRow - 1)) * gameCanvas.width;
      addParticle(x, y, colorHex, 0.9 + rowList.length * 0.1);
    }
  });

  state.screenFlash = Math.min(1.2, state.screenFlash + 0.26 + rowList.length * 0.14);
}

function updateVisualEffects(dt) {
  state.lineBursts = state.lineBursts.filter((burst) => {
    burst.age += dt;
    return burst.age < burst.life;
  });

  state.particles = state.particles.filter((particle) => {
    particle.age += dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy += 640 * dt;
    particle.vx *= Math.exp(-2.8 * dt);
    return particle.age < particle.life;
  });

  state.screenFlash = Math.max(0, state.screenFlash - dt * 1.7);
}

function spawnPiece() {
  state.current = createPiece(state.nextType || getNextType());
  state.current.x = Math.floor((COLS - state.current.matrix[0].length) / 2);
  state.nextType = getNextType();
  state.canHold = true;
  state.fallProgress = 0;
  kickJelly(0.03, -0.04, 0, 0.09);

  if (collide(state.board, state.current)) {
    state.gameOver = true;
    playSfx("gameOver");
    showOverlay("游戏结束", "按回车或点击“重新开始”");
  }
}

function lockPiece() {
  merge(state.board, state.current);
  const previousLevel = state.level;
  const clearedRows = clearLines();
  const cleared = clearedRows.length;

  if (cleared > 0) {
    state.lines += cleared;
    state.score += LINE_POINTS[cleared] * state.level;
    updateLevelByLines(state.lines);
    triggerLineClearFx(clearedRows, COLORS[state.current.type]);
    playSfx("clear", { lines: cleared });
    if (state.level > previousLevel) {
      playSfx("levelUp");
    }
    state.boardPulse = Math.min(1.45, state.boardPulse + 0.35 + cleared * 0.22);
    kickJelly(0.18, -0.24, 0, 0.46);
  } else {
    playSfx("lock");
    state.boardPulse = Math.min(1.15, state.boardPulse + 0.18);
    kickJelly(0.11, -0.14, 0, 0.24);
  }

  spawnPiece();
  updateStats();
}

function resolveFallProgress() {
  let movedRows = 0;
  while (state.fallProgress >= 1 && !state.paused && !state.gameOver) {
    state.fallProgress -= 1;
    state.current.y += 1;
    if (collide(state.board, state.current)) {
      state.current.y -= 1;
      state.fallProgress = 0;
      lockPiece();
      return movedRows;
    }
    movedRows += 1;
    kickJelly(0.006, -0.011, 0, 0.015);
  }
  return movedRows;
}

function getGhostY() {
  if (!state.current) {
    return 0;
  }
  const ghost = {
    ...state.current,
    matrix: state.current.matrix,
    x: state.current.x,
    y: state.current.y,
  };
  while (!collide(state.board, ghost)) {
    ghost.y += 1;
  }
  return ghost.y - 1;
}

function shade(hex, amount) {
  const raw = hex.replace("#", "");
  const num = Number.parseInt(raw, 16);
  let r = (num >> 16) + amount;
  let g = ((num >> 8) & 0x00ff) + amount;
  let b = (num & 0x0000ff) + amount;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return `rgb(${r}, ${g}, ${b})`;
}

function roundedRectPath(targetCtx, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2);
  targetCtx.beginPath();
  targetCtx.moveTo(x + r, y);
  targetCtx.lineTo(x + w - r, y);
  targetCtx.quadraticCurveTo(x + w, y, x + w, y + r);
  targetCtx.lineTo(x + w, y + h - r);
  targetCtx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  targetCtx.lineTo(x + r, y + h);
  targetCtx.quadraticCurveTo(x, y + h, x, y + h - r);
  targetCtx.lineTo(x, y + r);
  targetCtx.quadraticCurveTo(x, y, x + r, y);
  targetCtx.closePath();
}

function drawJellyCell(targetCtx, gx, gy, color, options = {}) {
  const {
    alpha = 1,
    pulse = 0,
    wobble = 0,
    size = CELL,
  } = options;

  const px = gx * size;
  const py = gy * size;
  const inset = Math.max(0.9, size * 0.07 - pulse * 0.5);
  const blockSize = size - inset * 2;
  const centerX = px + size / 2;
  const centerY = py + size / 2;
  const radius = Math.max(4, blockSize * 0.24 + pulse * 1.8);
  const stretchX = 1 + wobble * 0.02 + pulse * 0.02;
  const stretchY = 1 - wobble * 0.02 - pulse * 0.015;

  targetCtx.save();
  targetCtx.globalAlpha = alpha;
  targetCtx.translate(centerX, centerY);
  targetCtx.scale(stretchX, stretchY);
  targetCtx.translate(-centerX, -centerY);

  const gradient = targetCtx.createLinearGradient(px, py, px + size, py + size);
  gradient.addColorStop(0, shade(color, 30));
  gradient.addColorStop(0.58, shade(color, 7));
  gradient.addColorStop(1, shade(color, -20));

  roundedRectPath(targetCtx, px + inset, py + inset, blockSize, blockSize, radius);
  targetCtx.fillStyle = gradient;
  targetCtx.fill();

  const gloss = targetCtx.createLinearGradient(px, py, px, py + blockSize * 0.8);
  gloss.addColorStop(0, "rgba(255, 255, 255, 0.5)");
  gloss.addColorStop(1, "rgba(255, 255, 255, 0)");
  roundedRectPath(
    targetCtx,
    px + inset + blockSize * 0.11,
    py + inset + blockSize * 0.08,
    blockSize * 0.78,
    blockSize * 0.5,
    radius * 0.65,
  );
  targetCtx.fillStyle = gloss;
  targetCtx.fill();

  targetCtx.strokeStyle = `rgba(255, 255, 255, ${0.2 + pulse * 0.26})`;
  targetCtx.lineWidth = 1.05;
  roundedRectPath(targetCtx, px + inset, py + inset, blockSize, blockSize, radius);
  targetCtx.stroke();

  targetCtx.restore();
}

function drawBoardBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, gameCanvas.height);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0.04)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0.12)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
}

function drawBoardGrid() {
  ctx.strokeStyle = "rgba(255, 255, 255, 0.065)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= COLS; x += 1) {
    ctx.beginPath();
    ctx.moveTo(x * CELL + 0.5, 0);
    ctx.lineTo(x * CELL + 0.5, gameCanvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= ROWS; y += 1) {
    ctx.beginPath();
    ctx.moveTo(0, y * CELL + 0.5);
    ctx.lineTo(gameCanvas.width, y * CELL + 0.5);
    ctx.stroke();
  }
}

function drawMatrix(targetCtx, matrix, offsetX, offsetY, type, options = {}) {
  const { alpha = 1, pulse = 0, phase = 0, size = CELL } = options;
  for (let y = 0; y < matrix.length; y += 1) {
    for (let x = 0; x < matrix[y].length; x += 1) {
      if (!matrix[y][x]) {
        continue;
      }
      const wobble = Math.sin(
        state.renderTime * 0.008 + (x + offsetX) * 0.74 + (y + offsetY) * 0.51 + phase,
      );
      drawJellyCell(targetCtx, x + offsetX, y + offsetY, COLORS[type], {
        alpha,
        pulse,
        wobble,
        size,
      });
    }
  }
}

function drawBoard() {
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const cell = state.board[y][x];
      if (!cell) {
        continue;
      }
      const ripple =
        0.35 + 0.65 * ((Math.sin(state.renderTime * 0.01 + x * 0.55 + y * 0.42) + 1) / 2);
      const pulse = state.boardPulse * ripple * 0.65;
      drawJellyCell(ctx, x, y, COLORS[cell], {
        alpha: 1,
        pulse,
        wobble: ripple - 0.5,
      });
    }
  }
}

function drawCurrentPiece() {
  if (!state.current || state.gameOver) {
    return;
  }

  const ghostY = getGhostY();
  drawMatrix(ctx, state.current.matrix, state.current.x, ghostY, state.current.type, {
    alpha: 0.22,
    pulse: 0.08 + state.boardPulse * 0.12,
    phase: 1.4,
  });

  const renderY = state.current.y + state.fallProgress;
  const centerX = (state.current.x + state.current.matrix[0].length / 2) * CELL;
  const centerY = (renderY + state.current.matrix.length / 2) * CELL;

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(state.jelly.rot + Math.sin(state.renderTime * 0.007) * 0.01);
  ctx.scale(state.jelly.scaleX, state.jelly.scaleY);
  ctx.translate(-centerX, -centerY);

  drawMatrix(ctx, state.current.matrix, state.current.x, renderY, state.current.type, {
    alpha: 1,
    pulse: 0.44 + state.jelly.pulse * 0.58,
    phase: 2.65,
  });
  ctx.restore();
}

function drawMiniCell(targetCtx, x, y, size, color) {
  const px = x * size;
  const py = y * size;
  const inset = Math.max(1, size * 0.08);
  const blockSize = size - inset * 2;
  const radius = Math.max(3, blockSize * 0.25);

  const gradient = targetCtx.createLinearGradient(px, py, px + size, py + size);
  gradient.addColorStop(0, shade(color, 28));
  gradient.addColorStop(1, shade(color, -18));
  roundedRectPath(targetCtx, px + inset, py + inset, blockSize, blockSize, radius);
  targetCtx.fillStyle = gradient;
  targetCtx.fill();

  targetCtx.strokeStyle = "rgba(255, 255, 255, 0.24)";
  targetCtx.lineWidth = 1;
  roundedRectPath(targetCtx, px + inset, py + inset, blockSize, blockSize, radius);
  targetCtx.stroke();
}

function drawMiniCanvas(targetCtx, type) {
  targetCtx.clearRect(0, 0, targetCtx.canvas.width, targetCtx.canvas.height);
  const bg = targetCtx.createLinearGradient(0, 0, 0, targetCtx.canvas.height);
  bg.addColorStop(0, "rgba(255, 255, 255, 0.05)");
  bg.addColorStop(1, "rgba(0, 0, 0, 0.16)");
  targetCtx.fillStyle = bg;
  targetCtx.fillRect(0, 0, targetCtx.canvas.width, targetCtx.canvas.height);

  if (!type) {
    return;
  }

  const shape = SHAPES[type];
  const cellSize = Math.floor(Math.min(targetCtx.canvas.width, targetCtx.canvas.height) / 5.5);
  const width = shape[0].length * cellSize;
  const height = shape.length * cellSize;
  const startX = Math.floor((targetCtx.canvas.width - width) / 2);
  const startY = Math.floor((targetCtx.canvas.height - height) / 2);

  shape.forEach((row, y) => {
    row.forEach((value, x) => {
      if (!value) {
        return;
      }
      drawMiniCell(
        targetCtx,
        (startX / cellSize) + x,
        (startY / cellSize) + y,
        cellSize,
        COLORS[type],
      );
    });
  });
}

function drawVisualEffects() {
  if (state.lineBursts.length === 0 && state.particles.length === 0 && state.screenFlash <= 0) {
    return;
  }

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  state.lineBursts.forEach((burst) => {
    const t = burst.age / burst.life;
    const strength = (1 - t) * (1 - t) * burst.strength;
    const y = (burst.row + 0.5) * CELL;
    const height = CELL * (0.65 + t * 3.2);

    const grad = ctx.createLinearGradient(0, y - height / 2, 0, y + height / 2);
    grad.addColorStop(0, rgba(burst.color, 0));
    grad.addColorStop(0.5, rgba(burst.color, 0.58 * strength));
    grad.addColorStop(1, rgba(burst.color, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, y - height / 2, gameCanvas.width, height);
  });

  state.particles.forEach((particle) => {
    const life = particle.age / particle.life;
    const alpha = Math.max(0, 1 - life);
    ctx.fillStyle = rgba(particle.color, alpha * 0.9);
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size * (0.5 + alpha * 0.5), 0, Math.PI * 2);
    ctx.fill();
  });

  if (state.screenFlash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${state.screenFlash * 0.22})`;
    ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
  }
  ctx.restore();
}

function drawGame() {
  ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
  drawBoardBackground();
  drawBoardGrid();
  drawBoard();
  drawCurrentPiece();
  drawVisualEffects();
}

function showOverlay(title, text) {
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  overlay.classList.remove("hidden");
}

function hideOverlay() {
  overlay.classList.add("hidden");
}

function resetGame() {
  state.board = createMatrix(COLS, ROWS);
  state.bag = [];
  state.current = null;
  state.nextType = getNextType();
  state.holdType = null;
  state.canHold = true;
  state.score = 0;
  state.lines = 0;
  state.level = 1;
  state.fallSpeed = BASE_FALL_SPEED;
  state.fallProgress = 0;
  state.lastTime = 0;
  state.renderTime = 0;
  state.boardPulse = 0;
  state.lineBursts = [];
  state.particles = [];
  state.screenFlash = 0;
  state.paused = false;
  state.gameOver = false;
  state.jelly = createJellyState();
  updateLevelByLines(0);
  spawnPiece();
  hideOverlay();
  updateStats();
}

function moveHorizontal(dir) {
  if (state.paused || state.gameOver) {
    return;
  }
  state.current.x += dir;
  if (collide(state.board, state.current)) {
    state.current.x -= dir;
    return;
  }
  playSfx("move", { dir });
  kickJelly(-0.05, 0.045, dir * 0.035, 0.08);
}

function softDrop() {
  if (state.paused || state.gameOver) {
    return;
  }
  state.fallProgress += SOFT_DROP_STEP;
  const movedRows = resolveFallProgress();
  if (movedRows > 0) {
    state.score += movedRows;
    updateStats();
    playSfx("softDrop");
  }
  kickJelly(0.05, -0.065, 0, 0.08);
}

function hardDrop() {
  if (state.paused || state.gameOver) {
    return;
  }
  const ghostY = getGhostY();
  const distance = Math.max(0, ghostY - state.current.y);
  state.current.y = ghostY;
  state.fallProgress = 0;
  state.score += distance * 2;
  playSfx("hardDrop");
  kickJelly(0.22, -0.28, 0, 0.4);
  lockPiece();
}

function rotateCurrent(dir = 1) {
  if (state.paused || state.gameOver) {
    return;
  }
  const original = state.current.matrix;
  const originalX = state.current.x;
  state.current.matrix = rotate(state.current.matrix, dir);
  const offsets = [0, -1, 1, -2, 2];
  for (const offset of offsets) {
    state.current.x = originalX + offset;
    if (!collide(state.board, state.current)) {
      playSfx("rotate");
      kickJelly(0.045, -0.05, dir * 0.1, 0.12);
      return;
    }
  }
  state.current.matrix = original;
  state.current.x = originalX;
}

function holdPiece() {
  if (state.paused || state.gameOver || !state.canHold) {
    return;
  }
  const currentType = state.current.type;
  if (!state.holdType) {
    state.holdType = currentType;
    spawnPiece();
  } else {
    const swap = state.holdType;
    state.holdType = currentType;
    state.current = createPiece(swap);
    state.current.x = Math.floor((COLS - state.current.matrix[0].length) / 2);
    state.current.y = -1;
    state.fallProgress = 0;
    if (collide(state.board, state.current)) {
      state.gameOver = true;
      playSfx("gameOver");
      showOverlay("游戏结束", "按回车或点击“重新开始”");
    }
  }
  state.canHold = false;
  playSfx("hold");
  kickJelly(0.075, -0.09, 0.04, 0.14);
}

function togglePause() {
  if (state.gameOver) {
    return;
  }
  state.paused = !state.paused;
  if (state.paused) {
    playSfx("pause");
    showOverlay("已暂停", "按 P 或 Esc 继续游戏");
  } else {
    playSfx("resume");
    hideOverlay();
  }
}

function handleKeydown(event) {
  unlockAudio();
  switch (event.code) {
    case "ArrowLeft":
    case "KeyA":
      event.preventDefault();
      moveHorizontal(-1);
      break;
    case "ArrowRight":
    case "KeyD":
      event.preventDefault();
      moveHorizontal(1);
      break;
    case "ArrowDown":
    case "KeyS":
      event.preventDefault();
      softDrop();
      break;
    case "ArrowUp":
    case "KeyW":
    case "KeyE":
    case "KeyX":
      event.preventDefault();
      rotateCurrent(1);
      break;
    case "KeyQ":
    case "KeyZ":
      event.preventDefault();
      rotateCurrent(-1);
      break;
    case "Space":
      event.preventDefault();
      hardDrop();
      break;
    case "KeyP":
    case "Escape":
      event.preventDefault();
      togglePause();
      break;
    case "KeyC":
    case "ShiftLeft":
    case "ShiftRight":
      event.preventDefault();
      holdPiece();
      break;
    case "KeyR":
      event.preventDefault();
      resetGame();
      break;
    case "Enter":
      if (state.gameOver) {
        event.preventDefault();
        resetGame();
      }
      break;
    default:
      break;
  }
}

function runAction(action) {
  const map = {
    left: () => moveHorizontal(-1),
    right: () => moveHorizontal(1),
    down: () => softDrop(),
    rotate: () => rotateCurrent(1),
    drop: () => hardDrop(),
    hold: () => holdPiece(),
    pause: () => togglePause(),
  };
  const fn = map[action];
  if (fn) {
    fn();
  }
}

function setupTouchControls() {
  const holdRepeat = new Map();
  const repeatable = new Set(["left", "right", "down"]);

  const clearRepeat = (button) => {
    const timer = holdRepeat.get(button);
    if (timer) {
      clearInterval(timer);
      holdRepeat.delete(button);
    }
    button.classList.remove("active");
  };

  touchButtons.forEach((button) => {
    const action = button.dataset.action;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      unlockAudio();
      if (!action) {
        return;
      }
      button.classList.add("active");
      runAction(action);
      if (repeatable.has(action)) {
        const timer = setInterval(() => runAction(action), 90);
        holdRepeat.set(button, timer);
      }
    });

    ["pointerup", "pointerleave", "pointercancel"].forEach((name) => {
      button.addEventListener(name, () => clearRepeat(button));
    });
  });
}

function setupMouseControls() {
  const drag = {
    active: false,
    button: -1,
    startX: 0,
    startY: 0,
    lastX: 0,
    accumX: 0,
    moved: false,
  };

  function resetDrag() {
    drag.active = false;
    drag.button = -1;
    drag.startX = 0;
    drag.startY = 0;
    drag.lastX = 0;
    drag.accumX = 0;
    drag.moved = false;
  }

  gameCanvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  gameCanvas.addEventListener("mousedown", (event) => {
    if (event.button !== 0 && event.button !== 2) {
      return;
    }
    event.preventDefault();
    unlockAudio();
    drag.active = true;
    drag.button = event.button;
    drag.startX = event.clientX;
    drag.startY = event.clientY;
    drag.lastX = event.clientX;
    drag.accumX = 0;
    drag.moved = false;
  });

  window.addEventListener("mousemove", (event) => {
    if (!drag.active || state.paused || state.gameOver) {
      return;
    }
    const deltaX = event.clientX - drag.lastX;
    drag.lastX = event.clientX;
    drag.accumX += deltaX;

    while (drag.accumX <= -DRAG_STEP_PX) {
      moveHorizontal(-1);
      drag.accumX += DRAG_STEP_PX;
      drag.moved = true;
    }
    while (drag.accumX >= DRAG_STEP_PX) {
      moveHorizontal(1);
      drag.accumX -= DRAG_STEP_PX;
      drag.moved = true;
    }
  });

  window.addEventListener("mouseup", (event) => {
    if (!drag.active || event.button !== drag.button) {
      return;
    }
    const totalMoveX = Math.abs(event.clientX - drag.startX);
    const totalMoveY = Math.abs(event.clientY - drag.startY);
    const isClick =
      !drag.moved &&
      totalMoveX <= CLICK_MOVE_TOLERANCE &&
      totalMoveY <= CLICK_MOVE_TOLERANCE;

    if (isClick && !state.paused && !state.gameOver) {
      if (drag.button === 0) {
        rotateCurrent(-1);
      } else if (drag.button === 2) {
        rotateCurrent(1);
      }
    }

    resetDrag();
  });

  window.addEventListener("blur", resetDrag);
}

function update(time = 0) {
  if (!state.lastTime) {
    state.lastTime = time;
  }

  const deltaMs = time - state.lastTime;
  const delta = Math.min(0.05, Math.max(0, deltaMs / 1000));
  state.lastTime = time;
  state.renderTime += deltaMs;

  if (!state.paused && !state.gameOver) {
    state.fallProgress += state.fallSpeed * delta;
    resolveFallProgress();
  }

  updateJelly(delta);
  updateVisualEffects(delta);
  drawGame();
  drawMiniCanvas(nextCtx, state.nextType);
  drawMiniCanvas(holdCtx, state.holdType);
  requestAnimationFrame(update);
}

function init() {
  resetGame();
  drawMiniCanvas(nextCtx, state.nextType);
  drawMiniCanvas(holdCtx, state.holdType);
  setupTouchControls();
  setupMouseControls();
  restartBtn.addEventListener("click", () => {
    unlockAudio();
    resetGame();
  });
  document.addEventListener("keydown", handleKeydown);
  requestAnimationFrame(update);
}

init();
