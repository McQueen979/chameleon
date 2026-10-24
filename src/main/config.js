'use strict';

/**
 * 配置读写：<userData>/config.json
 * 只写配置本身，绝不触碰用户的笔记数据文件。写入使用「临时文件 + rename」原子替换，
 * 避免进程中途退出导致配置损坏。
 *
 * 外部设置（独立设置窗口 / 直接手改 JSON）写进来的值一律先过 normalize()：
 * 类型不对、超范围、写错的按钮 id 都会在这里被钳制或回退成默认值。
 * 没有这一层，用户把 hoverOpacity 写成 0、stillMs 写成 0 就会让窗口「再也找不到」或疯狂闪烁。
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  notesDir: null, // 笔记文件夹的绝对路径，首次启动时决定
  hotkey: 'Alt+Shift+Q', // 全局显示 / 隐藏快捷键
  ink: 0, // 当前文字灰度在 inkTones 中的序号（从白到黑）
  inkTones: [244, 198, 86, 21], // 四档灰度值，0 为黑、255 为白
  hoverOpacity: 1, // 显现时的不透明度，相当于整体透明度调节
  bounds: null, // { x, y, width, height }
  lastNote: null, // 上次打开的笔记（相对路径）
  scroll: {}, // 每篇读到哪儿：{ 相对路径: 滚动像素 }；只存位置，绝不碰笔记文件
  zoom: 1, // 正文字号倍率 0.8 ~ 1.6
  stillMs: 600, // 鼠标在窗口里静止多久才显现（低于这个时长的路过一律不显示）
  pollInterval: 100, // 鼠标位置轮询间隔（毫秒）
  fadeMs: 180, // 显隐淡入淡出时长（0 = 硬切）
  revealMs: 2000, // 快捷键唤出后短暂亮起多久（0 = 不亮起，只在鼠标移入时显示）
  // 顶栏按钮的排列顺序（永远六项齐全：隐藏只是不打勾，不会从顺序里消失）
  tools: ['files', 'pin', 'stealth', 'ink', 'hide', 'quit'],
  toolsOff: [], // 其中被隐藏的按钮（只可能是中间四个；files / quit 永远显示）
};

const LEGACY_INK = {
  light: 0,
  grayLight: 1,
  grayDark: 2,
  dark: 3,
};

/** 顶栏按钮 id 白名单。顺序即配置里的顺序，未列出的 id 一律丢弃。 */
const TOOLS = ['files', 'pin', 'stealth', 'ink', 'hide', 'quit'];

/**
 * 中间四个按钮：可以勾选显示 / 隐藏，也可以拖着调顺序；
 * 首尾两个钉死（files 永远最左，quit 永远最右，它也是窗口唯一的退出入口）。
 */
const DRAGGABLE_TOOLS = ['pin', 'stealth', 'ink', 'hide'];
const FIXED_HEAD = 'files';
const FIXED_TAIL = 'quit';

/** 各项合法区间；超范围钳到边界，非数字回退默认值 */
const LIMITS = {
  hoverOpacity: [0.15, 1],
  stillMs: [250, 2000],
  pollInterval: [50, 250],
  fadeMs: [0, 400],
  revealMs: [0, 8000],
  zoom: [0.8, 1.6],
};

function clampNumber(value, [min, max], fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeInkTones(value) {
  const tones = Array.from({ length: 4 }, (_unused, index) =>
    Math.round(
      clampNumber(
        Array.isArray(value) ? value[index] : undefined,
        [0, 255],
        DEFAULTS.inkTones[index],
      ),
    ),
  );
  return tones.sort((a, b) => b - a);
}

function normalizeInkIndex(value) {
  const legacy = typeof value === 'string' ? LEGACY_INK[value] : value;
  return Math.round(clampNumber(legacy, [0, 3], DEFAULTS.ink));
}

function normalizeScroll(value) {
  const out = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, top] of Object.entries(value)) {
      const n = Number(top);
      if (Number.isFinite(n) && n >= 0) out[key] = Math.round(n);
    }
  }
  return out;
}

function normalizeTools(value) {
  const list = Array.isArray(value) ? value : DEFAULTS.tools;
  const order = [];
  for (const id of list) {
    if (typeof id !== 'string' || !TOOLS.includes(id) || order.includes(id)) continue;
    order.push(id);
  }
  // 中间四个永远留在顺序里——勾掉只是隐藏，位置不能变
  for (const id of DRAGGABLE_TOOLS) if (!order.includes(id)) order.push(id);
  return [FIXED_HEAD, ...order.filter((id) => id !== FIXED_HEAD && id !== FIXED_TAIL), FIXED_TAIL];
}

/**
 * 被隐藏的按钮。老配置里没有这个键，此时把「不在 tools 里的中间按钮」当成被隐藏，
 * 保证升级后看到的顶栏和之前一模一样。
 */
