export type GamepadAction =
  | 'throttle'
  | 'brake'
  | 'steerLeft'
  | 'steerRight'
  | 'handbrake'
  | 'recover'
  | 'headlights'
  | 'camera'
  | 'pushToTalk';

export type GamepadBinding =
  | { kind: 'button'; index: number }
  | { kind: 'axis'; index: number; rest: number; direction: 1 | -1 };

export interface GamepadConfig {
  deadzone: number;
  invertSteer: boolean;
  preferredIndex: number | null;
  customBindings: Partial<Record<GamepadAction, GamepadBinding>>;
}

export interface ConnectedGamepadSummary {
  index: number;
  id: string;
  mapping: string;
  axesCount: number;
  buttonsCount: number;
  isActive: boolean;
}

export interface GamepadLivePreview {
  steer: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
  pressedButtons: number[];
  rawPressedButtons: Array<{ index: number; value: number }>;
  axes: number[];
}

export interface GamepadStatusSnapshot {
  isSecureContext: boolean;
  apiAvailable: boolean;
  connectedPads: ConnectedGamepadSummary[];
  activePad: ConnectedGamepadSummary | null;
  config: GamepadConfig;
  live: GamepadLivePreview;
  lastError: string | null;
}

export interface GamepadDrivingInput {
  connected: boolean;
  steer: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
  justToggleHeadlights: boolean;
  justRecover: boolean;
  justCycleCamera: boolean;
  anyStartPressed: boolean;
  anyInputActive: boolean;
}

export interface GamepadBaselineSnapshot {
  key: string;
  index: number;
  axes: number[];
  buttons: boolean[];
}

const CONFIG_STORAGE_KEY = 'minirace3d_gamepad_config';

const DEFAULT_CONFIG: GamepadConfig = {
  deadzone: 0.08,
  invertSteer: false,
  preferredIndex: null,
  customBindings: {},
};

interface PadCalibration {
  key: string;
  restAxes: number[];
  prevAxes: number[];
  initiallyPressed: boolean[];
  prevButtons: boolean[];
  prevCustomDiscrete: Record<string, boolean>;
  prevPovStart: boolean;
}

const padCalibrationMap = new Map<number, PadCalibration>();
const listeners = new Set<() => void>();

let currentConfig: GamepadConfig = loadStoredConfig();
let lastActiveIndex: number | null = null;
let lastGamepadError: string | null = null;
let uiPollTimer: number | null = null;
let uiPollRefCount = 0;

let cachedSnapshot: GamepadStatusSnapshot = buildInitialSnapshot();

const EMPTY_DRIVING_INPUT: GamepadDrivingInput = {
  connected: false,
  steer: 0,
  throttle: 0,
  brake: 0,
  handbrake: false,
  justToggleHeadlights: false,
  justRecover: false,
  justCycleCamera: false,
  anyStartPressed: false,
  anyInputActive: false,
};

function sanitizeBinding(raw: unknown): GamepadBinding | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.kind === 'button' && typeof obj.index === 'number' && Number.isInteger(obj.index) && obj.index >= 0) {
    return { kind: 'button', index: obj.index };
  }
  if (
    obj.kind === 'axis' &&
    typeof obj.index === 'number' &&
    Number.isInteger(obj.index) &&
    obj.index >= 0 &&
    typeof obj.rest === 'number' &&
    Number.isFinite(obj.rest) &&
    (obj.direction === 1 || obj.direction === -1)
  ) {
    return { kind: 'axis', index: obj.index, rest: obj.rest, direction: obj.direction };
  }
  return null;
}

