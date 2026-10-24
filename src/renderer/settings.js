'use strict';

/**
 * 设置窗口：主窗口之外的独立普通窗口。
 * 只碰 config.json 里的这几项设置；笔记目录、上次打开的笔记、阅读位置等一概不碰，
 * 「恢复默认」也只改这四类设置（用户数据一个字都不动）。
 */

const api = window.chameleon;
const $ = (id) => document.getElementById(id);

const TOOL_META = [
  { id: 'files', glyph: '≡', name: '文件列表' },
  { id: 'pin', glyph: '>', name: '置顶' },
  { id: 'stealth', glyph: '/', name: '隐身' },
  { id: 'ink', glyph: '+', name: '文字颜色' },
  { id: 'hide', glyph: '–', name: '隐藏窗口' },
  { id: 'quit', glyph: '×', name: '退出程序' },
];

/**
 * 首尾两个按钮固定：文件列表永远在最左，退出程序永远在最右（它也是唯一的退出入口）。
 * 这两个不给勾选框、也不参与排序，中间四个才由用户拖着调。
 */
const FIXED_HEAD = 'files';
const FIXED_TAIL = 'quit';
const DRAGGABLE = TOOL_META.map((tool) => tool.id).filter(
  (id) => id !== FIXED_HEAD && id !== FIXED_TAIL,
);

const DEFAULT_INK_TONES = [244, 198, 86, 21];

/** 「恢复默认」只改这五个键，其它键（笔记目录、阅读位置…）一个字都不动 */
const RESET_PATCH = {
  hoverOpacity: 1,
  stillMs: 600,
  ink: 0,
  inkTones: DEFAULT_INK_TONES,
  tools: [FIXED_HEAD, ...DRAGGABLE, FIXED_TAIL],
  toolsOff: [],
};

const el = {
  opacity: $('opacity'),
  opacityValue: $('opacityValue'),
  still: $('still'),
  stillValue: $('stillValue'),
  tools: $('tools'),
  ink: $('ink'),
  preview: $('preview'),
  btnConfig: $('btnConfig'),
  btnReset: $('btnReset'),
  btnClose: $('btnClose'),
};

const state = {
  config: null,
  renderedTools: '',
  pending: null,
  timer: null,
  inFlight: 0,
};

/* ---------------------------------------------------------------- 落盘 */

/** 拖滑杆时不必每个像素都写盘，攒 120ms 写一次；松手（change）与开关类操作立刻写 */
function save(patch, immediate) {
  state.pending = { ...state.pending, ...patch };
  clearTimeout(state.timer);
  if (immediate) flush();
  else state.timer = setTimeout(flush, 120);
}

async function flush() {
  clearTimeout(state.timer);
  state.timer = null;
  const patch = state.pending;
  state.pending = null;
  if (!patch) return;
  state.inFlight += 1;
  try {
    // 主进程会做范围校验并返回最终生效的配置，这里按返回值回填（被钳了也能立刻看到）
    state.config = await api.setConfig(patch);
    render();
  } catch {
    /* 写入失败时保持界面现状，不打断用户 */
  } finally {
    state.inFlight -= 1;
  }
}

/* ---------------------------------------------------------------- 渲染 */

function render() {
  const conf = state.config;
  if (!conf) return;

  el.opacity.value = String(conf.hoverOpacity);
  el.opacityValue.textContent = `${Math.round(conf.hoverOpacity * 100)}%`;
  el.still.value = String(conf.stillMs);
  el.stillValue.textContent = `${conf.stillMs} ms`;

  renderTools();
  renderInk();
  renderPreview();
}

function renderTools() {
  const conf = state.config;
  const off = Array.isArray(conf.toolsOff) ? conf.toolsOff : [];
  const order = (Array.isArray(conf.tools) ? conf.tools : []).filter((id) =>
    TOOL_META.some((tool) => tool.id === id),
  );
  // 行位置只由拖动决定；勾选只改变显示与否，所以签名里必须带上隐藏状态
  const key = `${order.join(',')}|${off.join(',')}`;
  if (key === state.renderedTools) return; // 顺序与勾选都没变就不重画
  state.renderedTools = key;

  el.tools.textContent = '';
  for (const id of order) {
    const meta = TOOL_META.find((item) => item.id === id);
    if (meta) el.tools.appendChild(toolRow(meta, off));
  }
}

