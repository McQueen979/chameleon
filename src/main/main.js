'use strict';

/**
 * Chameleon —— 办公室低存在感悬浮 Markdown 阅读器
 *
 * 核心机制：
 * 1. 无边框 + 全透明 + 置顶 + 任务栏隐藏的悬浮窗。窗口本身没有任何底色，
 *    只有文字浮在下层画面之上，所以下层是纯色、图片还是编辑器都不用管。
 * 2. 鼠标在窗口范围内「完全静止」够久（默认 1 秒）才淡入显现；只是路过一律不显示。
 * 3. 鼠标移出 → 淡出到 0 并恢复点击穿透，鼠标可以正常操作下层窗口。
 *
 * 设置全部放在主界面之外：双击 `Chameleon Settings.exe` 开一个普通窗口，
 * 也可以 `Chameleon.exe --settings`，或者直接手改 config.json（会被监听并立即生效）。
 * 主窗口的界面因此一个按钮都不用增加。
 */

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } = require('electron');

const createConfig = require('./config');
const createNotes = require('./notes');

const APP_ROOT = path.join(__dirname, '..', '..');
const MIN_WIDTH = 120;
const MIN_HEIGHT = 80;
const DEFAULT_WIDTH = 460;
const DEFAULT_HEIGHT = 620;

let win = null;
// 独立设置窗口：普通窗口，不参与悬停显隐 / 置顶 / 点击穿透，一切都只作用于 win
let settingsWin = null;
let cfg = null;
let notes = null;

const runtime = {
  hover: false,
  hidden: false,
  // 隐身开关是运行时状态，故意不落盘：每次启动都从「常显」开始，
  // 否则零底色 + 直接隐身 = 用户启动完根本找不到窗口
  stealth: false,
  // 置顶开关同样是运行时状态，故意不落盘：每次启动都从「始终置顶」开始，
  // 否则上次取消了置顶，这次启动它会被别的窗口盖住，用户根本找不到
  pinned: true,
  // 拖进来的文件夹只在本次运行生效，不写配置（用户要求：不记住）
  notesDir: null,
  // 拖进来的单个文件，启动时交给渲染进程直接打开
  pendingOpen: null,
  interacting: 0,
  lastGeometryAt: 0,
  lastMoveAt: 0,
  lastPoint: null,
  shownAt: 0,
  pinnedUntil: 0,
  pinTouched: false,
  revealUntil: 0,
  fadeTimer: null,
  timer: null,
  saveTimer: null,
  watcher: null,
  watchTimer: null,
};

/**
 * 是否要开设置窗口。两种入口等效：
 * - `Chameleon Settings.exe`（构建时复制出来的一份，双击就能进设置）
 * - `Chameleon.exe --settings`
 */
const SETTINGS_EXE = 'chameleon settings';

function wantsSettings(argv) {
  const list = Array.isArray(argv) ? argv : [];
  if (list.includes('--settings')) return true;
  const exe = list.find((arg) => typeof arg === 'string' && /\.exe$/i.test(arg));
  if (!exe) return false;
  return path.basename(exe, path.extname(exe)).toLowerCase() === SETTINGS_EXE;
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  // 第二次启动（比如往快捷方式 / exe 上拖文件）：自己什么都不做，
  // 由下面的 whenReady 直接返回，路径交给已在运行的实例处理
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // 程序已经在跑时双击「设置」：交给本实例开设置窗口，不能把这一下丢掉
    if (wantsSettings(argv)) {
      openSettings();
      return;
    }
    const paths = parseLaunchPaths(argv || []);
    applyDrop(paths);
    showWindow({ focus: true, reveal: true });
    notifyOpened();
  });
}

app.setAppUserModelId('com.chameleon.reader');

/* ------------------------------------------------------------------ 配置 */

function defaultNotesDir() {
  if (!app.isPackaged) {
    const local = path.join(APP_ROOT, 'notes');
    if (fs.existsSync(local)) return local;
  }
  return path.join(app.getPath('userData'), 'notes');
}

function sanitizeBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const { x, y, width, height } = bounds;
  if (![x, y, width, height].every((v) => Number.isFinite(v))) return null;
  if (width < MIN_WIDTH || height < MIN_HEIGHT) return null;
  const display = screen.getDisplayMatching({ x, y, width, height });
  const area = display.workArea;
  const visibleX = x < area.x + area.width && x + width > area.x;
  const visibleY = y < area.y + area.height && y + height > area.y;
  if (!visibleX || !visibleY) return null; // 显示器已拔出等情况，回退到默认位置
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function defaultBounds() {
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(DEFAULT_WIDTH, Math.max(MIN_WIDTH, area.width - 80));
  const height = Math.min(DEFAULT_HEIGHT, Math.max(MIN_HEIGHT, area.height - 80));
  return {
    x: area.x + area.width - width - 28,
    y: area.y + 56,
    width,
    height,
  };
}

function saveBoundsSoon() {
  clearTimeout(runtime.saveTimer);
  runtime.saveTimer = setTimeout(() => {
    if (win && !win.isDestroyed()) cfg.save({ bounds: win.getBounds() });
  }, 500);
}

/* ------------------------------------------------------- 拖进来的路径 */

/** 当前生效的笔记文件夹：拖入的优先，否则用配置里的 */
const activeNotesDir = () => runtime.notesDir || cfg.get().notesDir;

/** 从命令行参数里挑出真实存在的路径（跳过 exe 自身、开关、开发模式下的 "."） */
function parseLaunchPaths(argv) {
  const root = path.resolve(APP_ROOT);
  const cwd = path.resolve('.');
  return argv
    .slice(1)
    .filter((arg) => arg && !arg.startsWith('--'))
    .filter((arg) => {
      const resolved = path.resolve(arg);
      return resolved !== root && resolved !== cwd;
    })
    .filter((arg) => {
      try {
        return fs.existsSync(arg);
      } catch {
        return false;
      }
    });
}

/** 文件夹 → 本次运行改用它；文件 → 直接打开这一篇 */
function applyDrop(paths) {
  if (!paths || !paths.length) return false;
  let stat;
  try {
    stat = fs.statSync(paths[0]);
  } catch {
    return false;
  }
  if (stat.isDirectory()) {
    runtime.notesDir = path.resolve(paths[0]);
    runtime.pendingOpen = null;
  } else {
    runtime.pendingOpen = path.resolve(paths[0]);
  }
  if (process.argv.includes('--dev')) {
    console.log(`[chameleon][dev] 拖入 ${stat.isDirectory() ? '文件夹' : '文件'}: ${path.resolve(paths[0])}`);
  }
  return true;
}

function notifyOpened() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('opened', {
    notesDir: activeNotesDir(),
    notes: notes.list(activeNotesDir()),
    file: runtime.pendingOpen,
  });
}

/* ------------------------------------------------------------------ 窗口 */

/** 顶栏 ^ 开关：默认始终置顶（随时抢回层级）；开启后让下层窗口正常盖住它 */
function applyAlwaysOnTop() {
  if (!win || win.isDestroyed()) return;
  if (runtime.pinned) win.setAlwaysOnTop(true, 'screen-saver');
  else win.setAlwaysOnTop(false);
}

function createWindow() {
  const bounds = sanitizeBounds(cfg.get().bounds) || defaultBounds();

  win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    thickFrame: false,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    title: 'Chameleon',
    webPreferences: {
      preload: path.join(APP_ROOT, 'src', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  applyAlwaysOnTop();
  win.setOpacity(0);
  // 不传 forward：只要鼠标不在窗口内就完全不接收鼠标消息，避免鼠标每动一下都被转发进来做命中测试
  win.setIgnoreMouseEvents(true);

  win.loadFile(path.join(APP_ROOT, 'src', 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    win.show();
    applyAlwaysOnTop();
    hoverTick();
  });

  const onGeometry = () => {
    runtime.lastGeometryAt = Date.now();
    saveBoundsSoon();
  };
  win.on('moved', onGeometry);
  win.on('resized', onGeometry);

  // 其它窗口抢占置顶时把层级抢回来；用户用 ^ 关掉置顶后就不再抢
  win.on('blur', () => {
    if (runtime.pinned) applyAlwaysOnTop();
  });

  win.on('closed', () => {
    win = null;
  });

  if (process.argv.includes('--dev')) attachDevTools();

  // 禁止窗口内部导航，外部链接交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    openExternal(url);
  });
}

function openExternal(url) {
  if (/^https?:/i.test(url)) shell.openExternal(url);
}