function loadStoredConfig(): GamepadConfig {
  if (typeof window === 'undefined') return { ...DEFAULT_CONFIG, customBindings: {} };
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG, customBindings: {} };
    const parsed = JSON.parse(raw);
    const deadzone =
      typeof parsed.deadzone === 'number' && Number.isFinite(parsed.deadzone)
        ? Math.max(0.03, Math.min(0.3, parsed.deadzone))
        : DEFAULT_CONFIG.deadzone;
    const invertSteer = Boolean(parsed.invertSteer);
    const preferredIndex =
      typeof parsed.preferredIndex === 'number' && Number.isInteger(parsed.preferredIndex) && parsed.preferredIndex >= 0
        ? parsed.preferredIndex
        : null;
    const customBindings: Partial<Record<GamepadAction, GamepadBinding>> = {};
    if (parsed.customBindings && typeof parsed.customBindings === 'object') {
      const validActions: GamepadAction[] = [
        'throttle',
        'brake',
        'steerLeft',
        'steerRight',
        'handbrake',
        'recover',
        'headlights',
        'camera',
        'pushToTalk',
      ];
      for (const action of validActions) {
        const clean = sanitizeBinding(parsed.customBindings[action]);
        if (clean) customBindings[action] = clean;
      }
    }
    return { deadzone, invertSteer, preferredIndex, customBindings };
  } catch {
    return { ...DEFAULT_CONFIG, customBindings: {} };
  }
}

function saveConfig(cfg: GamepadConfig): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // Ignore storage write errors
  }
}

function buildInitialSnapshot(): GamepadStatusSnapshot {
  const isSecure = typeof window !== 'undefined' ? Boolean(window.isSecureContext) : true;
  const apiAvailable = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
  return {
    isSecureContext: isSecure,
    apiAvailable,
    connectedPads: [],
    activePad: null,
    config: currentConfig,
    live: {
      steer: 0,
      throttle: 0,
      brake: 0,
      handbrake: false,
      pressedButtons: [],
      rawPressedButtons: [],
      axes: [],
    },
    lastError: null,
  };
}

export function getGamepadsSafe(): Gamepad[] {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
    return [];
  }
  try {
    const raw = navigator.getGamepads();
    lastGamepadError = null;
    if (!raw) return [];
    const valid: Gamepad[] = [];
    for (let i = 0; i < raw.length; i++) {
      const gp = raw[i];
      if (!gp || !gp.connected) continue;
      if (gp.axes.length === 0 && gp.buttons.length === 0) continue;
      valid.push(gp);
    }
    return valid;
  } catch (err) {
    lastGamepadError = err instanceof Error ? err.message : String(err);
    return [];
  }
}

function getOrCalibratePad(gp: Gamepad): PadCalibration {
  const key = `${gp.index}::${gp.id}`;
  const existing = padCalibrationMap.get(gp.index);
  if (existing && existing.key === key) {
    // Clear initially-stuck buttons once they read unpressed at least once
    for (let i = 0; i < existing.initiallyPressed.length; i++) {
      if (existing.initiallyPressed[i] && !gp.buttons[i]?.pressed) {
        existing.initiallyPressed[i] = false;
      }
    }
    return existing;
  }

  const restAxes: number[] = [];
  for (let i = 0; i < gp.axes.length; i++) {
    restAxes.push(Number.isFinite(gp.axes[i]) ? gp.axes[i] : 0);
  }
  const initiallyPressed: boolean[] = [];
  const prevButtons: boolean[] = [];
  for (let i = 0; i < gp.buttons.length; i++) {
    const pressed = Boolean(gp.buttons[i]?.pressed);
    initiallyPressed.push(pressed);
    prevButtons.push(pressed);
  }

  const created: PadCalibration = {
    key,
    restAxes,
    prevAxes: restAxes.slice(),
    initiallyPressed,
    prevButtons,
    prevCustomDiscrete: {},
    prevPovStart: false,
  };
  padCalibrationMap.set(gp.index, created);
  return created;
}

