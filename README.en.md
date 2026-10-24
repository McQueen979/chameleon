<div align="center">

# Chameleon

Read docs at work without an extra window showing up on your screen.

[![version](https://img.shields.io/badge/version-0.1.0-success)](../../releases)
[![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D4)](#)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[简体中文](README.md) · [English](README.en.md)

<img src="docs/封面截图.png" width="820" alt="Chameleon floating a Markdown note over a web page">

</div>

The text floating on top of that page is the app. No frame, no background, no title bar — just glyphs.

## What it is

You often need to peek at something while working: an API doc, a command you keep forgetting, a note you just wrote. Opening a normal reader costs you a taskbar icon and a big slab of background, and anyone walking past can see it.

So this window draws nothing but text. It fades in only when you stop moving the mouse, and it is gone as soon as you move away. While it is gone, clicks go straight through to the app underneath.

That is where the name comes from: a chameleon does not change the room, it just blends into it.

## When it appears

![Reveal on stillness, hide on leave](docs/显隐设置.gif)

Moving the pointer around inside the window does nothing. Rest it and the document fades in, 0.6 s by default. Move away and it fades out.

Neither timing is hard-coded: the stillness threshold is adjustable in the settings window (250–2000 ms), and the fade duration lives in the config file, where 0 means an instant switch.

## Readable on any background

![Four grayscale ink levels](docs/四种颜色.gif)

White text for a dark wallpaper, black text for a light document. Drag the four gray values in the settings window and cycle through them with `+` in the top bar. All four are remembered.

## Daily use

1. Put the `.md` files you want in a folder
2. Drag the folder onto `Chameleon.exe` — no need to launch the app first
3. Rest the pointer in a corner, read a couple of lines, move away
4. Someone walks over? `Alt + Shift + Q` hides it, no mouse needed

The window has no taskbar entry and no tray icon; quit with `×` at the far right of the top bar.

## Shortcuts

| Action | Result |
| --- | --- |
| Pointer rests inside the window (0.6 s by default) | Fades in; scroll and select text |
| Pointer passes over or keeps moving | Stays hidden |
| Pointer leaves the window | Fades out, click-through restored |
| `Alt + Shift + Q` | Reveal / hide |
| `Ctrl + P` | Toggle file list |
| `Esc` | Close the list, otherwise hide the window |
| `Ctrl + +` / `Ctrl + -` / `Ctrl + 0` | Zoom in / out / reset |

The window is borderless; drag any edge or corner to resize, down to 120 × 80.

## Settings

Settings live in their own window, so the reading window never grows extra buttons. Open it from the "Chameleon Settings" desktop shortcut, or run `Chameleon.exe --settings`.

| Item | Meaning | Range |
| --- | --- | --- |
| Opacity | How see-through the window is while revealed | 0.15 – 1 |
| Stillness threshold | How long the pointer must rest | 250 – 2000 ms, default 600 |
| Top-bar buttons | Tick to show, drag rows to reorder | — |
| Ink levels | Four gray values, sorted light to dark | 0 black – 255 white |

The file list button `≡` is pinned left and quit `×` is pinned right; neither can be hidden. The four in between can be unticked or dragged. Unticking hides a button but keeps its row in place.

## Config file

`%APPDATA%\chameleon\config.json`. Edits take effect as soon as you save — no restart — and every value is clamped back into a sane range, so a typo cannot make the window disappear for good.

The keys you are likely to touch: `notesDir`, `hotkey`, `hoverOpacity`, `inkTones`, `stillMs`, `fadeMs`, `revealMs`. Button order and visibility are stored separately in `tools` and `toolsOff`, which is why unticking something in the settings window leaves its row where it was.

## Build from source

Windows and Node.js 20.

```powershell
git clone https://github.com/McQueen979/chameleon.git
cd chameleon

# Electron binaries are fetched from GitHub, which is unreliable in some networks
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
npm install

npm start          # normal run
npm run dev        # devtools open, runtime log printed
npm run build      # portable build
```

`npm run build` works offline: it assembles the Electron runtime already sitting in `node_modules` into a portable folder at `dist\Chameleon`, and drops two shortcuts on the desktop. No electron-builder, no NSIS download.

## Layout

```
chameleon/
├─ src/
│  ├─ main/       window, hover reveal, click-through, config, Markdown rendering
│  ├─ preload/    contextBridge allow-list
│  └─ renderer/   reading view and settings window
├─ docs/          screenshots and demo GIFs
├─ build.ps1      portable build script
├─ CHANGELOG.md
└─ package.json
```

## Markdown

Headings, lists, blockquotes, fenced code, tables and rules all render normally. Relative links between notes open inside the window; `http(s)` links go to the system browser.

Raw HTML shows up as text, bare URLs are not auto-linked, and `- [ ]` stays plain text. Images are not loaded because the window blocks every external resource request; the text is unaffected.

There used to be a nasty bug: a single link anywhere in a note made the whole document fail to render. Rendering now degrades in stages, so the worst case is plain text for that one note.

## Limitations

- Windows only, strictly read-only, no editing
- `.md` and `.markdown` only
- The file list scans on open instead of watching the folder, filters by file name, and has no full-text search
- Changing the notes folder means editing the config file; there is no in-app switcher
- You pick the ink level yourself; it does not sample the background
- Scroll positions are stored in pixels, so changing zoom can shift the restored position
- If another app owns the hotkey, double-click the executable to bring the window back

## Version

Semantic versioning; every change is listed in [CHANGELOG.md](CHANGELOG.md), downloads are on [Releases](../../releases).

## License

MIT.
