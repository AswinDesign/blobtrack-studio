# BlobTrack Studio

A browser-based blob-tracking visual effects studio. Turn a webcam, a video file or the built-in motion field into live tracked shapes, connections, labels and layered effects — then record the canvas or export a clip.

Everything runs locally in the browser. No build step, no dependencies, no uploads.

## Run it

ES modules need a real HTTP origin, so serve the folder rather than opening `index.html` from disk:

```bash
cd blobtrack-studio
python -m http.server 4173
```

Open <http://localhost:4173>. Any static server works (`npx serve`, VS Code Live Server, etc.).

- Camera access requires `localhost` or HTTPS and a permission prompt.
- Chrome or Edge is recommended for MP4 recording; Firefox exports WebM.

## Features

**Sources**
- Built-in procedural motion field (works with no camera or files)
- Webcam with device picker, mirror and fit modes
- Video upload or drag-and-drop with seek, speed, loop and mute controls

**Tracking**
- Threshold plus six invert modes: luminance (classic dark blobs), red / green / blue channels, and saturation
- Minimum blob size, maximum blob count, position smoothing
- Fast / balanced / precise detection resolution
- Draggable region-of-interest mask

**Shapes**
- 12 styles: circle, square, diamond, hex, star, target, cross, X frame, bracket, L frame, dot, ring
- Uniform or size-from-blob scaling
- Stroke width, glow, fill and opacity, dashed outlines
- Per-blob colors with seven palettes
- Blob invert modes: full negative, luminance, red / green / blue channels, saturation, hue rotation and a cutout matte that punches blob-shaped holes out of a filled stage

**Connections**
- Nearest neighbor, chain, mesh and constellation (minimum spanning tree)
- Density, maximum distance, line width, color, curve and dash options
- Connect at blob centers or edges; optionally use blob colors

**Labels and captions**
- Track ID, sequential number, callsign or custom text per blob
- Position, size and color
- Scene caption with top / center / bottom placement

**Effects**
- Blur, pixelate, dither, thermal, X-ray, edge, water, glitch, bloom, invert, backdrop and zoom
- Invert effect with seven styles: full negative, luminance, red / green / blue channels, saturation and hue rotation
- Film grain, scanlines, grid, vignette, particles, frame and pulse overlays
- Optional “BLOBTRACK” watermark

**Audio**
- Music file with volume and loop controls
- Three generative synth modes: deep pulse, neon arp and drift drone
- Microphone routed to the recording only (no feedback)
- Recording mix includes music, synth and mic

**Output**
- Aspect ratios: 16:9, 9:16, 1:1, 4:3
- 720p, 1080p or 1440p at 30 or 60 fps
- Standard / high / maximum bitrate
- Manual recording, guided export with progress and auto-stop, PNG snapshots
- MP4 (H.264/AAC) when the browser supports `MediaRecorder`, otherwise WebM (VP9/VP8 + Opus)

**Looks and UI**
- Six built-in presets: Neon Field, Thermal Scan, Blueprint, Terminal, Rave, Film Study
- Randomizer for quick exploration
- Custom presets saved in the browser and removable from the look bar
- Zen mode, keyboard shortcuts, mobile bottom-sheet controls, local settings persistence

## Shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `R` | Start / stop recording |
| `S` | Save PNG snapshot |
| `H` | Zen mode |
| `M` | Mute preview |
| `Esc` | Cancel ROI, close dialogs or leave Zen mode |

## Recording notes

- The canvas is captured, not the interface.
- Recording and export happen in real time, so keep the tab visible while capturing.
- Demo and camera exports record a fixed-length clip; video-file exports record the clip from the start and stop at its end.
- Export resolution and bitrate are independent of the on-screen preview size.
- MP4 availability depends on the browser build. If MP4 is unsupported the same controls produce a WebM file.

## Project structure

```
index.html          Markup, panels, dialogs and SVG icon sprite
css/styles.css      Dark studio UI, responsive layout, mobile sheet, Zen mode
js/state.js         Defaults, palettes, built-in presets, localStorage helpers
js/engine.js        Source painting, blob detection, tracking, links, labels, composition
js/shapes.js        Shape geometry and drawing
js/color.js         Color conversion and blob invert helpers
js/effects.js       Post-processing effects and screen overlays
js/audio.js         Web Audio graph, music, generative synth, mic and recorder bus
js/main.js          UI wiring, source switching, transport, presets, ROI, recording/export
```

The app uses Canvas 2D for detection and rendering, ES modules for code organization, `MediaRecorder` plus `canvas.captureStream()` for export, and Web Audio for the soundtrack.

## Limitations

- All processing is client-side; large videos and high export settings depend on the machine.
- Camera and microphone need permission and a secure origin.
- Custom presets and visual settings live in `localStorage` on this browser only; ROI is intentionally not persisted.
- Downloads are generated in real time and may take as long as the clip itself.

---

Original implementation. Not affiliated with any third-party blob-tracking site.