function getPadActivity(gp: Gamepad, cal: PadCalibration): { hasButton: boolean; hasAxis: boolean } {
  let hasButton = false;
  for (let i = 0; i < gp.buttons.length; i++) {
    const btn = gp.buttons[i];
    if (!btn || cal.initiallyPressed[i]) continue;
    if (btn.pressed || (typeof btn.value === 'number' && Number.isFinite(btn.value) && btn.value > 0.25)) {
      hasButton = true;
      break;
    }
  }

  let hasAxis = false;
  for (let i = 0; i < gp.axes.length; i++) {
    const val = gp.axes[i];
    if (!Number.isFinite(val)) continue;
    const prevVal = cal.prevAxes[i] ?? val;
    if (Math.abs(val) > 1.2 || Math.abs(prevVal) > 1.2) {
      cal.prevAxes[i] = val;
      continue;
    }
    if (Math.abs(val - prevVal) > 0.12) {
      hasAxis = true;
      cal.prevAxes[i] = val;
    }
  }

  return { hasButton, hasAxis };
}

function selectActiveGamepad(pads: Gamepad[]): Gamepad | null {
  if (pads.length === 0) {
    lastActiveIndex = null;
    return null;
  }

  // Calibrate all connected pads and prioritize live button activity over axis movement
  let buttonPad: Gamepad | null = null;
  let axisPad: Gamepad | null = null;
  for (let i = 0; i < pads.length; i++) {
    const pad = pads[i];
    const cal = getOrCalibratePad(pad);
    const activity = getPadActivity(pad, cal);
    if (!buttonPad && activity.hasButton) {
      buttonPad = pad;
    }
    if (!axisPad && activity.hasAxis) {
      axisPad = pad;
    }
  }

  if (currentConfig.preferredIndex !== null) {
    const pref = pads.find((p) => p.index === currentConfig.preferredIndex);
    if (pref) {
      lastActiveIndex = pref.index;
      return pref;
    }
  }

  if (buttonPad) {
    lastActiveIndex = buttonPad.index;
    return buttonPad;
  }

  if (axisPad) {
    lastActiveIndex = axisPad.index;
    return axisPad;
  }

  if (lastActiveIndex !== null) {
    const prev = pads.find((p) => p.index === lastActiveIndex);
    if (prev) return prev;
  }

  // Prefer pads with 'standard' mapping if no input detected yet
  const stdPad = pads.find((p) => p.mapping === 'standard');
  const chosen = stdPad || pads[0];
  lastActiveIndex = chosen.index;
  return chosen;
}

function readButtonValue(gp: Gamepad, cal: PadCalibration, idx: number): number {
  const btn = gp.buttons[idx];
  if (!btn) return 0;
  if (cal.initiallyPressed[idx]) return 0;
  if (typeof btn.value === 'number' && Number.isFinite(btn.value) && btn.value > 0.02) {
    return Math.min(1, btn.value);
  }
  return btn.pressed ? 1 : 0;
}

function isButtonPressed(gp: Gamepad, cal: PadCalibration, idx: number): boolean {
  const btn = gp.buttons[idx];
  if (!btn) return false;
  if (cal.initiallyPressed[idx]) return false;
  return Boolean(btn.pressed);
}

function readBindingAnalog(gp: Gamepad, cal: PadCalibration, binding: GamepadBinding): number {
  if (binding.kind === 'button') {
    return readButtonValue(gp, cal, binding.index);
  }
  const raw = gp.axes[binding.index];
  if (!Number.isFinite(raw) || Math.abs(raw) > 1.2) return 0;
  const delta = (raw - binding.rest) * binding.direction;
  if (delta <= 0.05) return 0;
  const span = binding.direction > 0 ? Math.max(0.25, 1 - binding.rest) : Math.max(0.25, binding.rest + 1);
  return Math.max(0, Math.min(1, delta / span));
}

function readBindingDigital(gp: Gamepad, cal: PadCalibration, binding: GamepadBinding): boolean {
  if (binding.kind === 'button') {
    return isButtonPressed(gp, cal, binding.index);
  }
  return readBindingAnalog(gp, cal, binding) > 0.45;
}

