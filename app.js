// ====== СОСТОЯНИЕ APP ======
let currentGame = null;
let isGameRunning = false;
let globalClickCount = 0;
let lastInputTime = 0;
const INPUT_COOLDOWN = 150; // ms

// ====== ТАЙМЕР ======
let gameTimerInterval = null;
let gameTimerEnd = 0;
let selectedMinutes = 5; // по умолчанию 5 минут

// ====== FULLSCREEN + LOCK ======
function enterFullscreen() {
  const el = document.documentElement;
  const rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if (rfs) {
    rfs.call(el).catch(() => {});
  }
}

function exitFullscreen() {
  const efs = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
  if (efs && document.fullscreenElement) {
    efs.call(document).catch(() => {});
  }
}

function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

// beforeunload — предупреждение при закрытии вкладки
function warnBeforeLeave(e) {
  e.preventDefault();
  e.returnValue = '';
  return '';
}

// ====== ЭЛЕМЕНТЫ DOM ======
const pages = {
  home: document.getElementById('home'),
  setup: document.getElementById('gameSetup'),
  game: document.getElementById('gameArea')
};

const setupTitle = document.getElementById('setupTitle');
const setupSubtitle = document.getElementById('setupSubtitle');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('gameOverlay');

const clickCounterEl = document.getElementById('clickCounter');
const actionHintEl = document.getElementById('actionHint');

// ====== НАСТРОЙКИ ======
const GAME_INFO = {
  zoo: { title: '🦁 Зоопарк на столе', desc: 'Нажимай что угодно — появляются смешные зверята!' },
  flowers: { title: '🌸 Цветочная поляна', desc: 'Води мышкой — растут цветы! Жми клавиши — появятся букеты!' },
  music: { title: '🎹 Музыкальный отдел', desc: 'Всё — это клавиши пианино! Жми и слушай музыку!' },
  report: { title: '📋 Важный отчёт', desc: 'Печатай зверят и ставь огромные печати мышкой!' }
};

let pendingGameId = null;

// ====== НАВИГАЦИЯ ======
function showPage(pageId) {
  Object.values(pages).forEach(p => p.classList.remove('active'));
  pages[pageId].classList.add('active');
}

window.showHome = function() {
  stopGame();
  // UNLOCK: снимаем beforeunload
  window.removeEventListener('beforeunload', warnBeforeLeave);
  showPage('home');
}

window.openGame = function(gameId) {
  pendingGameId = gameId;
  const info = GAME_INFO[gameId];
  setupTitle.textContent = info.title;
  setupSubtitle.textContent = info.desc;
  // Ставим data-атрибут для цветовой схемы
  pages.setup.setAttribute('data-game', gameId);
  showPage('setup');
}

window.startGame = function() {
  AudioSynth.enable(); // Инициализация аудиоконтекста по жесту пользователя
  
  const soundToggle = document.getElementById('setupCheckboxSound');
  if (!soundToggle.checked) {
    AudioSynth.disable();
  }

  // LOCK: защита от закрытия (fullscreen убран — вызывает подвисания)
  window.addEventListener('beforeunload', warnBeforeLeave);

  showPage('game');
  isGameRunning = true;
  currentGame = pendingGameId;
  overlay.innerHTML = ''; // Очистка старых HTML-элементов
  
  globalClickCount = 0;
  if(clickCounterEl) {
    clickCounterEl.innerHTML = `🌟 0`;
    clickCounterEl.style.display = 'block';
  }
  if(actionHintEl) {
    const isDesktop = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const hintIcon = document.getElementById('hintIcon');
    const hintText = document.getElementById('hintText');
    
    if (hintIcon && hintText) {
      if (isDesktop) {
        hintIcon.textContent = '⌨️';
        hintText.textContent = 'Жми кнопочки!';
      } else {
        hintIcon.textContent = '👆';
        hintText.textContent = 'Нажми!';
      }
    }
    
    actionHintEl.classList.remove('hidden');
    actionHintEl.style.display = 'flex';
  }
  
  resizeCanvas();
  
  // Вызов инициализатора текущей игры
  if (window.gameEngines && window.gameEngines[currentGame] && window.gameEngines[currentGame].init) {
    window.gameEngines[currentGame].init();
  }

  // Запуск таймера
  startGameTimer();
}

function handleUserInput() {
  const now = Date.now();
  if (now - lastInputTime < INPUT_COOLDOWN) return false;
  lastInputTime = now;
  
  globalClickCount++;
  if (clickCounterEl) {
    clickCounterEl.innerHTML = `🌟 ${globalClickCount}`;
    clickCounterEl.classList.add('bump');
    setTimeout(() => clickCounterEl.classList.remove('bump'), 100);
  }
  
  if (actionHintEl && !actionHintEl.classList.contains('hidden')) {
    actionHintEl.classList.add('hidden');
  }
  
  return true;
}
function stopGame() {
  isGameRunning = false;
  currentGame = null;
  overlay.innerHTML = '';
  ctx.clearRect(0, 0, cssWidth, cssHeight); // Очистка канваса
  
  if(clickCounterEl) clickCounterEl.style.display = 'none';
  if(actionHintEl) actionHintEl.style.display = 'none';
  
  // Прячем диалог выхода и прогресс-бар чтобы они не висели в следующей игре
  if(mobileExitDialog) mobileExitDialog.classList.add('hidden');
  if(exitUi) exitUi.classList.add('hidden');

  // Останавливаем таймер
  stopGameTimer();
  
  if (window.gameEngines) {
    Object.values(window.gameEngines).forEach(engine => {
      if(engine.cleanup) engine.cleanup();
    });
  }
}

// ====== ТАЙМЕР: ЛОГИКА ======
const gameTimerBar = document.getElementById('gameTimerBar');
const gameTimerFill = document.getElementById('gameTimerFill');
const timeUpOverlay = document.getElementById('timeUpOverlay');

// Инициализация кнопок выбора времени
document.querySelectorAll('.timer-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.timer-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedMinutes = parseInt(btn.dataset.minutes, 10);
  });
});

