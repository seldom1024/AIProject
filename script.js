const COLS = 10;
const ROWS = 20;

const BASE_GRAVITY = 2.8;
const GRAVITY_STEP = 0.42;
const BASE_MAX_FALL_SPEED = 8.6;
const MAX_FALL_STEP = 0.78;
const SOFT_DROP_FORCE = 7.5;

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
  gravity: BASE_GRAVITY,
  maxFallSpeed: BASE_MAX_FALL_SPEED,
  fallVelocity: 0,
  fallProgress: 0,
  lastTime: 0,
  renderTime: 0,
  boardPulse: 0,
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

function updateLevelByLines(totalLines) {
  state.level = Math.floor(totalLines / 10) + 1;
  state.gravity = BASE_GRAVITY + (state.level - 1) * GRAVITY_STEP;
  state.maxFallSpeed = BASE_MAX_FALL_SPEED + (state.level - 1) * MAX_FALL_STEP;
}

function updateStats() {
  scoreEl.textContent = `${state.score}`;
  linesEl.textContent = `${state.lines}`;
  levelEl.textContent = `${state.level}`;
}

function clearLines() {
  let linesCleared = 0;
  for (let y = ROWS - 1; y >= 0; y -= 1) {
    if (state.board[y].every((cell) => Boolean(cell))) {
      state.board.splice(y, 1);
      state.board.unshift(Array(COLS).fill(null));
      linesCleared += 1;
      y += 1;
    }
  }
  return linesCleared;
}

function spawnPiece() {
  state.current = createPiece(state.nextType || getNextType());
  state.current.x = Math.floor((COLS - state.current.matrix[0].length) / 2);
  state.nextType = getNextType();
  state.canHold = true;
  state.fallVelocity = 0.45 + Math.min(2.4, state.level * 0.12);
  state.fallProgress = 0;
  kickJelly(0.03, -0.04, 0, 0.09);

  if (collide(state.board, state.current)) {
    state.gameOver = true;
    showOverlay("游戏结束", "按回车或点击“重新开始”");
  }
}

function lockPiece() {
  merge(state.board, state.current);
  const cleared = clearLines();

  if (cleared > 0) {
    state.lines += cleared;
    state.score += LINE_POINTS[cleared] * state.level;
    updateLevelByLines(state.lines);
    state.boardPulse = Math.min(1.45, state.boardPulse + 0.35 + cleared * 0.22);
    kickJelly(0.18, -0.24, 0, 0.46);
  } else {
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

function drawGame() {
  ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
  drawBoardBackground();
  drawBoardGrid();
  drawBoard();
  drawCurrentPiece();
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
  state.gravity = BASE_GRAVITY;
  state.maxFallSpeed = BASE_MAX_FALL_SPEED;
  state.fallVelocity = 0;
  state.fallProgress = 0;
  state.lastTime = 0;
  state.renderTime = 0;
  state.boardPulse = 0;
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
  kickJelly(-0.05, 0.045, dir * 0.035, 0.08);
}

function softDrop() {
  if (state.paused || state.gameOver) {
    return;
  }
  state.fallVelocity = Math.min(state.maxFallSpeed + 10, state.fallVelocity + SOFT_DROP_FORCE);
  state.fallProgress += 0.48;
  const movedRows = resolveFallProgress();
  if (movedRows > 0) {
    state.score += movedRows;
    updateStats();
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
  state.fallVelocity = 0;
  state.score += distance * 2;
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
    state.fallVelocity = 0.45 + Math.min(2.4, state.level * 0.12);
    state.fallProgress = 0;
    if (collide(state.board, state.current)) {
      state.gameOver = true;
      showOverlay("游戏结束", "按回车或点击“重新开始”");
    }
  }
  state.canHold = false;
  kickJelly(0.075, -0.09, 0.04, 0.14);
}

function togglePause() {
  if (state.gameOver) {
    return;
  }
  state.paused = !state.paused;
  if (state.paused) {
    showOverlay("已暂停", "按 P 键继续游戏");
  } else {
    hideOverlay();
  }
}

function handleKeydown(event) {
  switch (event.code) {
    case "ArrowLeft":
      event.preventDefault();
      moveHorizontal(-1);
      break;
    case "ArrowRight":
      event.preventDefault();
      moveHorizontal(1);
      break;
    case "ArrowDown":
      event.preventDefault();
      softDrop();
      break;
    case "ArrowUp":
      event.preventDefault();
      rotateCurrent(1);
      break;
    case "Space":
      event.preventDefault();
      hardDrop();
      break;
    case "KeyP":
      event.preventDefault();
      togglePause();
      break;
    case "KeyC":
      event.preventDefault();
      holdPiece();
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

function update(time = 0) {
  if (!state.lastTime) {
    state.lastTime = time;
  }

  const deltaMs = time - state.lastTime;
  const delta = Math.min(0.05, Math.max(0, deltaMs / 1000));
  state.lastTime = time;
  state.renderTime += deltaMs;

  if (!state.paused && !state.gameOver) {
    state.fallVelocity = Math.min(
      state.maxFallSpeed,
      state.fallVelocity + state.gravity * delta,
    );
    state.fallProgress += state.fallVelocity * delta;
    resolveFallProgress();
  }

  updateJelly(delta);
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
  restartBtn.addEventListener("click", resetGame);
  document.addEventListener("keydown", handleKeydown);
  requestAnimationFrame(update);
}

init();