/** 首尾两个固定行没有勾选框与拖拽柄；中间四个可勾选、可上下拖动排序 */
function toolRow(meta, off) {
  const fixed = meta.id === FIXED_HEAD || meta.id === FIXED_TAIL;
  const on = fixed || !off.includes(meta.id);
  const row = document.createElement('li');
  row.className = on ? 'tool' : 'tool is-off';
  row.dataset.tool = meta.id;

  if (fixed) {
    // 占位，保持和可勾选行左边对齐
    const pad = document.createElement('span');
    pad.className = 'tool__pad';
    row.appendChild(pad);
  } else {
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'tool__check';
    check.checked = on;
    check.setAttribute('aria-label', meta.name);
    check.addEventListener('change', () => toggleTool(meta.id, check.checked));
    row.appendChild(check);
  }

  const glyph = document.createElement('span');
  glyph.className = 'tool__glyph';
  glyph.textContent = meta.glyph;
  const name = document.createElement('span');
  name.className = 'tool__name';
  name.textContent = meta.name;
  row.append(glyph, name);

  if (fixed) {
    const mark = document.createElement('span');
    mark.className = 'tool__mark';
    mark.textContent = '固定';
    row.appendChild(mark);
  } else {
    // 勾掉的行也留在原位，所以同样带拖拽柄
    row.dataset.drag = '1';
    const handle = document.createElement('span');
    handle.className = 'tool__handle';
    handle.textContent = '⋮⋮';
    handle.setAttribute('aria-hidden', 'true');
    row.appendChild(handle);
    bindDrag(row);
  }

  return row;
}

function renderInk() {
  el.ink.textContent = '';
  state.config.inkTones.forEach((tone, index) => {
    const item = document.createElement('label');
    item.className = 'ink__item';

    const label = document.createElement('span');
    label.className = 'ink__label';
    label.textContent = `位置 ${index + 1}`;

    const chip = document.createElement('span');
    chip.className = 'ink__chip';
    chip.style.backgroundColor = `rgb(${tone} ${tone} ${tone})`;

    const slider = document.createElement('input');
    slider.className = 'ink__range';
    slider.type = 'range';
    slider.min = '0';
    slider.max = '255';
    slider.step = '1';
    slider.value = String(tone);
    slider.setAttribute('aria-label', `位置 ${index + 1} 的灰度`);
    const value = document.createElement('output');
    value.className = 'ink__value';
    value.textContent = `灰度 ${tone}`;

    slider.addEventListener('input', () => {
      state.config.inkTones[index] = Number(slider.value);
      chip.style.backgroundColor = `rgb(${slider.value} ${slider.value} ${slider.value})`;
      value.textContent = `灰度 ${slider.value}`;
      renderPreview();
    });
    slider.addEventListener('change', () => {
      state.config.inkTones.sort((a, b) => b - a);
      render();
      save({ inkTones: state.config.inkTones.slice() }, true);
    });

    item.append(label, chip, slider, value);
    el.ink.appendChild(item);
  });
}

/** 两块小样：同一份字色与不透明度，分别叠在深底与浅底上，近似实际观感 */
function renderPreview() {
  const tone = state.config.inkTones[state.config.ink] ?? state.config.inkTones[0];
  el.preview.style.setProperty('--pv-ink', `rgb(${tone} ${tone} ${tone})`);
  el.preview.style.setProperty('--pv-alpha', `${Math.round(state.config.hoverOpacity * 100)}%`);
}

/* ------------------------------------------------------------ 顶栏按钮 */