function normalizeToolsOff(value, rawTools) {
  const list = Array.isArray(value)
    ? value
    : Array.isArray(rawTools)
      ? DRAGGABLE_TOOLS.filter((id) => !rawTools.includes(id))
      : [];
  const out = [];
  for (const id of list) {
    if (typeof id !== 'string' || !DRAGGABLE_TOOLS.includes(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

/** 把任意来源的配置对象整理成一份一定可用的配置 */
function normalize(raw) {
  const data = { ...DEFAULTS, ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) };

  data.notesDir = typeof data.notesDir === 'string' && data.notesDir ? data.notesDir : null;
  data.hotkey = typeof data.hotkey === 'string' && data.hotkey.trim() ? data.hotkey.trim() : DEFAULTS.hotkey;
  data.inkTones = normalizeInkTones(data.inkTones);
  data.ink = normalizeInkIndex(data.ink);
  data.lastNote = typeof data.lastNote === 'string' && data.lastNote ? data.lastNote : null;
  data.bounds = data.bounds && typeof data.bounds === 'object' ? data.bounds : null;
  data.scroll = normalizeScroll(data.scroll);
  const rawTools = Array.isArray(data.tools) ? data.tools : null;
  data.tools = normalizeTools(data.tools);
  data.toolsOff = normalizeToolsOff(data.toolsOff, rawTools);

  data.hoverOpacity = clampNumber(data.hoverOpacity, LIMITS.hoverOpacity, DEFAULTS.hoverOpacity);
  data.stillMs = Math.round(clampNumber(data.stillMs, LIMITS.stillMs, DEFAULTS.stillMs));
  data.fadeMs = Math.round(clampNumber(data.fadeMs, LIMITS.fadeMs, DEFAULTS.fadeMs));
  data.revealMs = Math.round(clampNumber(data.revealMs, LIMITS.revealMs, DEFAULTS.revealMs));
  data.zoom = clampNumber(data.zoom, LIMITS.zoom, DEFAULTS.zoom);

  // 静止判定只在轮询到光标位置变化时才刷新，轮询太粗会把 stillMs 量化掉：
  // 用户设 300ms 实际可能 400ms 才亮。这里强制轮询间隔不超过静止门槛的 1/4。
  const poll = Math.round(clampNumber(data.pollInterval, LIMITS.pollInterval, DEFAULTS.pollInterval));
  const pollMax = Math.max(LIMITS.pollInterval[0], Math.floor(data.stillMs / 4));
  data.pollInterval = Math.max(LIMITS.pollInterval[0], Math.min(poll, pollMax));

  return data;
}

module.exports = function createConfig(dir) {
  const file = path.join(dir, 'config.json');
  let data = normalize(null);
  let salvaged = false; // 坏文件只留一次底，避免反复写盘

  /** 解析文件；null 表示文件还不存在、内容不是对象、或者坏掉了 */
  function parseFile() {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return null; // 还没写过配置：首次启动
    }
    try {
      // 去掉 BOM：用记事本之类工具手改过的文件可能带 BOM，JSON.parse 会直接失败
      const raw = JSON.parse(text.replace(/^\uFEFF/, ''));
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
    } catch (err) {
      console.error(`[chameleon] config.json 解析失败，先按现有设置运行：${err.message}`);
      if (!salvaged) {
        salvaged = true;
        try {
          // 手写的内容绝不直接覆盖，先留一份底
          fs.writeFileSync(`${file}.bak`, text, 'utf8');
          console.error(`[chameleon] 原文件已留底：${file}.bak`);
        } catch {
          /* 留底失败也不阻塞启动 */
        }
      }
      return null;
    }
  }

  function persist() {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error('[chameleon] 配置写入失败:', err.message);
    }
  }

  /** 启动时读：文件即将是全部设置，没写的键用默认值 */
  function load() {
    data = normalize(parseFile());
    return data;
  }

  /**
   * 外部改了配置文件（也包含程序自己刚写的那一下）：
   * **只覆盖文件里真正写出来的键**——手写一份精简配置时，笔记目录、窗口位置、
   * 阅读位置这些程序管理的键必须原样保留，绝不能因为文件里没写就被清掉。
   * 返回 { changed, data }；文件坏掉时返回 null（保持现状，什么都不动）。
   */
  function reload() {
    const raw = parseFile();
    if (!raw) return null;
    const next = normalize({ ...data, ...raw });
    const changed = JSON.stringify(next) !== JSON.stringify(data);
    data = next;
    if (changed) persist(); // 把钳制后的结果写回去，文件与内存保持一致
    return { changed, data };
  }

  function save(patch) {
    data = normalize({ ...data, ...patch });
    persist();
    return data;
  }

  return { file, load, reload, save, get: () => data };
};