function decodeDirectInputPov(hatVal: number): { up: boolean; down: boolean; left: boolean; right: boolean } {
  if (!Number.isFinite(hatVal) || hatVal > 1.2 || hatVal < -1.2) {
    return { up: false, down: false, left: false, right: false };
  }
  // Standard DirectInput 8-way hat mapping:
  // -1.00 = N, -0.71 = NE, -0.43 = E, -0.14 = SE, +0.14 = S, +0.43 = SW, +0.71 = W, +1.00 = NW
  const up = hatVal <= -0.60 || hatVal >= 0.88;
  const right = hatVal >= -0.82 && hatVal <= -0.04;
  const down = hatVal >= -0.25 && hatVal <= 0.55;
  const left = hatVal >= 0.32 && hatVal <= 1.1;
  return { up, down, left, right };
}

function findTriggerAxisValues(gp: Gamepad, cal: PadCalibration): { throttle: number; brake: number } {
  if (gp.mapping === 'standard' || gp.buttons.length >= 8) return { throttle: 0, brake: 0 };
  // Only for bare pedals/wheels without buttons[6]/[7] where triggers sit on axes resting at +/-1
  const candidateIndices = [5, 4, 2, 3];
  let throttle = 0;
  let brake = 0;
  let usedThrottleIdx = -1;

  for (const idx of candidateIndices) {
    if (idx >= gp.axes.length) continue;
    const rest = cal.restAxes[idx];
    if (!Number.isFinite(rest) || Math.abs(rest) < 0.85 || Math.abs(rest) > 1.15) continue;
    const val = gp.axes[idx];
    if (!Number.isFinite(val)) continue;
    const norm =
      rest < 0
        ? Math.max(0, Math.min(1, (val - rest) / Math.max(0.5, 1 - rest)))
        : Math.max(0, Math.min(1, (rest - val) / Math.max(0.5, rest + 1)));
    const cleaned = norm > 0.06 ? norm : 0;
    if (usedThrottleIdx === -1) {
      usedThrottleIdx = idx;
      throttle = cleaned;
    } else {
      brake = cleaned;
      break;
    }
  }
  return { throttle, brake };
}

