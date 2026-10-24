<div align="center">

# Chameleon

**Read docs at work without anyone noticing another window.**

A transparent, borderless Markdown reader for Windows · fades in after the pointer rests still (0.6 s by default) and vanishes the moment you move away

[![version](https://img.shields.io/badge/version-0.1.0-success)](../../releases)
[![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D4)](#)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[简体中文](README.md) · [English](README.en.md)

</div>

<!--
  Image slot ① — hero screenshot: docs/hero.png (1600×1000, dark background, window revealed)
  <img src="docs/hero.png" width="780" alt="Chameleon floating above a code editor">
-->

## Why "Chameleon"

A chameleon changes color to blend into its surroundings so that nothing notices it.

Chameleon the app does the same thing: no frame, no background, no shadow, no taskbar entry — only text drawn directly on top of whatever is behind it. Look at it and it is there; move the pointer away and it disappears, restoring click-through so the app underneath keeps working. **On screen it looks exactly like nothing happened.**

## Using it while you should be working

1. Put the Markdown files you want to read in a folder.
2. Drag that folder (or a single `.md` file) **onto `Chameleon.exe`** — no need to launch it first.
3. Rest the pointer in a corner → the document fades in → scroll a little → move away → the screen is instantly back to normal.
4. Press `Alt + Shift + Q` to reveal or hide it globally, without hunting for the mouse.

Handy while a build runs, during a meeting, or whenever someone might walk past your desk.

<!--
  Image slot ② — demo GIFs: docs/demo-reveal.gif / demo-hide.gif / demo-ink.gif / demo-files.gif
  Keep each under 2 MB, ~640 px wide. Delete the first and last line of this comment to enable.
| Reveal on stillness | Hide on leave |
| --- | --- |
| <img src="docs/demo-reveal.gif" width="380" alt="Fades in after the mouse rests still"> | <img src="docs/demo-hide.gif" width="380" alt="Fades out and restores click-through"> |

| Cycling the four ink levels | File list with `Ctrl + P` |
| --- | --- |
| <img src="docs/demo-ink.gif" width="380" alt="Cycling four grayscale ink levels"> | <img src="docs/demo-files.gif" width="380" alt="File list overlay"> |
-->

## Why not just use another Markdown reader?

| | Typical reader | Chameleon |
| --- | --- | --- |
| Appearance | Title bar, background, shadow | Text only, borderless |
| Visibility | Close or minimize manually | Appears on still pointer, hides on leave |
| Footprint | Occupies taskbar, covers content | No taskbar entry; click-through when hidden |
| Safety | Usually editable | Read-only by design |
| Install | Installer | Unzip and run, USB-friendly |

## ✨ Features

- **Zero-chrome overlay**: borderless, backgroundless, shadowless; adapts to any wallpaper or app underneath.
- **Reveal on stillness**: fades in after the pointer rests inside the window — **0.6 s by default, adjustable from 250 to 2000 ms in the settings window**. Passing over or moving never reveals it.
- **Hide on leave**: 180 ms fade-out by default (configurable), plus a 16 px hysteresis so edges do not flicker; click-through is restored immediately.
- **Global hotkey** `Alt + Shift + Q`; after revealing, it stays visible for about 2 s (configurable), then resumes hiding.
- **Four adjustable grayscale ink levels** (0–255 each), sorted light to dark and cycled with the `+` button; no outline, glow, or shadow on text.
- **Adjustable opacity** from 0.15 to 1 while revealed.
- **Stealth / pin toggles** in the top bar.
- **Settings live in a separate window**, so the reading window never grows extra controls.
- **Reading position memory**, saved before exit.
- **File list** with `Ctrl + P`; the document is fully hidden while the list is open, filterable by file name.
- **Drag & drop** a folder or a `.md` file onto the executable.
- **Read-only**: there is no code path that writes to your notes.
- **Portable**: one folder you can copy to a USB stick.

## 📥 Download

Grab `Chameleon.zip` from [Releases](../../releases/latest), unzip anywhere, run `Chameleon.exe`.

- No installer, no admin rights.
- The binary is unsigned; on first run SmartScreen may warn → "More info" → "Run anyway".
- On first launch there are no notes: drag a folder or a single `.md` file **onto `Chameleon.exe`**.

| Requirement | Value |
| --- | --- |
| OS | Windows 10 / 11 (x64) |
| Runtime | None — Electron is bundled |
| Unzipped size | ~270 MB |

## ⌨️ Shortcuts

| Action | Result |
| --- | --- |
| Pointer still inside the window (0.6 s by default) | Fade in; scroll and select text |
| Pointer passing over, or still moving | Stays invisible |
| Pointer leaves the window | Fade out, click-through restored |
| `Alt + Shift + Q` | Reveal / hide |
| `Ctrl + P` | Toggle file list |
| `Esc` | Close list, otherwise hide window |
| `Ctrl + +` / `Ctrl + -` / `Ctrl + 0` | Zoom in / out / reset |

## ⚙️ Settings

Settings open in a separate window: `Chameleon.exe --settings`, or the "Chameleon Settings" desktop shortcut created by the build script.

| Setting | Description | Range |
| --- | --- | --- |
| Opacity | Window opacity while revealed | 0.15 – 1 |
| Stillness threshold | How long the pointer must rest | 250 – 2000 ms (default 600) |
| Top-bar buttons | Show/hide and drag to reorder | — |
| Ink levels | Four grayscale values (0 black – 255 white) | — |

The file list button `≡` is pinned left and `×` (quit) is pinned right; both are always visible. Unchecking a middle button only hides it — its row keeps its position.

## 🎨 Configuration

`%APPDATA%\chameleon\config.json`, written atomically (temp file + rename) and watched at runtime, so manual edits apply immediately. Every value is validated on write.

Keys: `notesDir`, `hotkey`, `ink`, `inkTones`, `hoverOpacity`, `tools`, `toolsOff`, `lastNote`, `scroll`, `zoom`, `stillMs` (default 600), `fadeMs` (default 180, 0 = instant), `revealMs` (default 2000).

## 🛠 Build from source

Windows + Node.js 20.

```powershell
git clone https://github.com/McQueen979/chameleon.git
cd chameleon

$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'   # only behind the GFW
npm install

npm start
npm run build      # portable folder in dist\Chameleon\
```

The build is fully offline: it assembles the Electron runtime already present in `node_modules` instead of fetching electron-builder or NSIS.

## 🧩 Markdown support

Standard syntax: headings, lists, blockquotes, fenced code, tables, rules. Relative links between notes open inside the window, `http(s)` links go to the system browser. Raw HTML is shown as text; bare URLs are not auto-linked; `- [ ]` renders as plain text. Images are not fetched (the window blocks all external resource requests); text is unaffected. Rendering degrades gracefully, so a single problematic construct never blanks the whole document.

## ⚠️ Known limitations

- Windows only; strictly read-only, no editing.
- `.md` and `.markdown` files only.
- The file list scans on open (no live watch), filters by file name only, and has no full-text search.
- The notes folder is changed via the config file; there is no in-app switcher.
- Ink level must be picked manually for the background behind the window.
- Scroll positions are stored in pixels, so changing zoom may shift the restored position.

## 🗺️ Roadmap

- [x] v0.1.0 — transparent overlay, hover reveal, read-only browsing, portable build
- [ ] Single-file exe and code signing
- [ ] Optional in-note image rendering
- [ ] Full-text search and multiple collections

## 📄 License

[MIT](LICENSE)