function startGameTimer() {
  // Скрыть оверлей времени если был
  if (timeUpOverlay) timeUpOverlay.classList.add('hidden');

  if (selectedMinutes === 0) {
    // Бесконечный режим — без таймера
    if (gameTimerBar) gameTimerBar.classList.add('hidden');
    return;
  }

  const totalMs = selectedMinutes * 60 * 1000;
  gameTimerEnd = Date.now() + totalMs;

  // Показать полоску
  if (gameTimerBar) gameTimerBar.classList.remove('hidden');
  if (gameTimerFill) {
    gameTimerFill.style.transform = 'scaleX(1)';
    gameTimerFill.classList.remove('warning');
  }

  // Обновляем каждую секунду
  gameTimerInterval = setInterval(() => {
    const remaining = gameTimerEnd - Date.now();
    const total = selectedMinutes * 60 * 1000;

    if (remaining <= 0) {
      // Время вышло!
      clearInterval(gameTimerInterval);
      gameTimerInterval = null;
      onTimeUp();
      return;
    }

    const fraction = remaining / total;
    if (gameTimerFill) {
      gameTimerFill.style.transform = `scaleX(${fraction})`;
    }

    // Предупреждение за 30 секунд
    if (remaining <= 30000 && gameTimerFill && !gameTimerFill.classList.contains('warning')) {
      gameTimerFill.classList.add('warning');
    }
  }, 1000);
}

function stopGameTimer() {
  if (gameTimerInterval) {
    clearInterval(gameTimerInterval);
    gameTimerInterval = null;
  }
  if (gameTimerBar) gameTimerBar.classList.add('hidden');
  if (gameTimerFill) gameTimerFill.classList.remove('warning');
  if (timeUpOverlay) timeUpOverlay.classList.add('hidden');
}

function onTimeUp() {
  // Показываем «Отличная работа!»
  if (timeUpOverlay) timeUpOverlay.classList.remove('hidden');
  if (gameTimerBar) gameTimerBar.classList.add('hidden');
  
  // Через 3 секунды — плавный выход
  setTimeout(() => {
    showHome();
  }, 3000);
}

// ====== ЗАЩИТА (ВЫХОД ПО CTRL+SHIFT+Q) ======
let exitProgressTimer = null;
let exitPressCount = 0;
let isLockingDown = false;
const exitUi = document.getElementById('exitProgress');
const exitBar = exitUi.querySelector('.exit-progress-bar');

function updateExitProgress(percent) {
  if (percent > 0) {
    exitUi.classList.remove('hidden');
    exitBar.style.setProperty('--progress', `${percent}%`);
  } else {
    exitUi.classList.add('hidden');
  }
}

const keysHeld = new Set();

// ====== АГРЕССИВНАЯ БЛОКИРОВКА КЛАВИШ ======
// Блокируем ВСЁ что может вывести из игры: F1-F12, Tab, Alt, Ctrl+*, Meta+*
window.addEventListener('keydown', (e) => {
  if (!isGameRunning) return;

  // Блокируем всё кроме Ctrl+Shift+Q (наш выход)
  const dominated =
    e.key === 'Tab' ||
    e.key === 'Escape' ||
    e.key === 'Alt' ||
    e.key === 'Meta' ||
    e.key === 'ContextMenu' ||
    (e.key.startsWith('F') && e.key.length > 1 && e.key.length <= 3) || // F1-F12
    e.ctrlKey || e.metaKey || e.altKey;

  if (dominated) {
    e.preventDefault();
    e.stopPropagation();
  } else {
    e.preventDefault();
  }

  const key = e.key.toLowerCase();
  keysHeld.add(key);

  const isCtrl = keysHeld.has('control');
  const isShift = keysHeld.has('shift');
  const isQ = keysHeld.has('q');

  if (isCtrl && isShift && isQ && !isLockingDown) {
    isLockingDown = true;
    exitPressCount = 0;
    
    updateExitProgress(5);
    exitProgressTimer = setInterval(() => {
      exitPressCount += 5; // Увеличиваем на 5% каждые 150мс (~3 секунды)
      updateExitProgress(exitPressCount);
      
      if (exitPressCount >= 100) {
        clearInterval(exitProgressTimer);
        isLockingDown = false;
        keysHeld.clear();
        updateExitProgress(0);
        showHome();
      }
    }, 150);
  }

  // Передача события в активную логику игры
  if (!isLockingDown && window.gameEngines && window.gameEngines[currentGame] && window.gameEngines[currentGame].onKeyDown) {
    if (!handleUserInput()) return;
    window.gameEngines[currentGame].onKeyDown(e, key, e.code);
  }
});

window.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  keysHeld.delete(key);
  
  if (isLockingDown && (!keysHeld.has('control') || !keysHeld.has('shift') || !keysHeld.has('q'))) {
    isLockingDown = false;
    clearInterval(exitProgressTimer);
    updateExitProgress(0);
  }
});

// ====== ОБРАБОТКА МЫШИ ======
window.addEventListener('mousedown', (e) => {
  if (!isGameRunning) return;
  if (mobileExitDialog && !mobileExitDialog.classList.contains('hidden')) return;
  e.preventDefault();
  if (!handleUserInput()) return;
  if (window.gameEngines && window.gameEngines[currentGame] && window.gameEngines[currentGame].onMouseDown) {
    window.gameEngines[currentGame].onMouseDown(e.clientX, e.clientY);
  }
});

window.addEventListener('mousemove', (e) => {
  if (!isGameRunning) return;
  e.preventDefault();
  if (window.gameEngines && window.gameEngines[currentGame] && window.gameEngines[currentGame].onMouseMove) {
    window.gameEngines[currentGame].onMouseMove(e.clientX, e.clientY);
  }
});

// ====== ОБРАБОТКА ТАЧА (МОБИЛЬНЫЕ) ======
window.addEventListener('touchstart', (e) => {
  if (!isGameRunning) return;
  // Не перехватываем, если открыт диалог выхода — пусть кнопки работают
  if (mobileExitDialog && !mobileExitDialog.classList.contains('hidden')) return;
  e.preventDefault(); // Блокируем зум и скролл в игре
  if (!handleUserInput()) return;
  const touch = e.touches[0];
  if (touch && window.gameEngines && window.gameEngines[currentGame] && window.gameEngines[currentGame].onMouseDown) {
    window.gameEngines[currentGame].onMouseDown(touch.clientX, touch.clientY);
  }
}, { passive: false });

