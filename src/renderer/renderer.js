'use strict';

/**
 * 渲染进程：只负责界面与交互，所有文件 / 屏幕取色能力都在主进程。
 * 注意：index.html 的 CSP 为 default-src 'none'，不得引入任何外部资源。
 */

const api = window.chameleon;
const $ = (id) => document.getElementById(id);

const el = {
  frame: document.querySelector('.frame'),
  overlay: $('overlay'),
  notes: $('notes'),
  filter: $('filter'),
  doc: $('doc'),
  article: $('article'),
  meta: $('meta'),
  tip: $('tip'),
  leftTools: $('leftTools'),
  rightTools: $('rightTools'),
  btnCloseFiles: $('btnCloseFiles'),
};

/**
 * 顶栏按钮表：符号写死。pin / stealth 的符号必须跟着状态变（用户靠它分辨有没有点成功），
 * 所以不开放自定义符号——外部设置只能控制「显示哪些、什么顺序」（config.tools）。
 * files 站在左侧拖动区，其余按钮按配置顺序排在右侧；顺序由 config 决定，不插队硬写。
 */
const TOOLS = [
  { id: 'files', zone: 'left', glyph: () => '≡', tip: () => '文件列表' },
  {
    id: 'pin',
    zone: 'right',
    glyph: () => (state.pinned ? '>' : '<'),
    tip: () => (state.pinned ? '置顶中' : '未置顶'),
  },
  {
    id: 'stealth',
    zone: 'right',
    glyph: () => (state.stealth ? '\\' : '/'),
    tip: () => (state.stealth ? '隐身中' : '常显中'),
  },
  {
    id: 'ink',
    zone: 'right',
    glyph: () => '+',
    tip: () => `文字颜色：${inkLabel(state.ink)}`,
  },
  { id: 'hide', zone: 'right', glyph: () => '–', tip: () => '隐藏窗口' },
  { id: 'quit', zone: 'right', glyph: () => '×', tip: () => '退出程序' },
];

/** 已渲染出来的按钮，按 id 索引；按钮被配置隐藏时就是空的 */
const buttons = new Map();
/** 当前已渲染的工具列表签名，配置里其它键改变时不重画顶栏 */
let renderedTools = '';

const ZOOM_MIN = 0.8;
const ZOOM_MAX = 1.6;

const state = {
  notes: [],
  current: null,
  currentDir: '',
  ink: 0,
  inkTones: [244, 198, 86, 21],
  pinned: true,
  stealth: false,
  minSize: { width: 120, height: 80 },
  zoom: 1,
  // 每篇读到哪儿（滚动像素）：启动时从配置载入，滚动后回写配置。
  // 只活动于 <userData>/config.json，绝不写进笔记文件。
  scroll: new Map(),
  scrollTimer: null,
  hintTimer: null,
  listRefreshId: 0,
};

/* ------------------------------------------------------------ 顶栏按钮 */

function inkLabel(ink) {
  const tone = state.inkTones[ink] ?? state.inkTones[0];
  if (tone >= 250) return '白';
  if (tone <= 5) return '黑';
  return `灰度 ${tone}`;
}

/** 按 config.tools（顺序）+ config.toolsOff（隐藏）渲染顶栏，不在 HTML 里写死 */
function renderTools(list, off) {
  const hidden = new Set(Array.isArray(off) ? off : []);
  const ids = (Array.isArray(list) && list.length ? list : TOOLS.map((tool) => tool.id)).filter(
    (id) => !hidden.has(id),
  );
  const key = ids.join(',');
  if (key === renderedTools) return;
  renderedTools = key;

  buttons.clear();
  hideTip();
  el.leftTools.textContent = '';
  el.rightTools.textContent = '';

  for (const id of ids) {
    const tool = TOOLS.find((item) => item.id === id);
    if (!tool) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--icon';
    button.dataset.tool = tool.id;
    (tool.zone === 'left' ? el.leftTools : el.rightTools).appendChild(button);
    buttons.set(tool.id, button);
  }
  for (const id of ids) refreshTool(id);
}

/** 按钮的符号与提示跟着状态走；按钮被配置隐藏时什么都不做 */
function refreshTool(id) {
  const button = buttons.get(id);
  const tool = TOOLS.find((item) => item.id === id);
  if (!button || !tool) return;
  const tip = tool.tip();
  button.textContent = tool.glyph();
  button.dataset.tip = tip;
  button.setAttribute('aria-label', tip);
  if (!el.tip.hidden) syncTip();
}

