// ====================================================================
// Web Audio API — Мелодичный синтезатор «Музыкальная шкатулка»
// Все звуки построены на пентатонике для гармоничного звучания
// ====================================================================
let audioCtx = null;
let soundEnabled = true;

// Ленивая инициализация AudioContext (iOS требует user gesture)
function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// Разморозка при первом взаимодействии (на iOS обязательно)
// + обход аппаратного переключателя «Без звука» на iPhone:
//   играем тихий <audio> loop → Safari переключается в media-playback режим
let silentAudio = null;

function unlockAudio() {
  // 1. Создаём/резюмим Web Audio Context
  getAudioCtx();

  // 2. Обход беззвучного режима iPhone:
  //    тихий зацикленный <audio> заставляет Safari играть звук даже при mute switch
  if (!silentAudio) {
    // Тишина 0.5с в формате WAV, base64 (44 байта PCM)
    silentAudio = new Audio(
      'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='
    );
    silentAudio.loop = true;
    silentAudio.volume = 0.01; // Практически не слышно
    silentAudio.play().catch(() => {}); // Игнорируем ошибку если не удалось
  }

  // 3. Играем тихий буфер через Web Audio (ещё один способ разблокировки)
  try {
    const ctx = getAudioCtx();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch(e) {}

  document.removeEventListener('touchstart', unlockAudio, true);
  document.removeEventListener('touchend', unlockAudio, true);
  document.removeEventListener('click', unlockAudio, true);
}
document.addEventListener('touchstart', unlockAudio, true);
document.addEventListener('touchend', unlockAudio, true);
document.addEventListener('click', unlockAudio, true);

// Пентатоника C мажор — любые ноты из неё звучат вместе красиво
const PENTATONIC = [
  261.63, 293.66, 329.63, 392.00, 440.00,  // C4, D4, E4, G4, A4
  523.25, 587.33, 659.25, 783.99, 880.00,  // C5, D5, E5, G5, A5
  1046.50, 1174.66, 1318.51                // C6, D6, E6
];

function randomNote() {
  return PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)];
}