window.addEventListener('touchmove', (e) => {
  if (!isGameRunning) return;
  if (mobileExitDialog && !mobileExitDialog.classList.contains('hidden')) return;
  e.preventDefault();
  const touch = e.touches[0];
  if (touch && window.gameEngines && window.gameEngines[currentGame] && window.gameEngines[currentGame].onMouseMove) {
    window.gameEngines[currentGame].onMouseMove(touch.clientX, touch.clientY);
  }
}, { passive: false });

// ====== БЛОКИРОВКА КОНТЕКСТНОГО МЕНЮ И ПРАВОГО КЛИКА ======
window.addEventListener('contextmenu', (e) => {
  if (isGameRunning) {
    e.preventDefault();
    e.stopPropagation();
  }
});

// ====== МОБИЛЬНЫЙ ВЫХОД (ТРОЙНОЙ ТАП) ======
let mobileExitTaps = [];
const mobileExitZone = document.getElementById('mobileExitZone');
const mobileExitDialog = document.getElementById('mobileExitDialog');
const exitYesBtn = document.getElementById('exitYesBtn');
const exitNoBtn = document.getElementById('exitNoBtn');

function openMobileExitDialog() {
  mobileExitTaps = [];
  mobileExitDialog.classList.remove('hidden');
}

function closeMobileExitDialog() {
  mobileExitDialog.classList.add('hidden');
}
window.closeMobileExit = closeMobileExitDialog;

// Тройной тап по замку
mobileExitZone.addEventListener('touchend', (e) => {
  e.preventDefault();
  e.stopPropagation();
  const now = Date.now();
  mobileExitTaps.push(now);
  mobileExitTaps = mobileExitTaps.filter(t => now - t < 1000);
  if (mobileExitTaps.length >= 3) openMobileExitDialog();
});

mobileExitZone.addEventListener('click', (e) => {
  e.stopPropagation();
  const now = Date.now();
  mobileExitTaps.push(now);
  mobileExitTaps = mobileExitTaps.filter(t => now - t < 1000);
  if (mobileExitTaps.length >= 3) openMobileExitDialog();
});

// --- Кнопки диалога: touchend + click (iOS и десктоп) ---
function handleExitYes(e) {
  e.preventDefault();
  e.stopPropagation();
  closeMobileExitDialog();
  showHome();
}

function handleExitNo(e) {
  e.preventDefault();
  e.stopPropagation();
  closeMobileExitDialog();
}

exitYesBtn.addEventListener('touchend', handleExitYes);
exitYesBtn.addEventListener('click', handleExitYes);
exitNoBtn.addEventListener('touchend', handleExitNo);
exitNoBtn.addEventListener('click', handleExitNo);

// Блокируем любые touch-события внутри диалога (чтобы не проваливались в игру)
mobileExitDialog.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: false });
mobileExitDialog.addEventListener('touchend', (e) => e.stopPropagation(), { passive: false });
mobileExitDialog.addEventListener('click', (e) => e.stopPropagation());

// ====== НАСТРОЙКИ КАНВАСА ======
// Сохраняем CSS-размеры для корректного маппинга координат
let cssWidth = window.innerWidth;
let cssHeight = window.innerHeight;

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  cssWidth = window.innerWidth;
  cssHeight = window.innerHeight;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Глобальный GameLoop для анимаций Canvas