function evaluatePadInput(gp: Gamepad, advanceEdgeState: boolean): GamepadDrivingInput {
  const cal = getOrCalibratePad(gp);
  const deadzone = currentConfig.deadzone;
  const custom = currentConfig.customBindings;
  const isLogitechDInput =
    gp.mapping !== 'standard' && /logitech|dual action|rumblepad|f310|f710/i.test(gp.id);

  let pov = { up: false, down: false, left: false, right: false };
  if (gp.mapping !== 'standard' && gp.axes.length >= 10 && Math.abs(cal.restAxes[9] ?? 0) > 1.2) {
    pov = decodeDirectInputPov(gp.axes[9]);
  }

  // 1. Steering (-1 right, +1 left)
  let defaultLeft = 0;
  let defaultRight = 0;
  const rawStickX = gp.axes[0] ?? 0;
  const restStickX = Math.abs(cal.restAxes[0] ?? 0) < 0.35 ? cal.restAxes[0] ?? 0 : 0;
  const stickX = Number.isFinite(rawStickX) ? rawStickX - restStickX : 0;
  if (Math.abs(stickX) > deadzone) {
    const norm = (Math.abs(stickX) - deadzone) / Math.max(0.1, 1 - deadzone);
    const mag = Math.pow(Math.min(1, norm), 1.45);
    if (stickX < 0) defaultLeft = mag;
    else defaultRight = mag;
  } else if (isButtonPressed(gp, cal, 14) || pov.left) {
    defaultLeft = 1;
  } else if (isButtonPressed(gp, cal, 15) || pov.right) {
    defaultRight = 1;
  }
  const leftVal = custom.steerLeft ? readBindingAnalog(gp, cal, custom.steerLeft) : defaultLeft;
  const rightVal = custom.steerRight ? readBindingAnalog(gp, cal, custom.steerRight) : defaultRight;
  let steer = leftVal - rightVal;
  if (currentConfig.invertSteer) {
    steer = -steer;
  }

  // 2. Throttle & Brake
  const nonStdTriggers = findTriggerAxisValues(gp, cal);

  let throttle = 0;
  if (custom.throttle) {
    throttle = readBindingAnalog(gp, cal, custom.throttle);
  } else if (isLogitechDInput) {
    const btnRT = readButtonValue(gp, cal, 7);
    const btnA = isButtonPressed(gp, cal, 1) ? 1 : 0;
    const dpadUp = pov.up ? 1 : 0;
    throttle = Math.max(btnRT, btnA, dpadUp);
  } else {
    const btnRT = readButtonValue(gp, cal, 7);
    const btnA = isButtonPressed(gp, cal, 0) ? 1 : 0;
    const dpadUp = isButtonPressed(gp, cal, 12) || pov.up ? 1 : 0;
    throttle = Math.max(btnRT, btnA, dpadUp, nonStdTriggers.throttle);
  }

  let brake = 0;
  if (custom.brake) {
    brake = readBindingAnalog(gp, cal, custom.brake);
  } else if (isLogitechDInput) {
    const btnLT = readButtonValue(gp, cal, 6);
    const btnB = isButtonPressed(gp, cal, 2) ? 1 : 0;
    const dpadDown = pov.down ? 1 : 0;
    brake = Math.max(btnLT, btnB, dpadDown);
  } else {
    const btnLT = readButtonValue(gp, cal, 6);
    const btnB = isButtonPressed(gp, cal, 1) ? 1 : 0;
    const dpadDown = isButtonPressed(gp, cal, 13) || pov.down ? 1 : 0;
    brake = Math.max(btnLT, btnB, dpadDown, nonStdTriggers.brake);
  }

  // 3. Handbrake
  let handbrake = false;
  if (custom.handbrake) {
    handbrake = readBindingDigital(gp, cal, custom.handbrake);
  } else if (isLogitechDInput) {
    handbrake = isButtonPressed(gp, cal, 0) || isButtonPressed(gp, cal, 5);
  } else {
    handbrake = isButtonPressed(gp, cal, 2) || isButtonPressed(gp, cal, 5);
  }

  // 4. Discrete rising-edge actions
  const checkEdgeAction = (action: 'headlights' | 'recover' | 'camera', defaultBtns: number[]): boolean => {
    const binding = custom[action];
    if (binding) {
      const nowPressed = readBindingDigital(gp, cal, binding);
      const prevPressed = Boolean(cal.prevCustomDiscrete[action]);
      if (advanceEdgeState) {
        cal.prevCustomDiscrete[action] = nowPressed;
      }
      return nowPressed && !prevPressed;
    }
    let fired = false;
    for (let i = 0; i < defaultBtns.length; i++) {
      const bi = defaultBtns[i];
      const nowPressed = isButtonPressed(gp, cal, bi);
      const prevPressed = Boolean(cal.prevButtons[bi]);
      if (nowPressed && !prevPressed) {
        fired = true;
      }
    }
    return fired;
  };

  const justToggleHeadlights = checkEdgeAction('headlights', [4]);
  const justRecover = checkEdgeAction('recover', [3, 8]);
  const justCycleCamera = checkEdgeAction('camera', [9, 11]);

  if (advanceEdgeState) {
    for (let i = 0; i < gp.buttons.length; i++) {
      cal.prevButtons[i] = isButtonPressed(gp, cal, i);
    }
    cal.prevPovStart = pov.up;
  }

  const anyStartPressed =
    throttle > 0.25 ||
    isButtonPressed(gp, cal, isLogitechDInput ? 1 : 0) ||
    isButtonPressed(gp, cal, 9);

  let anyBtnPressed = false;
  for (let i = 0; i < gp.buttons.length; i++) {
    if (isButtonPressed(gp, cal, i)) {
      anyBtnPressed = true;
      break;
    }
  }
  const anyInputActive =
    anyBtnPressed || Math.abs(steer) > 0.05 || throttle > 0.05 || brake > 0.05 || handbrake;

  return {
    connected: true,
    steer,
    throttle,
    brake,
    handbrake,
    justToggleHeadlights,
    justRecover,
    justCycleCamera,
    anyStartPressed,
    anyInputActive,
  };
}

