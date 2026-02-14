# CLAUDE.md

## Project Overview

Photo ID Generator — a static web application for uploading photos, cropping them to ID/passport dimensions, removing backgrounds using AI, and exporting print-ready layouts. Features a one-click pipeline with auto face detection, smart cropping, and compliance checking. Runs entirely in the browser with no server required. Licensed under GPLv3.

## Tech Stack

- **Frontend:** Vanilla JavaScript (ES modules), HTML, CSS — no framework, no build step
- **Image Cropping:** CropperJS v1.5.12 (loaded from CDN)
- **Background Removal (browser):** Transformers.js (`@huggingface/transformers` v3) with `briaai/RMBG-1.4` ONNX model, runs via WebAssembly in-browser
- **Face Detection:** MediaPipe Face Landmarker (`@mediapipe/tasks-vision` v0.10.32), ~3MB model, runs on main thread
- **Background Removal (optional backend):** Python Flask server with Hugging Face `transformers` pipeline on GPU
- **Image Processing:** Canvas API (browser), Pillow (backend)
- **Fonts:** Google Fonts (Inter, weights 400/500/600)

## Repository Structure

```
├── index.html              # Single-page static HTML (entry point)
├── static/
│   ├── app.js              # Frontend logic: ES module with cropper, inference, face detection, compliance
│   ├── worker.js           # Web Worker for background removal inference (RMBG-1.4)
│   └── style.css           # Styling (plain CSS, Inter font, blue theme)
├── app.py                  # Optional Flask backend for GPU-accelerated inference
├── requirements.txt        # Python dependencies (for optional backend only)
├── RESEARCH-IMAGE-MODELS.md # Research on image editing models and upgrade paths
├── plan.md                 # Implementation plan for one-click pipeline
├── README.md               # Setup, usage, and deployment guide
├── LICENSE                 # GPLv3
└── .gitignore              # Standard Python gitignore
```

## Running the Application

### Static site (no server)

Open `index.html` in a browser, or serve with any static file server:

```bash
python3 -m http.server 8000
# or: npx serve .
```

Background removal runs in-browser via Transformers.js/ONNX (RMBG-1.4 model, ~45MB, downloaded on first use).
Face detection runs via MediaPipe (~3MB model, lazy-loaded on first use).

### With optional backend (GPU-accelerated)

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

Select "Backend Server" mode in the UI. Requires a GPU.

### Deployment

Deployed as a static site on **Cloudflare Pages**.

- **Production URL:** https://id-photo-editor.cdrift.com
- **Pages URL:** https://id-photo-editor.pages.dev
- **Project name:** `id-photo-editor`
- **Custom domain:** `id-photo-editor.cdrift.com` (CNAME configured in Cloudflare dashboard)
- **Build step:** None — static files served from repo root

Deploy via CLI:
```bash
npx wrangler pages deploy . --project-name id-photo-editor --branch main --commit-dirty=true
```

## Architecture

### Frontend (`static/app.js`)

ES module with dynamic imports from CDN. Key features:

- **One-click pipeline** — upload photo + select preset → auto face detection → background removal → smart crop → compliance check → export-ready photo
- **Manual step-by-step wizard** — 5-step flow (Upload → Background → Adjust → Crop → Export) for full control
- **Face detection** — MediaPipe Face Landmarker (478 landmarks), lazy-loaded via dynamic `import()`, runs on main thread (~50ms per image)
- **Auto face centering** — computes crop rectangle from face landmarks to center face at ~60% frame height with ~12% top margin
- **Compliance checking** — per-preset rules validate head height ratio, eye position, horizontal centering, head tilt, face-in-frame, and top margin
- **Dual inference modes** — browser (Transformers.js/ONNX) or backend (Flask API), selectable via radio buttons
- **Backend auto-detection** — probes `/remove_background` on load, shows availability status
- **Model loading with progress** — progress bar during ONNX model download
- **Web Worker inference** — ML model runs in a separate thread to keep UI responsive
- **Image upload** via FileReader API with drag-and-drop
- **CropperJS integration** with configurable aspect ratio from width/height inputs
- **Adaptive zoom** via mouse wheel (scroll speed scales zoom factor, capped at 0.1)
- **Keyboard navigation** (arrow keys, 10px step) for crop box or image movement
- **DPI conversion** at 300 DPI: `inches * 300` or `cm * 300 / 2.54`
- **Crop & Save** exports cropped canvas as `photo_id.png`
- **4x6 Layout** tiles cropped photos onto a 1200x1800px (4x6 inch @ 300 DPI) canvas, downloads as `photo_id_4x6.png`
- **Error handling** on all async operations with user-visible status messages
- **Input validation** on width/height before cropper initialization
- **CONFIG object** centralizes all constants (DPI, canvas size, CDN URLs, zoom factors)