async function runTool(id) {
  switch (id) {
    case 'files':
      toggleOverlay();
      return;
    case 'pin':
      applyPinned(await api.setPinned(!state.pinned));
      return;
    case 'stealth':
      applyStealth(await api.setStealth(!state.stealth));
      return;
    case 'ink': {
      const next = (state.ink + 1) % state.inkTones.length;
      applyInk(next, state.inkTones);
      await api.setConfig({ ink: next });
      return;
    }
    case 'hide':
      api.hide();
      return;
    case 'quit':
      // 先记下当前读到哪儿并落盘，再退出——否则刚滚完立刻点 × 会丢掉最后一次位置
      rememberScroll();
      await flushScroll();
      api.quit();
  }
}

/* ------------------------------------------------------------ 文字颜色 */

/**
 * 窗口没有任何底色，所以不存在「配色」可算，只剩字色档位。
 * 四档字色都不加任何描边、光晕、阴影——字体外面一圈光/影是多余的（用户明确要求）。
 */
function applyInk(ink, tones) {
  if (Array.isArray(tones) && tones.length === 4) state.inkTones = tones.slice();
  state.ink = Number.isInteger(ink) && ink >= 0 && ink < state.inkTones.length ? ink : 0;
  const tone = state.inkTones[state.ink];
  document.documentElement.style.setProperty('--text', `rgb(${tone} ${tone} ${tone})`);
  document.documentElement.dataset.ink = String(state.ink);
  refreshTool('ink');
}

/* ---------------------------------------------------------------- 置顶 */

/**
 * 顶栏开关：默认始终置顶（开着），点一下改成普通窗口（谁在上面谁盖住它）。
 * 只改运行时状态，不落盘：每次启动都是置顶的，免得启动后被别的窗口盖住找不到。
 */
function applyPinned(pinned) {
  state.pinned = !!pinned;
  refreshTool('pin');
}

/* ---------------------------------------------------------------- 隐身 */

function applyStealth(stealth) {
  state.stealth = !!stealth;
  refreshTool('stealth');
}

/* ------------------------------------------------------------ 按钮提示 */

let tipAnchor = null;

function syncTip() {
  if (!tipAnchor || el.tip.hidden) return;
  const text = tipAnchor.dataset.tip;
  if (!text) {
    hideTip();
    return;
  }
  el.tip.textContent = text;
  const rect = tipAnchor.getBoundingClientRect();
  const frame = el.frame.getBoundingClientRect();
  const width = el.tip.offsetWidth;
  const left = rect.left - frame.left + rect.width / 2 - width / 2;
  el.tip.style.left = `${Math.round(Math.max(2, Math.min(frame.width - width - 2, left)))}px`;
  el.tip.style.top = `${Math.round(rect.bottom - frame.top + 5)}px`;
}

function hideTip() {
  tipAnchor = null;
  el.tip.hidden = true;
  el.tip.textContent = '';
}

function bindTips() {
  document.addEventListener('mouseover', (event) => {
    const target = event.target.closest('[data-tip]');
    if (!target) {
      hideTip();
      return;
    }
    if (target === tipAnchor) return;
    tipAnchor = target;
    el.tip.hidden = false;
    syncTip();
  });
  document.addEventListener('mousedown', hideTip);
}

/* ------------------------------------------------------------- 文件浮层 */

function openOverlay() {
  el.overlay.hidden = false;
  el.doc.hidden = true; // 打开列表就完全看不到笔记，只剩列表文字
  // 默认只看当前文件所在的那一层目录；清空筛选框即可看全部
  el.filter.value = state.currentDir ? `${state.currentDir}/` : '';
  renderList();
  el.filter.focus();
  el.filter.select();
  refreshNotesList();
}

function closeOverlay() {
  state.listRefreshId += 1;
  el.overlay.hidden = true;
  el.doc.hidden = false;
}

function toggleOverlay() {
  if (el.overlay.hidden) openOverlay();
  else closeOverlay();
}

/* ------------------------------------------------------------- 目录列表 */

async function refreshNotesList() {
  const refreshId = ++state.listRefreshId;
  try {
    const notes = await api.listNotes();
    if (refreshId !== state.listRefreshId || el.overlay.hidden) return;
    state.notes = notes;
    renderList();
  } catch (err) {
    if (refreshId !== state.listRefreshId || el.overlay.hidden) return;
    console.error('[chameleon] 刷新文件列表失败:', err);
    setMeta(`刷新文件列表失败：${err && err.message ? err.message : '未知错误'}`, true);
  }
}