function loop() {
  if (isGameRunning && window.gameEngines && window.gameEngines[currentGame] && window.gameEngines[currentGame].draw) {
    window.gameEngines[currentGame].draw(ctx, cssWidth, cssHeight);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ====== ИГРОВЫЕ ДВИЖКИ ======
window.gameEngines = {};

// ====================================================================
// ИГРА 1: ЗООПАРК НА СТОЛЕ
// ====================================================================
(function() {
  const ANIMALS = [
    { emoji: '🦁', name: 'Лев', color: '#FFB347', sound: 'playRoar' },
    { emoji: '🐘', name: 'Слон', color: '#A0A0C0', sound: 'playRoar' },
    { emoji: '🦊', name: 'Лиса', color: '#FF7043', sound: 'playDog' },
    { emoji: '🐻', name: 'Медведь', color: '#8D6E63', sound: 'playRoar' },
    { emoji: '🐸', name: 'Лягушка', color: '#66BB6A', sound: 'playFrog' },
    { emoji: '🦄', name: 'Единорог', color: '#CE93D8', sound: 'playMagic' },
    { emoji: '🐧', name: 'Пингвин', color: '#42A5F5', sound: 'playBird' },
    { emoji: '🦋', name: 'Бабочка', color: '#AB47BC', sound: 'playChime' },
    { emoji: '🐶', name: 'Собака', color: '#FFCC80', sound: 'playDog' },
    { emoji: '🐱', name: 'Кошка', color: '#FFB74D', sound: 'playCat' },
    { emoji: '🐰', name: 'Зайка', color: '#F48FB1', sound: 'playChime' },
    { emoji: '🦉', name: 'Сова', color: '#A1887F', sound: 'playBird' },
    { emoji: '🐢', name: 'Черепаха', color: '#81C784', sound: 'playBubble' },
    { emoji: '🦜', name: 'Попугай', color: '#EF5350', sound: 'playBird' },
    { emoji: '🐬', name: 'Дельфин', color: '#29B6F6', sound: 'playDolphin' },
    { emoji: '🦒', name: 'Жираф', color: '#FFF176', sound: 'playChime' },
    { emoji: '🐝', name: 'Пчёлка', color: '#FFEB3B', sound: 'playBuzz' },
    { emoji: '🦀', name: 'Краб', color: '#FF7043', sound: 'playBubble' },
    { emoji: '🐙', name: 'Осьминог', color: '#7E57C2', sound: 'playBubble' },
    { emoji: '🦩', name: 'Фламинго', color: '#F06292', sound: 'playBird' },
  ];

  let particles = [];
  let paws = [];
  const PAW_EMOJI = '🐾';

  // --- Динамический фон ---
  let bgHeat = 0;          // Уровень «активности» (0-1)
  let bgHue = 0;           // Текущий оттенок фона (0-360)
  let recentColors = [];    // Последние цвета животных для градиента

  function randomPos() {
    return {
      x: 80 + Math.random() * (cssWidth - 160),
      y: 80 + Math.random() * (cssHeight - 160)
    };
  }

  function spawnAnimal(x, y) {
    const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];

    // --- DOM-элемент ---
    const el = document.createElement('div');
    el.className = 'zoo-animal';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.innerHTML = `
      <span class="zoo-emoji">${animal.emoji}</span>
      <span class="zoo-name">${animal.name}</span>
    `;
    overlay.appendChild(el);

    setTimeout(() => {
      el.classList.add('zoo-animal-out');
      setTimeout(() => el.remove(), 500);
    }, 2500); // 2.5с жизни + 0.5с fade = 3с

    // --- Частицы (больше и крупнее) ---
    for (let i = 0; i < 18; i++) {
      const angle = (Math.PI * 2 / 18) * i + (Math.random() * 0.3);
      const speed = 3 + Math.random() * 6;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 5 + Math.random() * 10,
        color: animal.color,
        alpha: 1,
        decay: 0.012 + Math.random() * 0.008
      });
    }

    // --- Звук КОНКРЕТНОГО животного ---
    if (AudioSynth[animal.sound]) {
      AudioSynth[animal.sound]();
    }

    // --- Подкручиваем фон ---
    bgHeat = Math.min(1.5, bgHeat + 0.35); // Больший шаг нагрева
    bgHue = (bgHue + 30 + Math.random() * 40) % 360;
    recentColors.push(animal.color);
    if (recentColors.length > 5) recentColors.shift();
  }

  function spawnPaw(x, y) {
    paws.push({
      x, y,
      alpha: 0.7,
      size: 30 + Math.random() * 15,
      rotation: Math.random() * 0.5 - 0.25
    });
    if (paws.length > 80) paws.splice(0, 10);

    // Лёгкий прирост фона от движения
    bgHeat = Math.min(1, bgHeat + 0.003);
  }

  window.gameEngines.zoo = {
    init() {
      particles = [];
      paws = [];
      bgHeat = 0;
      bgHue = 200;
      recentColors = [];
    },

    cleanup() {
      particles = [];
      paws = [];
      recentColors = [];
    },

    onKeyDown(e, key) {
      const pos = randomPos();
      spawnAnimal(pos.x, pos.y);
    },

    onMouseDown(mx, my) {
      // Спавним в СЛУЧАЙНОМ месте (как в референсе), а не под курсором
      const pos = randomPos();
      spawnAnimal(pos.x, pos.y);
    },

    onMouseMove(x, y) {
      spawnPaw(x, y);
    },

    draw(ctx, w, h) {
      // === ДИНАМИЧЕСКИЙ ФОН ===
      // Базовый тёмный цвет, но с градиентом зависящим от bgHeat
      if (bgHeat > 0.01) {
        // Рисуем красивый радиальный градиент по центру
        const centerX = w / 2;
        const centerY = h / 2;
        const radius = Math.max(w, h) * (0.4 + Math.min(1, bgHeat) * 0.6);

        const grad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
        
        const alpha = Math.min(0.85, bgHeat * 0.5); // Ярче
        const c1 = `hsla(${bgHue}, 80%, 45%, ${alpha})`;
        const c2 = `hsla(${(bgHue + 60) % 360}, 75%, 30%, ${alpha * 0.6})`;
        const c3 = `rgba(13, 17, 23, 0)`;

        grad.addColorStop(0, c1);
        grad.addColorStop(0.6, c2);
        grad.addColorStop(1, c3);

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // Второй блуждающий градиент для цветового разнообразия
        if (recentColors.length > 0) {
          const t = Date.now() / 1000;
          const gx = w * (0.3 + Math.sin(t * 0.5) * 0.4);
          const gy = h * (0.4 + Math.cos(t * 0.7) * 0.3);
          const grad2 = ctx.createRadialGradient(gx, gy, 0, gx, gy, radius * 0.7);
          const hue2 = (bgHue + 120) % 360;
          grad2.addColorStop(0, `hsla(${hue2}, 70%, 40%, ${Math.min(0.6, bgHeat * 0.35)})`);
          grad2.addColorStop(1, `hsla(${hue2}, 70%, 40%, 0)`);
          ctx.fillStyle = grad2;
          ctx.fillRect(0, 0, w, h);
        }
      }

      // Затухание
      ctx.fillStyle = `rgba(13, 17, 23, ${0.15 + Math.max(0, 1 - bgHeat) * 0.2})`;
      ctx.fillRect(0, 0, w, h);

      // Плавное затухание фона (быстрее)
      bgHeat *= 0.94;

      // --- Лапки ---
      for (let i = paws.length - 1; i >= 0; i--) {
        const p = paws[i];
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.font = `${p.size}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(PAW_EMOJI, 0, 0);
        ctx.restore();

        p.alpha -= 0.006;
        if (p.alpha <= 0) paws.splice(i, 1);
      }

      // --- Частицы ---
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.fill();
        ctx.globalAlpha = 1;

        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.08;
        p.alpha -= p.decay;

        if (p.alpha <= 0) particles.splice(i, 1);
      }
    }
  };
})();


// ====================================================================
// ИГРА 2: ЦВЕТОЧНАЯ ПОЛЯНА
// ====================================================================
(function() {
  const FLOWERS = [
    { emoji: '🌸', name: 'Сакура', color: '#FFB7C5' },
    { emoji: '🌺', name: 'Гибискус', color: '#FF6B81' },
    { emoji: '🌷', name: 'Тюльпан', color: '#FF4757' },
    { emoji: '🌻', name: 'Подсолнух', color: '#FECA57' },
    { emoji: '🌹', name: 'Роза', color: '#EE5A24' },
    { emoji: '🏵️', name: 'Розетка', color: '#F8A5C2' },
    { emoji: '💐', name: 'Букет', color: '#C44569' },
    { emoji: '🌼', name: 'Ромашка', color: '#FFF200' },
    { emoji: '🪷', name: 'Лотос', color: '#FDA7DF' },
    { emoji: '🌿', name: 'Листик', color: '#2ECC71' },
  ];

  let petals = [];     // Частицы-лепестки
  let stems = [];      // Точки стебельков
  let bgHeat = 0;
  let bgHue = 120;     // Зелёный старт

  function randomFlower() {
    return FLOWERS[Math.floor(Math.random() * FLOWERS.length)];
  }

  function spawnFlower(x, y) {
    const flower = randomFlower();
    const el = document.createElement('div');
    el.className = 'flower-bloom';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.innerHTML = `
      <span class="flower-emoji">${flower.emoji}</span>
      <span class="flower-name">${flower.name}</span>
    `;
    overlay.appendChild(el);

    setTimeout(() => {
      el.classList.add('flower-fade');
      setTimeout(() => el.remove(), 500);
    }, 3000);

    // Лепестки-частицы
    for (let i = 0; i < 12; i++) {
      const angle = (Math.PI * 2 / 12) * i + Math.random() * 0.4;
      petals.push({
        x, y,
        vx: Math.cos(angle) * (1.5 + Math.random() * 3),
        vy: -1 - Math.random() * 3, // Вверх!
        radius: 3 + Math.random() * 6,
        color: flower.color,
        alpha: 1,
        decay: 0.008 + Math.random() * 0.006
      });
    }

    AudioSynth.playChime();

    bgHeat = Math.min(1.5, bgHeat + 0.2);
    bgHue = (bgHue + 15) % 360;
  }

  function spawnBouquet() {
    const x = 100 + Math.random() * (cssWidth - 200);
    const y = 100 + Math.random() * (cssHeight - 200);
    const count = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const ox = x + (Math.random() - 0.5) * 120;
      const oy = y + (Math.random() - 0.5) * 100;
      setTimeout(() => spawnFlower(ox, oy), i * 80);
    }
    AudioSynth.playChord();
  }

  function addStem(x, y) {
    stems.push({ x, y, alpha: 0.8, size: 3 + Math.random() * 2 });
    if (stems.length > 300) stems.splice(0, 20);
    bgHeat = Math.min(1, bgHeat + 0.002);
  }

  window.gameEngines.flowers = {
    init() {
      petals = [];
      stems = [];
      bgHeat = 0;
      bgHue = 120;
    },
    cleanup() {
      petals = [];
      stems = [];
    },
    onKeyDown(e, key) {
      spawnBouquet();
    },
    onMouseDown(mx, my) {
      // Спавним в СЛУЧАЙНОМ месте (как в Зоопарке) — так веселее!
      const pos = { x: 80 + Math.random() * (cssWidth - 160), y: 80 + Math.random() * (cssHeight - 160) };
      spawnFlower(pos.x, pos.y);
    },
    onMouseMove(x, y) {
      addStem(x, y);
    },
    draw(ctx, w, h) {
      // === Динамический фон (зелёный → розовый при активности) ===
      if (bgHeat > 0.01) {
        const grad = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, Math.max(w,h) * 0.7);
        const alpha = Math.min(0.7, bgHeat * 0.4);
        grad.addColorStop(0, `hsla(${bgHue}, 60%, 25%, ${alpha})`);
        grad.addColorStop(0.6, `hsla(${(bgHue + 60) % 360}, 50%, 18%, ${alpha * 0.5})`);
        grad.addColorStop(1, 'rgba(13,17,23,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }

      // Затухание
      ctx.fillStyle = `rgba(13, 17, 23, ${0.12 + Math.max(0, 1 - bgHeat) * 0.15})`;
      ctx.fillRect(0, 0, w, h);
      bgHeat *= 0.96;

      // --- Стебельки (зелёные точки-линии) ---
      for (let i = stems.length - 1; i >= 0; i--) {
        const s = stems[i];
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(46, 204, 113, ${s.alpha})`;
        ctx.fill();

        // Соединяем с предыдущей точкой для линии
        if (i > 0) {
          const prev = stems[i - 1];
          const dist = Math.hypot(s.x - prev.x, s.y - prev.y);
          if (dist < 50) {
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(s.x, s.y);
            ctx.strokeStyle = `rgba(46, 204, 113, ${s.alpha * 0.5})`;
            ctx.lineWidth = s.size * 0.8;
            ctx.lineCap = 'round';
            ctx.stroke();
          }
        }

        s.alpha -= 0.003;
        if (s.alpha <= 0) stems.splice(i, 1);
      }

      // --- Лепестки-частицы (летят вверх) ---
      for (let i = petals.length - 1; i >= 0; i--) {
        const p = petals[i];
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.fill();
        ctx.globalAlpha = 1;

        p.x += p.vx;
        p.y += p.vy;
        p.vy -= 0.02; // лёгкая «гравитация вверх» — лепестки летят
        p.vx *= 0.99;
        p.alpha -= p.decay;

        if (p.alpha <= 0) petals.splice(i, 1);
      }
    }
  };
})();