export function pollGamepadDrivingInput(nowMs: number): GamepadDrivingInput {
  void nowMs;
  const pads = getGamepadsSafe();
  if (pads.length === 0) {
    if (cachedSnapshot.connectedPads.length > 0) {
      refreshGamepadStatusSnapshot(false);
    }
    return EMPTY_DRIVING_INPUT;
  }

  // Clean up disconnected calibration slots
  const connectedIndices = new Set(pads.map((p) => p.index));
  for (const idx of Array.from(padCalibrationMap.keys())) {
    if (!connectedIndices.has(idx)) padCalibrationMap.delete(idx);
  }

  const activePad = selectActiveGamepad(pads);
  if (!activePad) return EMPTY_DRIVING_INPUT;

  if (
    pads.length !== cachedSnapshot.connectedPads.length ||
    activePad.index !== (cachedSnapshot.activePad?.index ?? -1)
  ) {
    refreshGamepadStatusSnapshot(false);
  }

  return evaluatePadInput(activePad, true);
}

export function readGamepadVoiceButton(): { connected: boolean; pressed: boolean } {
  const pads = getGamepadsSafe();
  if (pads.length === 0) return { connected: false, pressed: false };
  const active = selectActiveGamepad(pads);
  if (!active) return { connected: false, pressed: false };
  const cal = getOrCalibratePad(active);
  const custom = currentConfig.customBindings.pushToTalk;
  const pressed = custom ? readBindingDigital(active, cal, custom) : isButtonPressed(active, cal, 10);
  return { connected: true, pressed };
}

function snapshotsDiffer(a: GamepadStatusSnapshot, b: GamepadStatusSnapshot): boolean {
  if (a.isSecureContext !== b.isSecureContext || a.apiAvailable !== b.apiAvailable) return true;
  if (a.lastError !== b.lastError) return true;
  if (a.config !== b.config) return true;
  if ((a.activePad?.index ?? -1) !== (b.activePad?.index ?? -1)) return true;
  if ((a.activePad?.id ?? '') !== (b.activePad?.id ?? '')) return true;
  if (a.connectedPads.length !== b.connectedPads.length) return true;
  for (let i = 0; i < a.connectedPads.length; i++) {
    if (
      a.connectedPads[i].index !== b.connectedPads[i].index ||
      a.connectedPads[i].id !== b.connectedPads[i].id ||
      a.connectedPads[i].isActive !== b.connectedPads[i].isActive
    ) {
      return true;
    }
  }
  if (Math.abs(a.live.steer - b.live.steer) > 0.015) return true;
  if (Math.abs(a.live.throttle - b.live.throttle) > 0.015) return true;
  if (Math.abs(a.live.brake - b.live.brake) > 0.015) return true;
  if (a.live.handbrake !== b.live.handbrake) return true;
  if (a.live.pressedButtons.length !== b.live.pressedButtons.length) return true;
  for (let i = 0; i < a.live.pressedButtons.length; i++) {
    if (a.live.pressedButtons[i] !== b.live.pressedButtons[i]) return true;
  }
  if (a.live.rawPressedButtons.length !== b.live.rawPressedButtons.length) return true;
  for (let i = 0; i < a.live.rawPressedButtons.length; i++) {
    if (
      a.live.rawPressedButtons[i].index !== b.live.rawPressedButtons[i].index ||
      Math.abs(a.live.rawPressedButtons[i].value - b.live.rawPressedButtons[i].value) > 0.05
    ) {
      return true;
    }
  }
  if (a.live.axes.length !== b.live.axes.length) return true;
  for (let i = 0; i < a.live.axes.length; i++) {
    if (Math.abs(a.live.axes[i] - b.live.axes[i]) > 0.03) return true;
  }
  return false;
}

