const COLS = 10;
const ROWS = 20;
const BASE_DROP_INTERVAL = 900;

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

const LINE_POINTS = [0, 40, 100, 300, 1200];

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
  dropInterval: BASE_DROP_INTERVAL,
  dropCounter: 0,
  lastTime: 0,
  paused: false,
  gameOver: false,
};

function createMatrix(w, h) {
  return Array.from({ length: h }, () => Array(w).fill(null));
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
  state.dropInterval = BASE_DROP_INTERVAL;
  state.dropCounter = 0;
  state.lastTime = 0;
  state.paused = false;
  state.gameOver = false;
  spawnPiece();
  hideOverlay();
  updateStats();
}

function spawnPiece() {
  state.current = createPiece(state.nextType || getNextType());
  state.current.x = Math.floor((COLS - state.current.matrix[0].length) / 2);
  state.nextType = getNextType();
  state.canHold = true;
  if (collide(state.board, state.current)) {
    state.gameOver = true;
    showOverlay("游戏结束", "按回车或点击“重新开始”");
  }
}

function getGhostY() {
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

function drawCell(targetCtx, x, y, color, alpha = 1) {
  const px = x * CELL;
  const py = y * CELL;
  const gradient = targetCtx.createLinearGradient(px, py, px + CELL, py + CELL);
  gradient.addColorStop(0, shade(color, 22));
  gradient.addColorStop(1, shade(color, -14));
  targetCtx.globalAlpha = alpha;
  targetCtx.fillStyle = gradient;
  targetCtx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
  targetCtx.strokeStyle = "rgba(255, 255, 255, 0.26)";
  targetCtx.lineWidth = 1;
  targetCtx.strokeRect(px + 1.5, py + 1.5, CELL - 3, CELL - 3);
  targetCtx.globalAlpha = 1;
}

function drawBoardGrid() {
  ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
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

function drawMatrix(targetCtx, matrix, offsetX, offsetY, type, alpha = 1) {
  for (let y = 0; y < matrix.length; y += 1) {
    for (let x = 0; x < matrix[y].length; x += 1) {
      if (!matrix[y][x]) {
        continue;
      }
      drawCell(targetCtx, x + offsetX, y + offsetY, COLORS[type], alpha);
    }
  }
}

function drawGame() {
  ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
  drawBoardGrid();
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const cell = state.board[y][x];
      if (cell) {
        drawCell(ctx, x, y, COLORS[cell], 1);
      }
    }
  }

  if (state.current && !state.gameOver) {
    const ghostY = getGhostY();
    drawMatrix(ctx, state.current.matrix, state.current.x, ghostY, state.current.type, 0.28);
    drawMatrix(ctx, state.current.matrix, state.current.x, state.current.y, state.current.type, 1);
  }
}

function drawMiniCanvas(targetCtx, type) {
  targetCtx.clearRect(0, 0, targetCtx.canvas.width, targetCtx.canvas.height);
  targetCtx.fillStyle = "rgba(255, 255, 255, 0.04)";
  targetCtx.fillRect(0, 0, targetCtx.canvas.width, targetCtx.canvas.height);
  if (!type) {
    return;
  }
  const shape = SHAPES[type];
  const miniCell = Math.floor(Math.min(targetCtx.canvas.width, targetCtx.canvas.height) / 5.5);
  const width = shape[0].length * miniCell;
  const height = shape.length * miniCell;
  const startX = Math.floor((targetCtx.canvas.width - width) / 2);
  const startY = Math.floor((targetCtx.canvas.height - height) / 2);

  shape.forEach((row, y) => {
    row.forEach((v, x) => {
      if (!v) {
        return;
      }
      const px = startX + x * miniCell;
      const py = startY + y * miniCell;
      const gradient = targetCtx.createLinearGradient(px, py, px + miniCell, py + miniCell);
      gradient.addColorStop(0, shade(COLORS[type], 22));
      gradient.addColorStop(1, shade(COLORS[type], -14));
      targetCtx.fillStyle = gradient;
      targetCtx.fillRect(px + 1, py + 1, miniCell - 2, miniCell - 2);
      targetCtx.strokeStyle = "rgba(255, 255, 255, 0.26)";
      targetCtx.strokeRect(px + 1.5, py + 1.5, miniCell - 3, miniCell - 3);
    });
  });
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

function updateStats() {
  scoreEl.textContent = `${state.score}`;
  linesEl.textContent = `${state.lines}`;
  levelEl.textContent = `${state.level}`;
}

function updateLevelByLines(totalLines) {
  state.level = Math.floor(totalLines / 10) + 1;
  state.dropInterval = Math.max(90, BASE_DROP_INTERVAL - (state.level - 1) * 65);
}

function lockPiece() {
  merge(state.board, state.current);
  const cleared = clearLines();
  if (cleared > 0) {
    state.lines += cleared;
    state.score += LINE_POINTS[cleared] * state.level;
    updateLevelByLines(state.lines);
  }
  spawnPiece();
  updateStats();
}

function moveHorizontal(dir) {
  if (state.paused || state.gameOver) {
    return;
  }
  state.current.x += dir;
  if (collide(state.board, state.current)) {
    state.current.x -= dir;
  }
}

function softDrop() {
  if (state.paused || state.gameOver) {
    return;
  }
  state.current.y += 1;
  if (collide(state.board, state.current)) {
    state.current.y -= 1;
    lockPiece();
    return;
  }
  state.score += 1;
  updateStats();
}

function hardDrop() {
  if (state.paused || state.gameOver) {
    return;
  }
  let distance = 0;
  while (!collide(state.board, state.current)) {
    state.current.y += 1;
    distance += 1;
  }
  state.current.y -= 1;
  distance = Math.max(0, distance - 1);
  state.score += distance * 2;
  lockPiece();
}

function rotateCurrent(dir = 1) {
  if (state.paused || state.gameOver) {
    return;
  }
  const original = state.current.matrix;
  state.current.matrix = rotate(state.current.matrix, dir);
  const offsets = [0, -1, 1, -2, 2];
  for (const offset of offsets) {
    state.current.x += offset;
    if (!collide(state.board, state.current)) {
      return;
    }
    state.current.x -= offset;
  }
  state.current.matrix = original;
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
    if (collide(state.board, state.current)) {
      state.gameOver = true;
      showOverlay("游戏结束", "按回车或点击“重新开始”");
    }
  }
  state.canHold = false;
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
    const t = holdRepeat.get(button);
    if (t) {
      clearInterval(t);
      holdRepeat.delete(button);
    }
    button.classList.remove("active");
  };

  touchButtons.forEach((button) => {
    const action = button.dataset.action;
    button.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (!action) {
        return;
      }
      button.classList.add("active");
      runAction(action);
      if (repeatable.has(action)) {
        const timer = setInterval(() => runAction(action), 95);
        holdRepeat.set(button, timer);
      }
    });

    ["pointerup", "pointerleave", "pointercancel"].forEach((name) => {
      button.addEventListener(name, () => clearRepeat(button));
    });
  });
}

function showOverlay(title, text) {
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  overlay.classList.remove("hidden");
}

function hideOverlay() {
  overlay.classList.add("hidden");
}

function update(time = 0) {
  if (!state.lastTime) {
    state.lastTime = time;
  }
  const delta = time - state.lastTime;
  state.lastTime = time;

  if (!state.paused && !state.gameOver) {
    state.dropCounter += delta;
    if (state.dropCounter >= state.dropInterval) {
      state.current.y += 1;
      if (collide(state.board, state.current)) {
        state.current.y -= 1;
        lockPiece();
      }
      state.dropCounter = 0;
    }
  }

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