// ====================================================================
// ИГРА 3: МУЗЫКАЛЬНЫЙ ОТДЕЛ (Светящееся Пианино)
// ====================================================================
(function() {
  const NOTE_EMOJIS = ['🎵', '🎶', '🎼', '🎹', '🎷', '🎺', '🥁'];
  const DANCE_ANIMALS = ['🐱', '🐶', '🦄', '🐬', '🦋'];

  // Пентатоника для гармоничного звучания
  const PENTATONIC = [
    261.63, 293.66, 329.63, 392.00, 440.00,
    523.25, 587.33, 659.25, 783.99, 880.00,
    1046.50, 1174.66, 1318.51
  ];

  const NUM_KEYS = 9;

  // Эмодзи для каждой клавиши (вместо букв — дети их не знают!)
  const KEY_EMOJIS = ['🐱', '🐶', '🐸', '🦊', '🐼', '🐬', '🦋', '🐧', '🦄'];

  // Маппим ВСЮ клавиатуру по горизонтальным регионам.
  // Каждый ряд разбит на 9 зон по позиции клавиши слева направо.
  const ALL_KEY_CODES = {
    // Ряд цифр
    'Backquote': 0, 'Digit1': 0, 'Digit2': 1, 'Digit3': 1, 'Digit4': 2,
    'Digit5': 3, 'Digit6': 3, 'Digit7': 4, 'Digit8': 5, 'Digit9': 6,
    'Digit0': 7, 'Minus': 7, 'Equal': 8, 'Backspace': 8,
    // Ряд QWERTY
    'Tab': 0, 'KeyQ': 0, 'KeyW': 1, 'KeyE': 2, 'KeyR': 2,
    'KeyT': 3, 'KeyY': 4, 'KeyU': 5, 'KeyI': 5, 'KeyO': 6,
    'KeyP': 7, 'BracketLeft': 7, 'BracketRight': 8, 'Backslash': 8,
    // Ряд ASDF (домашний)
    'CapsLock': 0, 'KeyA': 0, 'KeyS': 1, 'KeyD': 2, 'KeyF': 3,
    'KeyG': 3, 'KeyH': 4, 'KeyJ': 5, 'KeyK': 6, 'KeyL': 7,
    'Semicolon': 7, 'Quote': 8, 'Enter': 8,
    // Ряд ZXCV
    'KeyZ': 0, 'KeyX': 1, 'KeyC': 2, 'KeyV': 3,
    'KeyB': 4, 'KeyN': 5, 'KeyM': 6, 'Comma': 7,
    'Period': 7, 'Slash': 8,
    // Пробел — средняя нота
    'Space': 4
  };
  
  // Аналоговая мягкая палитра (от теплого персикового до глубокого фиолетового)
  const KEY_COLORS = [
    { base: '#FF9A9E', highlight: '#FECFEF' }, // Peach / Light pink
    { base: '#FECFEF', highlight: '#F4E2D8' }, // Light pink / Cream
    { base: '#A18CD1', highlight: '#FBC2EB' }, // Purple / Pinkish
    { base: '#FBC2EB', highlight: '#A18CD1' }, // Pink / Purple
    { base: '#84FAB0', highlight: '#8FD3F4' }, // Mint / Light Blue
    { base: '#8FD3F4', highlight: '#84FAB0' }, // Light Blue / Mint
    { base: '#A6C0FE', highlight: '#F68084' }, // Blue / Rose
    { base: '#F68084', highlight: '#A6C0FE' }, // Rose / Blue
    { base: '#FF0844', highlight: '#FFB199' }  // Deep Rose / Peach
  ];

  let keyStates = [];   // Уровень свечения клавиш (0.0 to 1.0)
  let floatingNotes = []; 
  let bgHeat = 0;       

  function spawnFloatingNote(keyIndex, startX, startY) {
    const emoji = Math.random() > 0.7 
      ? DANCE_ANIMALS[Math.floor(Math.random() * DANCE_ANIMALS.length)]
      : NOTE_EMOJIS[Math.floor(Math.random() * NOTE_EMOJIS.length)];

    floatingNotes.push({
      x: startX,
      y: startY,
      emoji: emoji,
      vx: (Math.random() - 0.5) * 3 + (keyIndex - NUM_KEYS/2) * 0.5,
      vy: -5 - Math.random() * 6,
      alpha: 1,
      size: 50 + Math.random() * 30,
      color: KEY_COLORS[keyIndex % KEY_COLORS.length].base,
      rot: (Math.random() - 0.5) * 60
    });
  }

  function triggerKey(index) {
    if (index < 0 || index >= NUM_KEYS) return;
    
    // Вспышка
    keyStates[index] = 1.0; 
    AudioSynth.playNote(PENTATONIC[index]);

    const keyWidth = cssWidth / NUM_KEYS;
    const keyHeight = Math.min(cssHeight * 0.75, 800);
    const keyX = index * keyWidth;
    const keyY = cssHeight - keyHeight;
    const centerX = keyX + keyWidth / 2;

    spawnFloatingNote(index, centerX, keyY + 40);

    bgHeat = Math.min(1.0, bgHeat + 0.15);
  }

  window.gameEngines.music = {
    init() {
      floatingNotes = [];
      keyStates = Array(NUM_KEYS).fill(0);
      bgHeat = 0;
    },
    cleanup() {
      floatingNotes = [];
    },
    onKeyDown(e, key, code) {
      // Ищем физический код клавиши в нашей карте регионов
      const idx = ALL_KEY_CODES[code];
      if (idx !== undefined) {
        triggerKey(idx);
      }
    },
    onMouseDown(mx, my) {
      const keyHeight = Math.min(cssHeight * 0.75, 800);
      if (my >= cssHeight - keyHeight) {
        const keyWidth = cssWidth / NUM_KEYS;
        const idx = Math.floor(mx / keyWidth);
        triggerKey(idx);
      }
    },
    onMouseMove(x, y) {
      const keyHeight = Math.min(cssHeight * 0.75, 800);
      if (y >= cssHeight - keyHeight) {
        // Легкая реакция при проведении пальцем по клавишам
        const keyWidth = cssWidth / NUM_KEYS;
        const idx = Math.floor(x / keyWidth);
        if (idx >= 0 && idx < NUM_KEYS && keyStates[idx] < 0.2) {
          keyStates[idx] = 0.5; // Полу-свечение без звука для тактильности
          bgHeat = Math.min(1.0, bgHeat + 0.02);
        }
      }
    },
    draw(ctx, w, h) {
      // === Темный фон (чтобы клавиши сияли) ===
      ctx.fillStyle = '#1e1e2f';
      ctx.fillRect(0, 0, w, h);

      // Легкий неоновый туман от нажатий
      if (bgHeat > 0.01) {
        let maxIdx = 0;
        let maxVal = 0;
        for (let i = 0; i < NUM_KEYS; i++) {
          if (keyStates[i] > maxVal) {
            maxVal = keyStates[i];
            maxIdx = i;
          }
        }
        
        ctx.globalAlpha = bgHeat * 0.4;
        const grad = ctx.createRadialGradient(w/2, h*(1 - bgHeat*0.2), 0, w/2, h/2, Math.max(w,h) * 0.8);
        grad.addColorStop(0, KEY_COLORS[maxIdx % KEY_COLORS.length].base);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      }
      bgHeat *= 0.96;

      // --- Плавающие ноты/эмодзи ---
      for (let i = floatingNotes.length - 1; i >= 0; i--) {
        const n = floatingNotes[i];
        ctx.save();
        ctx.globalAlpha = n.alpha;
        ctx.translate(n.x, n.y);
        ctx.rotate((n.rot * Math.PI) / 180);
        ctx.font = `${n.size}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Мощная тень для магии
        ctx.shadowColor = n.color;
        ctx.shadowBlur = 30;
        ctx.fillText(n.emoji, 0, 0);
        ctx.restore();

        n.x += n.vx;
        n.y += n.vy;
        n.vy += 0.1; // Гравитация (чтобы чуть медленнее улетали в космос)
        n.alpha -= 0.012;
        if (n.alpha <= 0) floatingNotes.splice(i, 1);
      }

      // --- Клавиши (Giant Candy Keys) ---
      const keyHeight = Math.min(h * 0.75, 800);
      const keyWidth = w / NUM_KEYS;
      const keyY = h - keyHeight;

      for (let i = 0; i < NUM_KEYS; i++) {
        const kx = i * keyWidth;
        const state = keyStates[i]; // от 0 до 1
        const colorBase = KEY_COLORS[i % KEY_COLORS.length].base;
        const colorHigh = KEY_COLORS[i % KEY_COLORS.length].highlight;

        // Рисуем базовую 3D-кнопку
        const padding = keyWidth > 50 ? 6 : 2;
        const radius = keyWidth > 50 ? 24 : 10;
        const innerX = kx + padding;
        const innerY = keyY + (state * 10); // Эффект проминания при нажатии
        const innerW = keyWidth - padding * 2;
        const innerH = keyHeight - padding * 2;

        ctx.save();
        
        // Яркий градиент
        const keyGrad = ctx.createLinearGradient(innerX, innerY, innerX, innerY + innerH);
        
        if (state > 0.1) {
          // Состояние "Нажата" (Взрыв цвета)
          keyGrad.addColorStop(0, '#FFFFFF'); // Белый блик сверху
          keyGrad.addColorStop(0.2, colorHigh);
          keyGrad.addColorStop(1, colorBase);
          
          ctx.shadowColor = colorBase;
          ctx.shadowBlur = 40 + (state * 40);
        } else {
          // Состояние "Отпущена" (Матовая конфета)
          keyGrad.addColorStop(0, colorHigh);
          keyGrad.addColorStop(0.5, colorBase);
          // Нижняя часть темнее для объема
          ctx.shadowColor = 'rgba(0,0,0,0.5)';
          ctx.shadowBlur = 10;
          ctx.shadowOffsetY = 5;
        }

        ctx.beginPath();
        ctx.roundRect(innerX, innerY, innerW, innerH, radius);
        ctx.fillStyle = keyGrad;
        ctx.fill();

        // Внутренний стеклянный блик (Glassmorphism highlight)
        ctx.beginPath();
        ctx.roundRect(innerX + 4, innerY + 4, innerW - 8, innerH * 0.2, radius - 4);
        const glassGrad = ctx.createLinearGradient(innerX, innerY, innerX, innerY + innerH * 0.2);
        glassGrad.addColorStop(0, `rgba(255,255,255, ${0.4 + state * 0.4})`);
        glassGrad.addColorStop(1, 'rgba(255,255,255, 0)');
        ctx.fillStyle = glassGrad;
        ctx.fill();

        // Эмодзи-бейдж (вместо букв, т.к. дети не умеют читать)
        if (keyWidth > 15) {
          const badgeSize = Math.min(keyWidth * 0.65, 60);
          const badgeY = innerY + badgeSize * 0.7;
          
          // Белый кружочек-подложка
          ctx.beginPath();
          ctx.arc(innerX + innerW/2, badgeY, badgeSize/2, 0, Math.PI*2);
          ctx.fillStyle = `rgba(255,255,255, ${0.85 + state * 0.15})`;
          ctx.shadowColor = 'rgba(0,0,0,0.2)';
          ctx.shadowBlur = 5;
          ctx.shadowOffsetY = 2;
          ctx.fill();

          // Эмодзи животного
          ctx.shadowColor = 'transparent';
          ctx.font = `${badgeSize * 0.55}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(KEY_EMOJIS[i], innerX + innerW/2, badgeY);
        }

        ctx.restore();

        // Затухание состояния
        keyStates[i] *= 0.85;
      }
    }
  };
})();