function toggleTool(id, on) {
  // 只改「显示与否」，行在列表里的位置一动不动；位置只能靠拖动改
  const off = (state.config.toolsOff || []).filter((item) => item !== id);
  if (!on) off.push(id);
  state.config.toolsOff = off;
  render(); // 立刻反馈，不等写盘
  save({ toolsOff: off });
  const next = el.tools.querySelector(`[data-tool="${id}"] .tool__check`);
  if (next) next.focus();
}

/** 当前在列表里的可拖按钮（只有启用的按钮才有顺序可言） */
function draggableRows() {
  return [...el.tools.querySelectorAll('.tool[data-drag="1"]')];
}

/** 松手后把列表里的顺序写回配置（中间四个 + 固定首尾，一共六项） */
function commitOrder() {
  const ids = draggableRows().map((row) => row.dataset.tool);
  const next = [FIXED_HEAD, ...ids, FIXED_TAIL];
  if (next.join(',') === state.config.tools.join(',')) return;
  state.config.tools = next;
  save({ tools: next }, true);
}

/**
 * 按住行直接上下拖动排序（不再用上下箭头按钮）。
 * 拖动过程只改 DOM 顺序，松手才写配置——中途写盘会边拖边存、又慢又会抖。
 * 勾选框区域不参与拖动，点它照常开关按钮。
 */
function bindDrag(row) {
  let gesture = null;

  row.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('.tool__check')) return;
    gesture = { id: event.pointerId, startY: event.clientY, moved: false };
    // 捕获失败也不影响：事件照样会冒泡到这一行上
    try {
      row.setPointerCapture(event.pointerId);
    } catch {
      /* 忽略 */
    }
  });

  row.addEventListener('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (!gesture.moved) {
      if (Math.abs(event.clientY - gesture.startY) < 3) return; // 抖一下不算拖动
      gesture.moved = true;
      row.classList.add('is-dragging');
    }
    // 找第一个「指针已越过其垂直中点」的可拖行，插到它前面
    let before = null;
    for (const item of draggableRows()) {
      if (item === row) continue;
      const box = item.getBoundingClientRect();
      if (event.clientY < box.top + box.height / 2) {
        before = item;
        break;
      }
    }
    // before 为空表示落到整组末尾：插到固定尾行之前
    el.tools.insertBefore(row, before || el.tools.querySelector(`[data-tool="${FIXED_TAIL}"]`));
  });

  const finish = (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const moved = gesture.moved;
    gesture = null;
    row.classList.remove('is-dragging');
    if (moved) commitOrder();
  };
  row.addEventListener('pointerup', finish);
  row.addEventListener('pointercancel', finish);
}

/* ---------------------------------------------------------------- 事件 */

el.opacity.addEventListener('input', () => {
  const value = Number(el.opacity.value);
  state.config.hoverOpacity = value;
  el.opacityValue.textContent = `${Math.round(value * 100)}%`;
  renderPreview();
  save({ hoverOpacity: value });
});
el.opacity.addEventListener('change', () => save({ hoverOpacity: Number(el.opacity.value) }, true));

el.still.addEventListener('input', () => {
  const value = Number(el.still.value);
  state.config.stillMs = value;
  el.stillValue.textContent = `${value} ms`;
  save({ stillMs: value });
});
el.still.addEventListener('change', () => save({ stillMs: Number(el.still.value) }, true));

el.btnReset.addEventListener('click', () => {
  state.pending = null;
  state.timer = null;
  clearTimeout(state.timer);
  state.config = { ...state.config, ...RESET_PATCH, tools: RESET_PATCH.tools.slice() };
  render();
  save(RESET_PATCH, true);
});

el.btnConfig.addEventListener('click', () => api.showConfig());
el.btnClose.addEventListener('click', () => window.close());

/* ---------------------------------------------------------------- 启动 */

async function boot() {
  const data = await api.bootstrap();
  state.config = data.config;
  render();
  // 外部改了配置（手改 JSON / 别的窗口）也同步过来；
  // 自己刚写完的那一下以 setConfig 返回值为准，避免和输入框抢
  api.onConfig((payload) => {
    if (!payload || !payload.config || state.inFlight > 0) return;
    state.config = payload.config;
    render();
  });
}

boot();