function renderList() {
  const keyword = el.filter.value.trim().toLowerCase();
  const items = state.notes.filter((note) => !keyword || note.rel.toLowerCase().includes(keyword));
  el.notes.textContent = '';

  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty empty--side';
    empty.textContent = '无';
    el.notes.appendChild(empty);
    return;
  }

  // 一条一条陈列，不做分组；只在结果跨多个目录时把目录名一起写出来以免重名
  const withDir = new Set(items.map((note) => note.dir)).size > 1;
  for (const note of items) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'note';
    item.dataset.rel = note.rel;
    item.textContent = (withDir ? note.rel : note.name).replace(/\.(md|markdown)$/i, '');
    if (state.current === note.rel) item.classList.add('is-active');
    el.notes.appendChild(item);
  }
}

function markActive() {
  for (const node of el.notes.querySelectorAll('.note')) {
    node.classList.toggle('is-active', node.dataset.rel === state.current);
  }
}

/* ------------------------------------------------------------- 文档读取 */

function setMeta(text, transient) {
  if (el.meta.dataset.mode === 'transient' && !transient) return;
  el.meta.textContent = text;
  el.meta.dataset.mode = transient ? 'transient' : 'stable';
  clearTimeout(state.hintTimer);
  if (transient) {
    state.hintTimer = setTimeout(() => {
      el.meta.dataset.mode = 'stable';
      el.meta.textContent = state.current || '';
    }, 1600);
  }
}

function rememberScroll() {
  if (!state.current) return;
  const top = Math.round(el.doc.scrollTop);
  if (state.scroll.get(state.current) === top) return;
  state.scroll.set(state.current, top);
  saveScrollSoon();
}

/** 滚动过程中不写盘，停下来 0.5 秒才写一次，避免反复磨配置文件 */
function saveScrollSoon() {
  clearTimeout(state.scrollTimer);
  state.scrollTimer = setTimeout(flushScroll, 500);
}

/** 把「读到哪儿」落盘（写的是用户配置，不是笔记） */
function flushScroll() {
  clearTimeout(state.scrollTimer);
  state.scrollTimer = null;
  return api.setConfig({ scroll: Object.fromEntries(state.scroll) });
}

async function openNote(target) {
  if (!target) return;

  let payload;
  try {
    payload = await api.readNote(target);
  } catch (err) {
    setMeta(`读取失败：${err && err.message ? err.message : target}`, true);
    return;
  }

  rememberScroll();
  // rel 为 null：这是用户从外面拖进来的单个文件，不属于当前笔记文件夹
  const key = payload.rel || payload.abs;
  state.current = key;
  const rel = payload.rel || '';
  const cut = rel.lastIndexOf('/');
  state.currentDir = cut >= 0 ? rel.slice(0, cut) : '';
  el.article.innerHTML = payload.html;
  el.doc.scrollTop = state.scroll.get(key) || 0;
  setMeta(payload.rel || payload.abs, false);
  markActive();
  if (payload.rel) api.setConfig({ lastNote: payload.rel });
}

/** 从快捷方式 / exe 拖进来的文件夹或文件 */
async function onDropped(payload) {
  if (!payload) return;
  state.listRefreshId += 1;
  state.notes = payload.notes || [];
  state.current = null;
  el.filter.value = '';
  renderList();
  if (payload.file) await openNote(payload.file);
  else openFirstNote();
}

/* ------------------------------------------------------------- 缩放 */

function applyZoom(zoom) {
  state.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(zoom.toFixed(2))));
  document.documentElement.style.setProperty('--zoom', String(state.zoom));
  api.setConfig({ zoom: state.zoom });
}

/* --------------------------------------------------------------- 事件 */