// ====================================================================
// ИГРА 4: ВАЖНЫЙ ОТЧЁТ (v2 — child-friendly rework)
// ====================================================================
(function() {
  const ANIMALS = ['🐱', '🐶', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🦄', '🐧', '🐬', '🐝', '🦋'];
  const STAMPS = ['ОДОБРЕНО', 'ВАЖНО!', 'КЛАСС!', 'СУПЕР!', 'ОК!', '5+', 'ДА!'];
  const INK_COLORS = ['#E74C3C', '#3498DB', '#2ECC71', '#9B59B6', '#F39C12', '#1ABC9C', '#E91E63', '#FF5722'];

  let scribbles = [];    // Каракули за мышью (жирный след)
  let splatters = [];    // Кляксы на бумаге (permanent)
  let inkHeat = 0;       // Насколько „заляпан" лист

  function randomPos() {
    return {
      x: 100 + Math.random() * (cssWidth - 200),
      y: 100 + Math.random() * (cssHeight - 200)
    };
  }

  function randomInkColor() {
    return INK_COLORS[Math.floor(Math.random() * INK_COLORS.length)];
  }

  // Клавиша → огромный эмодзи + рамка "ОДОБРЕНО" вокруг
  function spawnApproval() {
    const pos = randomPos();
    const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    const stamp = STAMPS[Math.floor(Math.random() * STAMPS.length)];

    // Большой эмодзи
    const el = document.createElement('div');
    el.className = 'report-approved';
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    
    const rot = (Math.random() - 0.5) * 20;
    el.innerHTML = `
      <span class="report-animal">${animal}</span>
      <span class="report-label">${stamp}</span>
    `;
    el.style.setProperty('--rot', `${rot}deg`);
    overlay.appendChild(el);

    setTimeout(() => {
      el.classList.add('report-approved-out');
      setTimeout(() => el.remove(), 500);
    }, 3000);

    // Звук
    AudioSynth.playStamp();

    // Добавляем кляксу на canvas (permanent stain)
    const color = randomInkColor();
    splatters.push({
      x: pos.x, y: pos.y,
      radius: 40 + Math.random() * 30,
      color: color,
      alpha: 0.15 + Math.random() * 0.1
    });

    // Разлетающиеся чернильные точки
    for (let i = 0; i < 12; i++) {
      const angle = (Math.PI * 2 / 12) * i + Math.random() * 0.5;
      const speed = 3 + Math.random() * 5;
      splatters.push({
        x: pos.x + Math.cos(angle) * (20 + Math.random() * 40),
        y: pos.y + Math.sin(angle) * (20 + Math.random() * 40),
        radius: 3 + Math.random() * 8,
        color: color,
        alpha: 0.2 + Math.random() * 0.15
      });
    }

    inkHeat = Math.min(1, inkHeat + 0.15);
  }

  // Клик → взрыв чернильного кольца + печать
  function spawnInkBurst(x, y) {
    const stamp = STAMPS[Math.floor(Math.random() * STAMPS.length)];
    const color = randomInkColor();
    const rot = (Math.random() - 0.5) * 30;

    // DOM-штамп
    const el = document.createElement('div');
    el.className = 'report-stamp';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.innerHTML = `🐾<br>${stamp}`;
    el.style.borderColor = color;
    el.style.color = color;
    el.style.transform = `translate(-50%, -50%) scale(2.5) rotate(${rot}deg)`;
    overlay.appendChild(el);

    AudioSynth.playStamp();

    requestAnimationFrame(() => {
      el.style.transition = 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)';
      el.style.transform = `translate(-50%, -50%) scale(1) rotate(${rot}deg)`;
    });

    setTimeout(() => {
      el.classList.add('report-stamp-out');
      setTimeout(() => el.remove(), 3000);
    }, 2000);

    // Взрыв DOM-капель
    for (let i = 0; i < 10; i++) {
      const drop = document.createElement('div');
      drop.className = 'ink-splash';
      drop.style.left = `${x}px`;
      drop.style.top = `${y}px`;
      drop.style.backgroundColor = color;
      const angle = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 80;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;
      overlay.appendChild(drop);
      requestAnimationFrame(() => {
        drop.style.transform = `translate(${dx}px, ${dy}px) scale(${1.5 + Math.random()})`;
        drop.style.opacity = '0';
      });
      setTimeout(() => drop.remove(), 800);
    }

    // Canvas кляксы (permanent)
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 15 + Math.random() * 60;
      splatters.push({
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        radius: 4 + Math.random() * 12,
        color: color,
        alpha: 0.2 + Math.random() * 0.15
      });
    }

    inkHeat = Math.min(1, inkHeat + 0.2);
  }

  // Мышь → толстый каракулевый след
  function addScribble(x, y) {
    const color = randomInkColor();
    scribbles.push({
      x: x + (Math.random() - 0.5) * 8,
      y: y + (Math.random() - 0.5) * 8,
      radius: 4 + Math.random() * 6,
      color: color,
      alpha: 0.6
    });
    if (scribbles.length > 500) scribbles.splice(0, 30);
    inkHeat = Math.min(1, inkHeat + 0.003);
  }

  window.gameEngines.report = {
    init() {
      scribbles = [];
      splatters = [];
      inkHeat = 0;
    },
    cleanup() {
      scribbles = [];
      splatters = [];
    },
    onKeyDown(e, key) {
      spawnApproval();
    },
    onMouseDown(mx, my) {
      // Спавним в СЛУЧАЙНОМ месте (как в Зоопарке)
      const pos = randomPos();
      spawnInkBurst(pos.x, pos.y);
    },
    onMouseMove(x, y) {
      addScribble(x, y);
    },
    draw(ctx, w, h) {
      // === Фон-бумага ===
      ctx.fillStyle = '#F5F0E8';
      ctx.fillRect(0, 0, w, h);

      // Линейки
      ctx.strokeStyle = 'rgba(127, 143, 166, 0.25)';
      ctx.lineWidth = 1;
      for (let y = 70; y < h; y += 55) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Красная линия полей
      ctx.strokeStyle = 'rgba(232, 65, 24, 0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(45, 0);
      ctx.lineTo(45, h);
      ctx.stroke();

      // --- Постоянные кляксы (то что остается на бумаге) ---
      for (let i = 0; i < splatters.length; i++) {
        const s = splatters[i];
        ctx.globalAlpha = s.alpha;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Лимит клякс чтобы не замедляло
      if (splatters.length > 300) splatters.splice(0, 50);

      // --- Каракули (исчезающий рис-торт) ---
      for (let i = scribbles.length - 1; i >= 0; i--) {
        const s = scribbles[i];
        ctx.globalAlpha = s.alpha;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx.fill();

        // Соединяем соседние точки в линию
        if (i > 0) {
          const prev = scribbles[i - 1];
          const dist = Math.hypot(s.x - prev.x, s.y - prev.y);
          if (dist < 40) {
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(s.x, s.y);
            ctx.strokeStyle = s.color;
            ctx.lineWidth = s.radius * 1.5;
            ctx.lineCap = 'round';
            ctx.stroke();
          }
        }

        s.alpha -= 0.004;
        if (s.alpha <= 0) scribbles.splice(i, 1);
      }
      ctx.globalAlpha = 1;
    }
  };
})();

