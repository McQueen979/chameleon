'use strict';

/**
 * 笔记（.md）的扫描与渲染。
 *
 * 这里**只读**，故意不提供任何写入能力：整个程序没有任何代码路径会修改用户的笔记文件，
 * 从机制上就不存在误写 / 误删的风险。
 * 安全约定：
 * - 所有路径都必须落在笔记文件夹内（防目录穿越）
 * - Markdown 渲染关闭 HTML 与 linkify，避免笔记内容注入脚本
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const MarkdownIt = require('markdown-it');

const EXTENSIONS = new Set(['.md', '.markdown']);
const IGNORED_DIRS = new Set(['node_modules', '.git', '.obsidian', '.trash', '.vscode', '.idea']);
const MAX_DEPTH = 8;

module.exports = function createNotes() {
  const options = { html: false, linkify: false, typographer: true, breaks: false };
  const md = new MarkdownIt(options);
  // 不带任何自定义渲染规则的实例：自定义规则万一抛错时用它重渲染，至少保住排版
  const plain = new MarkdownIt(options);

  /** 相对路径统一使用 / 分隔 */
  const toPosix = (p) => p.split(path.sep).join('/');

  function resolveInside(root, rel) {
    if (!root) throw new Error('未设置笔记文件夹');
    const abs = path.resolve(root, rel);
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    if (abs !== root && !abs.startsWith(rootWithSep)) {
      throw new Error('路径超出笔记文件夹范围');
    }
    return abs;
  }

  function isInside(root, abs) {
    if (!root) return false;
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    return abs === root || abs.startsWith(rootWithSep);
  }

  /** 把图片 / 相对链接改写为可用的绝对地址 */
  function rewriteAsset(raw, baseDir) {
    const value = String(raw).trim();
    if (!value) return raw;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      if (/^file:/i.test(value)) return value;
      return value; // http(s) / data 等原样保留
    }
    if (value.startsWith('#')) return value;
    const clean = value.split('#')[0].split('?')[0];
    let decoded = clean;
    try {
      decoded = decodeURIComponent(clean);
    } catch {
      /* 保留原样 */
    }
    const abs = path.resolve(baseDir, decoded);
    return pathToFileURL(abs).href;
  }

  const defaultImage = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const attrIdx = token.attrIndex('src');
    if (attrIdx >= 0) {
      token.attrs[attrIdx][1] = rewriteAsset(token.attrs[attrIdx][1], env.baseDir);
    }
    return defaultImage(tokens, idx, options, env, self);
  };

  // markdown-it 没有内置 link_open 规则（只有 image 等少数几个），必须自己兜底成 renderToken
  const defaultLinkOpen =
    md.renderer.rules.link_open || ((tokens, idx, opt, env, self) => self.renderToken(tokens, idx, opt));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const attrIdx = token.attrIndex('href');
    if (attrIdx >= 0) {
      const href = token.attrs[attrIdx][1];
      if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#')) {
        const clean = href.split('#')[0];
        if (clean) {
          let decoded = clean;
          try {
            decoded = decodeURIComponent(clean);
          } catch {
            /* 保留原样 */
          }
          token.attrs[attrIdx][1] = `note:${path.resolve(env.baseDir, decoded)}`;
        }
      }
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
    return String(text).replace(/[&<>"]/g, (ch) => map[ch]);
  }

  /**
   * 渲染一篇笔记。任何语法 / 路径异常都不能让整篇读不出来：
   * 自定义规则出错时退回无自定义规则的渲染（排版还在），仍失败则退回纯文本。
   */
  function renderSafe(raw, baseDir) {
    try {
      return md.render(raw, { baseDir });
    } catch {
      try {
        return plain.render(raw);
      } catch {
        return `<pre>${escapeHtml(raw)}</pre>`;
      }
    }
  }

  /** 递归扫描笔记文件夹 */
  function list(root) {
    const out = [];
    if (!root) return out;

    const walk = (dir, depth) => {
      if (depth > MAX_DEPTH) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const name = entry.name;
        if (name.startsWith('.')) continue;
        const abs = path.join(dir, name);
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(name)) continue;
          walk(abs, depth + 1);
        } else if (entry.isFile()) {
          if (!EXTENSIONS.has(path.extname(name).toLowerCase())) continue;
          let stat;
          try {
            stat = fs.statSync(abs);
          } catch {
            continue;
          }
          const rel = toPosix(path.relative(root, abs));
          out.push({
            rel,
            name,
            dir: toPosix(path.dirname(rel)) === '.' ? '' : toPosix(path.dirname(rel)),
            mtime: stat.mtimeMs,
            size: stat.size,
          });
        }
      }
    };

    walk(root, 0);
    out.sort((a, b) => a.rel.localeCompare(b.rel, 'zh-Hans-CN'));
    return out;
  }

  function titleOf(raw, fallback) {
    const match = raw.match(/^\s*#\s+(.+?)\s*$/m);
    if (match) return match[1].trim();
    return fallback.replace(/\.(md|markdown)$/i, '');
  }

  /**
   * 读取并渲染一篇笔记。
   * 传相对路径 → 必须在笔记文件夹内；
   * 传绝对路径 → 视为用户主动拖进来的文件，允许读（依旧只读，绝不写）。
   */
  async function read(root, target) {
    const abs = path.isAbsolute(target) ? path.resolve(target) : resolveInside(root, target);
    if (!EXTENSIONS.has(path.extname(abs).toLowerCase())) throw new Error('只支持 .md 文件');
    const raw = await fsp.readFile(abs, 'utf8');
    const html = renderSafe(raw, path.dirname(abs));
    const inside = isInside(root, abs);
    return {
      rel: inside ? toPosix(path.relative(root, abs)) : null,
      abs,
      html,
      title: titleOf(raw, path.basename(abs)),
      mtime: (await fsp.stat(abs)).mtimeMs,
    };
  }

  return { list, read, resolveInside, toPosix };
};