### Web Worker (`static/worker.js`)

Runs RMBG-1.4 (`briaai/RMBG-1.4`) for background removal segmentation:
- Model loaded via `AutoModel.from_pretrained` with `dtype: "fp32"`
- Processor auto-configured via `AutoProcessor.from_pretrained`
- Inference: input → pixel_values → model output → `.mul(255)` → resize mask to original dimensions
- Message protocol: `load-model` / `inference` → `model-ready` / `result` / `error` / `progress`

### Optional Backend (`app.py`)

Two routes:
- `GET /` — serves `index.html`
- `POST /remove_background` — accepts multipart form image, runs RMBG-1.4 segmentation on GPU, composites onto white background, returns PNG

Config via environment variables:
- `RMBG_MODEL` — model ID (default: `briaai/RMBG-1.4`)
- `RMBG_DEVICE` — GPU device index (default: `0`)
- `FLASK_DEBUG` — set to `1` to enable debug mode (default: off)
- `PORT` — server port (default: `5000`)

CORS enabled for cross-origin frontend hosting.

### Styling (`static/style.css`)

Plain CSS with design tokens (CSS custom properties). Color scheme: `#2563eb` (primary blue), `#fafafa` (background), `#111827` (text). Includes one-click panel, compliance indicators, status toast, progress bar, and settings drawer styles. Responsive breakpoints at 768px and 480px.

## Development Conventions

### JavaScript
- ES module with `import` from CDN — no bundler, no npm
- Dynamic `import()` for lazy-loading MediaPipe (only loaded when face detection is needed)
- DOM element references cached in `dom` object at file top
- Event listeners attached directly to elements in `attachEventListeners()`
- CropperJS loaded via CDN `<script>` tag (non-module)
- Transformers.js loaded via CDN ES module import in worker
- State managed via global `state` object

### CSS
- Design tokens in `:root` (colors, spacing, radii, shadows, transitions)
- Element-level selectors with section comments
- Responsive media queries at 768px and 480px breakpoints

### HTML
- Plain static HTML — no templating engine
- External resources (CropperJS, Google Fonts, Transformers.js, MediaPipe) loaded from CDNs

### Python (optional backend)
- Dependencies managed via `requirements.txt`
- Config via environment variables
- Debug mode off by default

## Key Constants

| Constant | Value | Location |
|----------|-------|----------|
| DPI | 300 | `static/app.js` CONFIG |
| 4x6 canvas | 1200x1800px | `static/app.js` CONFIG |
| Arrow key step | 10px | `static/app.js` CONFIG |
| Base zoom factor | 0.02 | `static/app.js` CONFIG |
| Max zoom factor | 0.1 | `static/app.js` CONFIG |
| BG removal model | briaai/RMBG-1.4 | `static/worker.js` |
| Face detection model | MediaPipe Face Landmarker float16 | `static/app.js` CONFIG |
| MediaPipe version | @mediapipe/tasks-vision@0.10.32 | `static/app.js` CONFIG |

## Compliance Rules (per preset)

Each preset in `PRESETS` includes a `compliance` object with country-specific rules:

| Rule | Description | Example (US Passport) |
|------|-------------|----------------------|
| `headHeightMin/Max` | Head height as fraction of frame height | 50%–69% |
| `eyeHeightMin/Max` | Eye position from bottom as fraction | 56%–69% |
| `maxTiltDegrees` | Maximum head roll angle | 5° |
| Top margin | Space above head (computed, 8%–15%) | 8%–15% |
| Face in frame | Entire face within crop boundaries | boolean |
| Horizontal center | Face center deviation from midpoint | < 5% |