function bindEvents() {
  el.notes.addEventListener('click', (event) => {
    const item = event.target.closest('.note');
    if (!item) return;
    closeOverlay();
    if (item.dataset.rel === state.current) return;
    openNote(item.dataset.rel);
  });

  el.filter.addEventListener('input', renderList);
  el.btnCloseFiles.addEventListener('click', closeOverlay);

  // 顶栏按钮由 config.tools 动态渲染，用事件委托绑一次就够：
  // 以后增删按钮只改 TOOLS 表，不用再往这里补监听
  el.frame.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tool]');
    if (button) runTool(button.dataset.tool);
  });

  el.doc.addEventListener('scroll', () => {
    clearTimeout(el.doc.__t);
    el.doc.__t = setTimeout(rememberScroll, 200);
  });

  // 链接：笔记内相对链接在窗口内跳转，外部链接交给系统浏览器
  el.doc.addEventListener('click', (event) => {
    const anchor = event.target.closest('a');
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute('href') || '';
    if (href.startsWith('note:')) {
      openNote(href.slice(5));
      return;
    }
    if (/^https?:/i.test(href)) window.open(href);
  });

  document.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!el.overlay.hidden) closeOverlay();
      else api.hide();
      return;
    }
    if (mod && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      toggleOverlay();
      return;
    }
    if (mod && (event.key === '=' || event.key === '+')) {
      event.preventDefault();
      applyZoom(state.zoom + 0.1);
      return;
    }
    if (mod && event.key === '-') {
      event.preventDefault();
      applyZoom(state.zoom - 0.1);
      return;
    }
    if (mod && event.key === '0') {
      event.preventDefault();
      applyZoom(1);
    }
  });

  // 拖拽缩放（无边框窗口需要自绘边缘）
  for (const handle of document.querySelectorAll('.rz')) {
    handle.addEventListener('pointerdown', async (event) => {
      if (event.button !== 0) return;
      const direction = handle.dataset.dir;
      const start = { x: event.screenX, y: event.screenY };
      const origin = await api.getBounds();
      if (!origin) return;
      handle.setPointerCapture(event.pointerId);
      api.setInteracting(true);
      let pending = null;
      let frame = 0;

      const move = (moveEvent) => {
        const dx = moveEvent.screenX - start.x;
        const dy = moveEvent.screenY - start.y;
        const next = { ...origin };
        if (direction.includes('e')) next.width = origin.width + dx;
        if (direction.includes('s')) next.height = origin.height + dy;
        if (direction.includes('w')) {
          next.width = origin.width - dx;
          next.x = origin.x + dx;
        }
        if (direction.includes('n')) {
          next.height = origin.height - dy;
          next.y = origin.y + dy;
        }
        if (next.width < state.minSize.width) {
          if (direction.includes('w')) next.x = origin.x + origin.width - state.minSize.width;
          next.width = state.minSize.width;
        }
        if (next.height < state.minSize.height) {
          if (direction.includes('n')) next.y = origin.y + origin.height - state.minSize.height;
          next.height = state.minSize.height;
        }
        pending = next;
        if (!frame) {
          frame = requestAnimationFrame(() => {
            frame = 0;
            if (pending) api.setBounds(pending);
          });
        }
      };

      const finish = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', finish);
        handle.removeEventListener('pointercancel', finish);
        if (pending) api.setBounds(pending);
        api.setInteracting(false);
      };

      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', finish);
      handle.addEventListener('pointercancel', finish);
    });
  }
}

function openFirstNote() {
  const last = state.pendingLast;
  if (last && state.notes.some((note) => note.rel === last)) {
    openNote(last);
    return;
  }
  if (state.notes.length) openNote(state.notes[0].rel);
  else setMeta('', false);
}

/* --------------------------------------------------------------- 启动 */

async function boot() {
  const data = await api.bootstrap();

  state.notes = data.notes;
  state.zoom = data.config.zoom || 1;
  state.pendingLast = data.config.lastNote;
  if (data.minSize) state.minSize = data.minSize;

  // 上次每篇读到哪儿，恢复出来；打开笔记时直接归位
  const savedScroll = data.config.scroll;
  if (savedScroll && typeof savedScroll === 'object') {
    for (const [key, top] of Object.entries(savedScroll)) {
      if (Number.isFinite(top)) state.scroll.set(key, top);
    }
  }

  document.documentElement.style.setProperty('--zoom', String(state.zoom));
  applyStealth(data.stealth);
  applyPinned(data.pinned);
  applyInk(data.config.ink, data.config.inkTones);
  renderTools(data.config.tools, data.config.toolsOff);

  bindTips();
  renderList();
  if (data.open) openNote(data.open);
  else openFirstNote();
  api.onOpened(onDropped);
  // 外部改了设置（设置窗口或直接改 config.json）就地生效，不用重启
  api.onConfig((payload) => {
    if (!payload || !payload.config) return;
    applyInk(payload.config.ink, payload.config.inkTones);
    renderTools(payload.config.tools, payload.config.toolsOff);
  });
}

bindEvents();
boot();