export function refreshGamepadStatusSnapshot(includeLive = true): void {
  const pads = getGamepadsSafe();
  const activePad = selectActiveGamepad(pads);

  const connectedPads: ConnectedGamepadSummary[] = pads.map((gp) => ({
    index: gp.index,
    id: gp.id,
    mapping: gp.mapping || 'generic',
    axesCount: gp.axes.length,
    buttonsCount: gp.buttons.length,
    isActive: activePad ? gp.index === activePad.index : false,
  }));

  const activeSummary = connectedPads.find((p) => p.isActive) || null;
  let live: GamepadLivePreview = {
    steer: 0,
    throttle: 0,
    brake: 0,
    handbrake: false,
    pressedButtons: [],
    rawPressedButtons: [],
    axes: [],
  };

  if (includeLive && activePad) {
    const evalRes = evaluatePadInput(activePad, false);
    const cal = getOrCalibratePad(activePad);
    const pressedButtons: number[] = [];
    const rawPressedButtons: Array<{ index: number; value: number }> = [];
    for (let i = 0; i < activePad.buttons.length; i++) {
      const btn = activePad.buttons[i];
      if (!btn) continue;
      if (isButtonPressed(activePad, cal, i)) pressedButtons.push(i);
      const val = typeof btn.value === 'number' && Number.isFinite(btn.value) ? btn.value : btn.pressed ? 1 : 0;
      if (btn.pressed || val > 0.05) {
        rawPressedButtons.push({ index: i, value: Number(val.toFixed(2)) });
      }
    }
    const axes: number[] = [];
    for (let i = 0; i < activePad.axes.length; i++) {
      axes.push(Number((activePad.axes[i] ?? 0).toFixed(2)));
    }
    live = {
      steer: evalRes.steer,
      throttle: evalRes.throttle,
      brake: evalRes.brake,
      handbrake: evalRes.handbrake,
      pressedButtons,
      rawPressedButtons,
      axes,
    };
  }

  const next: GamepadStatusSnapshot = {
    isSecureContext: typeof window !== 'undefined' ? Boolean(window.isSecureContext) : true,
    apiAvailable: typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function',
    connectedPads,
    activePad: activeSummary,
    config: currentConfig,
    live,
    lastError: lastGamepadError,
  };

  if (snapshotsDiffer(cachedSnapshot, next)) {
    cachedSnapshot = next;
    listeners.forEach((l) => l());
  }
}

export function getGamepadStatus(): GamepadStatusSnapshot {
  return cachedSnapshot;
}

export function subscribeGamepadStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function startGamepadUiPolling(): void {
  uiPollRefCount += 1;
  refreshGamepadStatusSnapshot(true);
  if (uiPollTimer === null && typeof window !== 'undefined') {
    uiPollTimer = window.setInterval(() => {
      refreshGamepadStatusSnapshot(true);
    }, 66); // ~15 Hz for responsive live UI test bars
  }
}

export function stopGamepadUiPolling(): void {
  uiPollRefCount = Math.max(0, uiPollRefCount - 1);
  if (uiPollRefCount === 0 && uiPollTimer !== null && typeof window !== 'undefined') {
    window.clearInterval(uiPollTimer);
    uiPollTimer = null;
  }
}

export function setGamepadConfig(patch: Partial<GamepadConfig>): void {
  currentConfig = {
    ...currentConfig,
    ...patch,
    customBindings: patch.customBindings ?? currentConfig.customBindings,
  };
  saveConfig(currentConfig);
  refreshGamepadStatusSnapshot(true);
}

export function setCustomGamepadBinding(action: GamepadAction, binding: GamepadBinding | null): void {
  const nextCustom = { ...currentConfig.customBindings };
  if (binding) {
    nextCustom[action] = binding;
  } else {
    delete nextCustom[action];
  }
  setGamepadConfig({ customBindings: nextCustom });
}

