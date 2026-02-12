# CLAUDE.md

## Project Overview

Photo ID Generator — a static web application for uploading photos, cropping them to ID/passport dimensions, removing backgrounds using AI, and exporting print-ready layouts. Runs entirely in the browser with no server required. Licensed under GPLv3.

## Tech Stack

- **Frontend:** Vanilla JavaScript (ES modules), HTML, CSS — no framework, no build step
- **Image Cropping:** CropperJS v1.5.12 (loaded from CDN)
- **Background Removal (browser):** Transformers.js (`@huggingface/transformers` v3) with `briaai/RMBG-1.4` ONNX model, runs via WebAssembly in-browser
- **Background Removal (optional backend):** Python Flask server with Hugging Face `transformers` pipeline on GPU
- **Image Processing:** Canvas API (browser), Pillow (backend)
- **Fonts:** Google Fonts (Poppins, weights 300/500)

## Repository Structure

```
├── index.html              # Single-page static HTML (entry point)
├── static/
│   ├── app.js              # Frontend logic: ES module with cropper, inference, export
│   ├── worker.js           # Web Worker for background removal inference
│   └── style.css           # Styling (plain CSS, Poppins font, blue theme)
├── app.py                  # Optional Flask backend for GPU-accelerated inference
├── requirements.txt        # Python dependencies (for optional backend only)
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

Background removal runs in-browser via Transformers.js/ONNX (~45MB model downloaded on first use).

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

ES module importing from `@huggingface/transformers` (CDN). Key features:

- **Dual inference modes** — browser (Transformers.js/ONNX) or backend (Flask API), selectable via radio buttons
- **Backend auto-detection** — probes `/remove_background` on load, shows availability status
- **Model loading with progress** — progress bar during ~45MB ONNX model download
- **Web Worker inference** — ML model runs in a separate thread to keep UI responsive
- **Image upload** via FileReader API
- **CropperJS integration** with configurable aspect ratio from width/height inputs
- **Adaptive zoom** via mouse wheel (scroll speed scales zoom factor, capped at 0.1)
- **Keyboard navigation** (arrow keys, 10px step) for crop box or image movement
- **DPI conversion** at 300 DPI: `inches * 300` or `cm * 300 / 2.54`
- **Crop & Save** exports cropped canvas as `photo_id.png`
- **4x6 Layout** tiles cropped photos onto a 1200x1800px (4x6 inch @ 300 DPI) canvas, downloads as `photo_id_4x6.png`
- **Error handling** on all async operations with user-visible status messages
- **Input validation** on width/height before cropper initialization
- **CONFIG object** centralizes all constants (DPI, canvas size, model ID, zoom factors)

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

Plain CSS, no preprocessor. Color scheme: `#4a90e2` (primary blue), `#f4f4f9` (background), `#333` (text). Includes status bar, progress bar, and mode selector styles. Responsive breakpoint at 680px.

## Development Conventions

### JavaScript
- ES module with `import` from CDN — no bundler, no npm
- DOM element references cached at file top
- Event listeners attached directly to elements
- CropperJS loaded via CDN `<script>` tag (non-module)
- Transformers.js loaded via CDN ES module import

### CSS
- Element-level selectors with section comments
- Responsive media query at 680px breakpoint

### HTML
- Plain static HTML — no templating engine
- External resources (CropperJS, Google Fonts, Transformers.js) loaded from CDNs

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
| ML model | briaai/RMBG-1.4 | `static/app.js` CONFIG / `app.py` env var |