const AudioSynth = {
  enable() {
    soundEnabled = true;
    getAudioCtx(); // Создаём/резюмим контекст
  },
  disable() { soundEnabled = false; },

  // ---- Утилита: мягкий осциллятор с атакой и затуханием ----
  _soft(type, freq, duration, volume = 0.15, attackTime = 0.02) {
    if (!soundEnabled) return;
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    // Мягкая атака (не щелчок!)
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(volume, t + attackTime);
    // Плавное затухание
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + duration);
  },

  // ---- Утилита: «колокольчик» — основной тон + обертон ----
  _bell(freq, duration = 0.8, volume = 0.12) {
    if (!soundEnabled) return;
    this._soft('sine', freq, duration, volume, 0.01);
    this._soft('sine', freq * 2, duration * 0.6, volume * 0.3, 0.01);     // Октава
    this._soft('sine', freq * 3, duration * 0.3, volume * 0.1, 0.01);     // Квинта сверху
  },

  // ---- Утилита: арпеджио из N нот ----
  _arpeggio(notes, interval = 70, duration = 0.6, volume = 0.1) {
    if (!soundEnabled) return;
    notes.forEach((freq, i) => {
      setTimeout(() => this._bell(freq, duration, volume), i * interval);
    });
  },

  // ==================================================================
  // МЕЛОДИЧНЫЕ ЗВУКИ ДЛЯ ЗООПАРКА
  // ==================================================================

  // 🎵 Мелодичный звон (основной, для бабочки, зайки, жирафа)
  playChime() {
    const note = randomNote();
    this._bell(note, 1.0, 0.15);
  },

  // 🐱 Кошка — мягкое «мяу» через глиссандо + колокольчик
  playCat() {
    if (!soundEnabled) return;
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    // Глиссандо вверх-вниз (мяу)
    o.frequency.setValueAtTime(400, t);
    o.frequency.linearRampToValueAtTime(700, t + 0.12);
    o.frequency.linearRampToValueAtTime(350, t + 0.35);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + 0.45);
    // Мелодичная «нотка» сверху
    this._bell(659.25, 0.5, 0.08); // E5
  },

  // 🐶 Собака — два коротких тона + весёлый звон
  playDog() {
    if (!soundEnabled) return;
    this._soft('triangle', 350, 0.12, 0.2, 0.005);
    setTimeout(() => {
      this._soft('triangle', 420, 0.1, 0.18, 0.005);
      this._bell(523.25, 0.5, 0.08); // C5
    }, 130);
  },

  // 🦁🐘🐻 Рычание — низкий мелодичный бас + обертон
  playRoar() {
    if (!soundEnabled) return;
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle'; // Мягче чем sawtooth
    o.frequency.setValueAtTime(100, t);
    o.frequency.linearRampToValueAtTime(160, t + 0.15);
    o.frequency.linearRampToValueAtTime(80, t + 0.5);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + 0.55);
    // Мелодичный обертон
    this._bell(261.63, 0.4, 0.06); // C4
  },

  // 🐦🦜🦉🐧 Птица — быстрое арпеджио вверх (чириканье)
  playBird() {
    const base = 5 + Math.floor(Math.random() * 5); // Индекс в верхней пентатонике
    const notes = [
      PENTATONIC[base],
      PENTATONIC[Math.min(base + 1, PENTATONIC.length - 1)],
      PENTATONIC[Math.min(base + 2, PENTATONIC.length - 1)]
    ];
    this._arpeggio(notes, 60, 0.3, 0.1);
  },

  // 🐸 Лягушка — низкий «квак» + звонкий отскок
  playFrog() {
    if (!soundEnabled) return;
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(350, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.12);
    o.frequency.linearRampToValueAtTime(200, t + 0.2);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.15, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + 0.25);
    setTimeout(() => this._bell(440, 0.3, 0.07), 100);
  },

  // 🐬 Дельфин — мелодичный свист вверх-вниз
  playDolphin() {
    if (!soundEnabled) return;
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(600, t);
    o.frequency.exponentialRampToValueAtTime(1400, t + 0.12);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.3);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + 0.4);
    this._bell(1318.51, 0.4, 0.05);
  },

  // 🐝 Пчёлка — мягкое жужжание + мелодичный тон
  playBuzz() {
    if (!soundEnabled) return;
    this._soft('triangle', 180, 0.25, 0.06, 0.02);
    this._soft('sine', 360, 0.2, 0.04, 0.02);
    setTimeout(() => this._bell(880, 0.3, 0.06), 80); // A5
  },

  // 🦄 Единорог/Магия — волшебное арпеджио вверх (как арфа)
  playMagic() {
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    this._arpeggio(notes, 80, 0.8, 0.1);
  },

  // 🐙🦀🐢 Бульканье — мягкие случайные ноты
  playBubble() {
    const count = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        this._bell(randomNote(), 0.2, 0.07);
      }, i * 70);
    }
  },

  // ==================================================================
  // СЕРВИСНЫЕ ЗВУКИ
  // ==================================================================

  // Мелодичный аккорд
  playChord() {
    const root = randomNote();
    const idx = PENTATONIC.indexOf(root);
    const third = PENTATONIC[Math.min(idx + 2, PENTATONIC.length - 1)];
    const fifth = PENTATONIC[Math.min(idx + 4, PENTATONIC.length - 1)];
    this._bell(root, 0.8, 0.12);
    this._bell(third, 0.8, 0.08);
    this._bell(fifth, 0.8, 0.06);
  },

  // Печать/Штамп — глухой удар + звон
  playStamp() {
    if (!soundEnabled) return;
    this._soft('triangle', 80, 0.2, 0.3, 0.005);
    setTimeout(() => this._bell(392, 0.4, 0.1), 50); // G4
  },

  // Музыкальная нота (для будущей игры «Музыкальный отдел»)
  playNote(frequency = 440) {
    this._bell(frequency, 1.0, 0.2);
  }
};