export function setPreferredGamepadIndex(index: number | null): void {
  setGamepadConfig({ preferredIndex: index });
}

export function resetGamepadConfig(): void {
  currentConfig = { ...DEFAULT_CONFIG, customBindings: {} };
  saveConfig(currentConfig);
  refreshGamepadStatusSnapshot(true);
}

export function recalibrateGamepads(): void {
  padCalibrationMap.clear();
  refreshGamepadStatusSnapshot(true);
}

export function captureBaselineSnapshot(): GamepadBaselineSnapshot | null {
  const pads = getGamepadsSafe();
  const active = selectActiveGamepad(pads);
  if (!active) return null;
  return {
    key: `${active.index}::${active.id}`,
    index: active.index,
    axes: Array.from(active.axes, (a) => (Number.isFinite(a) ? a : 0)),
    buttons: Array.from(active.buttons, (b) => Boolean(b?.pressed) || (b?.value ?? 0) > 0.55),
  };
}

export function detectNextBindingFromBaseline(baseline: GamepadBaselineSnapshot): GamepadBinding | null {
  const pads = getGamepadsSafe();
  const active = pads.find((p) => p.index === baseline.index) || selectActiveGamepad(pads);
  if (!active) return null;

  for (let i = 0; i < active.buttons.length; i++) {
    const nowPressed = Boolean(active.buttons[i]?.pressed) || (active.buttons[i]?.value ?? 0) > 0.55;
    const wasPressed = Boolean(baseline.buttons[i]);
    if (nowPressed && !wasPressed) {
      return { kind: 'button', index: i };
    }
  }

  for (let i = 0; i < active.axes.length; i++) {
    const raw = active.axes[i];
    if (!Number.isFinite(raw) || Math.abs(raw) > 1.2) continue;
    const rest = baseline.axes[i] ?? 0;
    if (Math.abs(rest) > 1.2) continue;
    const delta = raw - rest;
    if (Math.abs(delta) > 0.42) {
      return {
        kind: 'axis',
        index: i,
        rest,
        direction: delta > 0 ? 1 : -1,
      };
    }
  }
  return null;
}

export function formatGamepadBinding(action: GamepadAction, binding?: GamepadBinding): string {
  if (binding) {
    if (binding.kind === 'button') {
      return `Botão ${binding.index}`;
    }
    return `Eixo ${binding.index} (${binding.direction > 0 ? '+' : '−'})`;
  }
  switch (action) {
    case 'throttle':
      return 'RT / R2 / A / X / D-Pad ↑';
    case 'brake':
      return 'LT / L2 / B / ○ / D-Pad ↓';
    case 'steerLeft':
      return 'Analógico Esq. ← / D-Pad ←';
    case 'steerRight':
      return 'Analógico Esq. → / D-Pad →';
    case 'handbrake':
      return 'RB / R1 / X / □';
    case 'recover':
      return 'Y / △ / Select';
    case 'headlights':
      return 'LB / L1';
    case 'camera':
      return 'Start / Options / R3';
    case 'pushToTalk':
      return 'L3 (Clicar Analógico Esq.)';
  }
}

// Register global connect/disconnect listeners once in the browser
if (typeof window !== 'undefined') {
  const onConnect = () => {
    refreshGamepadStatusSnapshot(true);
  };
  const onDisconnect = (e: GamepadEvent) => {
    if (e.gamepad) {
      padCalibrationMap.delete(e.gamepad.index);
    }
    refreshGamepadStatusSnapshot(true);
  };
  window.addEventListener('gamepadconnected', onConnect);
  window.addEventListener('gamepaddisconnected', onDisconnect);
  // Check immediately in case a pad was already woken before bundle loaded
  window.setTimeout(() => refreshGamepadStatusSnapshot(false), 120);
}