/* ------------------------------------------------------- 独立设置窗口 */

/**
 * 设置放在主界面之外：普通窗口，有边框有底色，和主窗口的透明 / 穿透 / 隐身完全隔离。
 * 入口是 `Chameleon Settings.exe` 或 `--settings`，主窗口不增加任何按钮。
 */
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    return settingsWin;
  }

  // 高度按屏幕可用空间给，别在小屏上超出可视区；「关于」尽量一屏放得下
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const settingsHeight = Math.max(540, Math.min(780, workArea.height - 120));

  settingsWin = new BrowserWindow({
    width: 400,
    height: settingsHeight,
    minWidth: 340,
    minHeight: 420,
    title: 'Chameleon 设置',
    backgroundColor: '#f9f8f6',
    autoHideMenuBar: true,
    show: false,
    // 故意不设 alwaysOnTop：主窗口已经是 screen-saver 层级，设置窗口不跟它抢
    webPreferences: {
      preload: path.join(APP_ROOT, 'src', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  settingsWin.loadFile(path.join(APP_ROOT, 'src', 'renderer', 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => {
    settingsWin = null;
  });

  return settingsWin;
}

/** 仅开发模式：把主窗口与设置窗口（开着的话）的关键状态打出来，用来看改动有没有真的生效 */
async function logWindowState(label) {
  if (win && !win.isDestroyed()) {
    const script = `JSON.stringify({
      notes: document.querySelectorAll('.note').length,
      ink: document.documentElement.dataset.ink,
      textColor: getComputedStyle(document.body).color,
      frameBg: getComputedStyle(document.querySelector('.frame')).backgroundColor,
      tools: [...document.querySelectorAll('[data-tool]')].map((el) => el.dataset.tool),
      stealth: (document.querySelector('[data-tool="stealth"]') || {}).textContent,
      meta: document.getElementById('meta').textContent,
      title: (document.querySelector('.md h1') || {}).textContent,
      htmlLength: document.querySelector('.md').innerHTML.length,
      docWidth: document.querySelector('#doc').clientWidth
    })`;
    const result = await win.webContents.executeJavaScript(script).catch((err) => `ERR ${err.message}`);
    console.log(`[chameleon][dev] 主窗口(${label}):`, result);
  }
  if (settingsWin && !settingsWin.isDestroyed()) {
    const script = `JSON.stringify({
      order: [...document.querySelectorAll('[data-tool]')].map((el) => el.dataset.tool),
      fixed: [...document.querySelectorAll('.tool__mark')].map((el) => el.parentElement.dataset.tool),
      draggable: document.querySelectorAll('.tool[data-drag="1"]').length,
      opacity: document.getElementById('opacity').value,
      still: document.getElementById('still').value,
      ink: (document.querySelector('.ink__item.is-on .ink__label') || {}).textContent,
      size: window.innerWidth + 'x' + window.innerHeight
    })`;
    const result = await settingsWin.webContents
      .executeJavaScript(script)
      .catch((err) => `ERR ${err.message}`);
    console.log(`[chameleon][dev] 设置窗口(${label}):`, result);
  }
}

/** 仅开发模式：转发渲染进程日志，并在启动后输出一次自检结果 */
function attachDevTools() {
  win.webContents.openDevTools({ mode: 'detach' });
  win.webContents.on('console-message', (_event, level, message, line, source) => {
    console.log(`[renderer:${level}] ${message} (${source}:${line})`);
  });
  setTimeout(async () => {
    await logWindowState('自检');
    console.log('[chameleon][dev] 窗口:', JSON.stringify(win.getBounds()), '不透明度:', win.getOpacity());
  }, 2000);
}

/* ------------------------------------------------- 悬停显隐 / 点击穿透 */

/** 窗口不透明度缓动，消除硬切的闪烁感 */
function fadeTo(target) {
  if (!win || win.isDestroyed()) return;
  clearInterval(runtime.fadeTimer);
  const from = win.getOpacity();
  const delta = target - from;
  const duration = cfg.get().fadeMs || 0;
  if (duration <= 0 || Math.abs(delta) < 0.01) {
    win.setOpacity(target);
    return;
  }
  const steps = Math.max(3, Math.round(duration / 16));
  let step = 0;
  runtime.fadeTimer = setInterval(() => {
    if (!win || win.isDestroyed()) {
      clearInterval(runtime.fadeTimer);
      return;
    }
    step += 1;
    const t = step / steps;
    const eased = t * t * (3 - 2 * t);
    win.setOpacity(from + delta * eased);
    if (step >= steps) {
      clearInterval(runtime.fadeTimer);
      win.setOpacity(target);
    }
  }, 16);
}

function setHover(next) {
  if (runtime.hover === next) return;
  runtime.hover = next;
  if (!win || win.isDestroyed() || runtime.hidden) return;

  if (next) {
    runtime.shownAt = Date.now();
    // 先恢复可交互再淡入，否则刚淡入那一下点不到
    win.setIgnoreMouseEvents(false);
    fadeTo(cfg.get().hoverOpacity);
  } else {
    // 立即恢复穿透：淡出过程中鼠标已经能点下层窗口，不留死区
    win.setIgnoreMouseEvents(true);
    fadeTo(0);
  }
}

/** 离开判定往外扩一点，避免贴着边界时反复横跳造成闪烁 */
const HOVER_EXIT_MARGIN = 16;
/** 淡入后至少亮这么久才允许淡出，避免鼠标在边界抖动时反复闪 */
const MIN_VISIBLE_MS = 280;

function hoverTick() {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  const bounds = win.getBounds();
  const point = screen.getCursorScreenPoint();
  const now = Date.now();

  if (!runtime.lastPoint || runtime.lastPoint.x !== point.x || runtime.lastPoint.y !== point.y) {
    runtime.lastPoint = point;
    runtime.lastMoveAt = now;
  }

  const margin = runtime.hover ? HOVER_EXIT_MARGIN : 2;
  const inside =
    point.x >= bounds.x - margin &&
    point.x <= bounds.x + bounds.width + margin &&
    point.y >= bounds.y - margin &&
    point.y <= bounds.y + bounds.height + margin;

  // 没开隐身：一直亮着（「取消隐身」后的安静显示），不理会鼠标位置
  if (!runtime.stealth) {
    setHover(true);
    return;
  }

  // 快捷键唤出后先亮一会儿（pinnedUntil）；这期间只要鼠标进到窗口里就一直续期，
  // 鼠标一旦离开就立刻结束保持、重新隐身——「找它 → 拖到新位置 → 鼠标移开」自然完成。
  const pinned = now < runtime.pinnedUntil;
  if (pinned && inside) {
    runtime.pinnedUntil = now + (cfg.get().revealMs || 0);
    runtime.pinTouched = true;
  }
  if (pinned && runtime.pinTouched && !inside) {
    runtime.pinnedUntil = 0;
    runtime.pinTouched = false;
  }

  // 鼠标必须停在窗口里「完全不动」够久才显现。只是路过、或者还在移动，一律不显示。
  // 已经显现之后就不再要求静止了——否则你在里面滚动、挪鼠标时它会当场消失，根本没法读。
  const still = now - runtime.lastMoveAt >= (cfg.get().stillMs || 0);
  const trigger = pinned || (runtime.hover ? inside : inside && still);
  const dragging = now - runtime.lastGeometryAt < 400;
  const revealing = now < runtime.revealUntil;
  const dwell = runtime.hover && now - runtime.shownAt < MIN_VISIBLE_MS;
  const next = trigger || dragging || revealing || dwell || runtime.interacting > 0;

  if (next !== runtime.hover && process.argv.includes('--dev')) {
    console.log(
      `[chameleon][dev] hover=${next} 鼠标(${point.x},${point.y}) ` +
        `inside=${inside} still=${(now - runtime.lastMoveAt) | 0}ms pinned=${pinned} reveal=${revealing}`,
    );
  }
  setHover(next);
}

function showWindow({ focus = false, reveal = false } = {}) {
  if (!win || win.isDestroyed()) return;
  runtime.hidden = false;
  if (reveal) {
    runtime.revealUntil = Date.now() + (cfg.get().revealMs || 0);
    runtime.pinnedUntil = Date.now() + (cfg.get().revealMs || 0);
    runtime.pinTouched = false;
  }
  win.show();
  if (focus) win.focus();
  applyAlwaysOnTop();
  hoverTick();
}

function hideWindow() {
  if (!win || win.isDestroyed()) return;
  runtime.hidden = true;
  runtime.revealUntil = 0;
  runtime.pinnedUntil = 0;
  runtime.pinTouched = false;
  win.hide();
}

function toggleWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible() && !runtime.hidden) hideWindow();
  else showWindow({ focus: true, reveal: true });
}

/* ------------------------------------------------- 配置变更的即时生效 */

/** 影响运行时行为、需要通知各窗口重画的键；scroll / bounds / lastNote 这类高频键不在其中 */
const LIVE_KEYS = [
  'tools',
  'toolsOff',
  'ink',
  'inkTones',
  'hoverOpacity',
  'stillMs',
  'pollInterval',
  'fadeMs',
  'revealMs',
  'hotkey',
];

function broadcastConfig() {
  const payload = { config: cfg.get() };
  for (const target of BrowserWindow.getAllWindows()) {
    if (!target.isDestroyed()) target.webContents.send('config:changed', payload);
  }
}

/** 配置变了以后重新落到运行时：轮询节拍、显现不透明度，并通知各窗口重画界面 */
function applyRuntimeConfig() {
  clearInterval(runtime.timer);
  runtime.timer = setInterval(hoverTick, cfg.get().pollInterval);
  // 不透明度的生效点在 hover 状态切换那一刻，正亮着的时候改要当场补一次，
  // 否则用户得等鼠标进出一次才看得到效果
  if (win && !win.isDestroyed() && runtime.hover && !runtime.hidden) {
    fadeTo(cfg.get().hoverOpacity);
  }
  broadcastConfig();
}

/**
 * 盯住配置目录，让「直接编辑 config.json」也能立即生效。
 * 看目录而不是看文件：落盘走的是临时文件 + rename，rename 会换掉文件本身，盯文件会失效。
 */
function watchConfig() {
  const dir = path.dirname(cfg.file);
  const name = path.basename(cfg.file);
  try {
    runtime.watcher = fs.watch(dir, (_event, filename) => {
      if (filename && path.basename(String(filename)) !== name) return; // 忽略 .tmp
      clearTimeout(runtime.watchTimer);
      runtime.watchTimer = setTimeout(reloadConfig, 200);
    });
  } catch (err) {
    console.error('[chameleon] 配置文件监听失败:', err.message);
  }
}

/**
 * 外部改了 config.json：只覆盖文件里真正写到的键，别的保持现状。
 * 程序自己 persist() 也会触发监听，内容与内存一致就当没变化（changed === false）。
 */
function reloadConfig() {
  if (!cfg) return;
  const before = cfg.get();
  const result = cfg.reload();
  if (!result || !result.changed) return;
  console.log('[chameleon] 检测到 config.json 被外部修改，已重新载入');
  if (result.data.hotkey !== before.hotkey) registerHotkey();
  applyRuntimeConfig();
  if (process.argv.includes('--dev')) logWindowState('重载后');
}

/* ------------------------------------------------------------ 生命周期 */

function registerHotkey() {
  globalShortcut.unregisterAll();
  const hotkey = cfg.get().hotkey;
  let ok = false;
  try {
    ok = globalShortcut.register(hotkey, toggleWindow);
  } catch {
    ok = false;
  }
  if (!ok) console.error(`[chameleon] 全局快捷键注册失败: ${hotkey}`);
  return ok;
}

app.whenReady().then(() => {
  // 第二个进程不初始化任何东西：它已经 app.quit()，只需要把路径交出去
  if (!gotLock) return;

  cfg = createConfig(app.getPath('userData'));
  cfg.load();

  const configured = cfg.get().notesDir;
  if (!configured) {
    // 只在自己没有记录过笔记目录时给出默认值；用户设置过的路径（哪怕是临时不可用）一律不动
    const dir = defaultNotesDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* 目录不可创建时忽略，界面会显示为空 */
    }
    cfg.save({ notesDir: dir });
  }

  notes = createNotes();

  if (process.argv.includes('--dev')) {
    console.log(`[chameleon][dev] 配置: ${cfg.file}`);
    console.log(`[chameleon][dev] 笔记目录: ${activeNotesDir()}`);
  }

  // 启动时就把拖进来的路径处理掉，配置由 bootstrap 一并带给渲染进程
  applyDrop(parseLaunchPaths(process.argv));

  createWindow();
  applyRuntimeConfig();
  registerHotkey();
  watchConfig();

  // 用设置版 exe 或 --settings 冷启动：主窗口照常建出来（改设置时能直接看到效果），设置窗口一起开
  if (wantsSettings(process.argv)) openSettings();

  app.on('activate', () => showWindow({ focus: true, reveal: true }));
});

app.on('before-quit', () => {
  clearInterval(runtime.timer);
  clearTimeout(runtime.watchTimer);
  if (runtime.watcher) runtime.watcher.close();
  globalShortcut.unregisterAll();
  if (win && !win.isDestroyed()) cfg.save({ bounds: win.getBounds() });
});

app.on('window-all-closed', () => app.quit());

/* ------------------------------------------------------------------ IPC */

ipcMain.handle('app:bootstrap', async () => {
  const config = cfg.get();
  return {
    config,
    notes: notes.list(activeNotesDir()),
    notesDir: activeNotesDir(),
    open: runtime.pendingOpen,
    stealth: runtime.stealth,
    pinned: runtime.pinned,
    version: app.getVersion(),
    minSize: { width: MIN_WIDTH, height: MIN_HEIGHT },
  };
});

ipcMain.handle('notes:list', () => notes.list(activeNotesDir()));

ipcMain.handle('notes:read', async (_event, target) => notes.read(activeNotesDir(), target));

ipcMain.handle('config:set', (_event, patch) => {
  const before = cfg.get();
  const next = cfg.save(patch);
  if (next.hotkey !== before.hotkey) registerHotkey();
  const touchesLive =
    patch && typeof patch === 'object' && Object.keys(patch).some((key) => LIVE_KEYS.includes(key));
  if (touchesLive) applyRuntimeConfig();
  return next;
});

/** 设置窗口的「配置文件」按钮：在资源管理器里指出文件（或目录）位置 */
ipcMain.handle('app:showConfig', () => {
  if (fs.existsSync(cfg.file)) shell.showItemInFolder(cfg.file);
  else shell.openPath(path.dirname(cfg.file));
  return cfg.file;
});

/** 设置窗口里的链接：只放行本项目自己的地址，别的一律不认 */
const EXTERNAL_SAFE = /^https:\/\/github\.com\/McQueen979\/chameleon(\/|$)/i;

ipcMain.handle('app:openExternal', (_event, url) => {
  if (typeof url !== 'string' || !EXTERNAL_SAFE.test(url)) return false;
  shell.openExternal(url);
  return true;
});

ipcMain.handle('app:setStealth', (_event, stealth) => {
  runtime.stealth = !!stealth;
  if (runtime.stealth) {
    // 刚开隐身：鼠标正压在窗口上，把静止计时清零，否则会先闪一下再重新显现
    runtime.lastMoveAt = 0;
  }
  hoverTick();
  return runtime.stealth;
});

ipcMain.handle('app:setPinned', (_event, pinned) => {
  runtime.pinned = !!pinned;
  applyAlwaysOnTop();
  return runtime.pinned;
});

ipcMain.handle('window:getBounds', () => (win && !win.isDestroyed() ? win.getBounds() : null));

ipcMain.handle('window:setBounds', (_event, next) => {
  if (!win || win.isDestroyed() || !next) return null;
  const width = Math.max(MIN_WIDTH, Math.round(next.width));
  const height = Math.max(MIN_HEIGHT, Math.round(next.height));
  const bounds = {
    x: Math.round(next.x),
    y: Math.round(next.y),
    width,
    height,
  };
  win.setBounds(bounds);
  runtime.lastGeometryAt = Date.now();
  return bounds;
});

ipcMain.handle('app:interacting', (_event, active) => {
  runtime.interacting = Math.max(0, runtime.interacting + (active ? 1 : -1));
  hoverTick();
  return runtime.interacting;
});

ipcMain.handle('app:toggleVisible', () => {
  toggleWindow();
  return !runtime.hidden;
});

ipcMain.handle('app:hide', () => {
  hideWindow();
  return true;
});

ipcMain.on('app:quit', async () => {
  if (win && !win.isDestroyed()) {
    cfg.save({ bounds: win.getBounds() });
    win.destroy();
  }
  app.quit();
});
