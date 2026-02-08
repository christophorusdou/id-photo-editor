# CLAUDE.md

## Project Overview

Photo ID Generator — a Flask web application for uploading photos, cropping them to ID/passport dimensions, removing backgrounds using AI (briaai/RMBG-1.4), and exporting print-ready layouts. Licensed under GPLv3.

## Tech Stack

- **Backend:** Python 3.x (< 3.13) with Flask
- **Frontend:** Vanilla JavaScript, HTML, CSS (no framework, no build step)
- **Image Cropping:** CropperJS v1.5.12 (loaded from CDN)
- **Background Removal:** Hugging Face `transformers` pipeline with `briaai/RMBG-1.4` model (GPU, device 0)
- **Image Processing:** Pillow (PIL)
- **Fonts:** Google Fonts (Poppins, weights 300/500)

## Repository Structure

```
├── app.py                  # Flask server: routes and ML model pipeline
├── templates/
│   └── index.html          # Single-page HTML template (Jinja2)
├── static/
│   ├── app.js              # Frontend logic: cropper, zoom, export, API calls
│   └── style.css           # Styling (plain CSS, Poppins font, blue theme)
├── README.md               # Setup and installation guide
├── LICENSE                 # GPLv3
└── .gitignore              # Standard Python gitignore
```

## Running the Application

```bash
python3 -m venv venv
source venv/bin/activate
pip install Flask Pillow torchvision scikit-image transformers
python app.py
```

Flask runs on `http://localhost:5000` with `debug=True`.

**Requires:** A GPU (the model loads on `device=0`).

## Architecture

### Backend (`app.py`)

Two routes:
- `GET /` — renders `templates/index.html`
- `POST /remove_background` — accepts multipart form image, runs RMBG-1.4 segmentation, composites subject onto white background, returns PNG

The ML model is loaded once at module level as a global `pipe` variable.

### Frontend (`static/app.js`)

Single-file vanilla JS with global state variables (`cropper`, `isMovingCropWindow`, `isCropBoxMode`). DOM elements are cached at the top of the file. Key features:

- **Image upload** via FileReader API
- **CropperJS integration** with configurable aspect ratio from width/height inputs
- **Adaptive zoom** via mouse wheel (scroll speed scales zoom factor, capped at 0.1)
- **Keyboard navigation** (arrow keys, 10px step) for crop box or image movement
- **DPI conversion** at 300 DPI: `inches * 300` or `cm * 300 / 2.54`
- **Crop & Save** exports cropped canvas as `photo_id.png`
- **4x6 Layout** tiles cropped photos onto a 1200x1800px (4x6 inch @ 300 DPI) canvas, downloads as `photo_id_4x6.png`
- **Background removal** calls `POST /remove_background` and replaces image src

### Styling (`static/style.css`)

Plain CSS, no preprocessor. Color scheme: `#4a90e2` (primary blue), `#f4f4f9` (background), `#333` (text). Image container is fixed at 600x400px with rounded corners and shadow.

## Development Conventions

### Python
- No requirements.txt or pyproject.toml — dependencies are installed manually via pip (see README)
- No linter, formatter, or type checker configured
- No test suite
- Flask debug mode is on by default

### JavaScript
- Vanilla JS with direct DOM manipulation — no modules, no bundler, no transpilation
- Global variables for state; DOM element references cached at file top
- Event listeners attached directly to elements
- CropperJS is the only JS library (loaded via CDN, not npm)

### CSS
- Element-level selectors (e.g., `button`, `img`, `body`) rather than BEM or utility classes
- Commented-out old styles are kept in the file
- No responsive/media queries

### HTML
- Single Jinja2 template; static assets referenced via `url_for('static', ...)`
- External resources (CropperJS, Google Fonts) loaded from CDNs

### General Patterns
- Commented-out code blocks are left in place (both in `app.py` and `app.js`)
- No environment variable usage — config is hardcoded (model name, device, DPI, dimensions)
- No error handling on frontend fetch calls
- No CI/CD, Docker, or deployment configuration

## Key Constants

| Constant | Value | Location |
|----------|-------|----------|
| DPI | 300 | `static/app.js:16` |
| 4x6 canvas | 1200x1800px | `static/app.js:222-223` |
| Arrow key step | 10px | `static/app.js:150` |
| Base zoom factor | 0.02 | `static/app.js:81` |
| Max zoom factor | 0.1 | `static/app.js:83` |
| ML model | briaai/RMBG-1.4 | `app.py:10` |
| GPU device | 0 | `app.py:10` |

## Known Issues / Quirks

- `templates/index.html` has a stray `<!DOCTYPE html>` tag at line 60 inside the `<body>`, and `</html>` before `</body>` (malformed closing structure)
- No `requirements.txt` — dependencies must be installed from README instructions
- No input validation on the frontend for width/height fields before cropper initialization
- The `requests` module is imported in `app.py` but never used
- Flask runs in debug mode with no production WSGI server configuration
