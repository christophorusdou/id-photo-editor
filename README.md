# Photo ID Generator

A free, private web app for generating passport and ID photos. One-click pipeline with face detection, AI background removal, smart cropping, and compliance checking — runs entirely in your browser with no server required.

## Features

- **One-click ID photo generation** — upload a photo, select a preset, get a compliant ID photo instantly
- **9 country/region presets** — US Passport, US Visa, Canada, EU/Schengen, UK, China, India, Japan, Australia — each with compliance validation
- **AI background removal** powered by [briaai/RMBG-1.4](https://huggingface.co/briaai/RMBG-1.4) via Transformers.js, running directly in your browser
- **Face detection & smart cropping** — MediaPipe face landmarks auto-center your face with correct head size and margins
- **Compliance checking** — validates head height, eye position, centering, tilt, and margins against official requirements
- **Print-ready exports** — download a single cropped photo or a 4x6 sheet with multiple tiled copies at 300 DPI
- **100% client-side** — no server required, your photos never leave your device
- **Manual mode** — full step-by-step wizard (Upload → Background → Adjust → Crop → Export) for fine-grained control
- Optional GPU-accelerated backend for faster inference

## Quick Start

No installation needed. Open `index.html` in a modern browser, or serve the files:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

The ~45MB background removal model downloads automatically on first use and is cached by the browser.

## Deployment

Production is hosted on **Cloudflare Pages** at [id-photo-editor.cdrift.com](https://id-photo-editor.cdrift.com).

This is a static site with no build step. Deploy via the Wrangler CLI:

```bash
npx wrangler pages deploy . --project-name id-photo-editor --branch main --commit-dirty=true
```

The Cloudflare Pages project name is `id-photo-editor`, with custom domain `id-photo-editor.cdrift.com` configured via the Cloudflare dashboard.

## Optional: GPU Backend

For faster background removal on a machine with a GPU:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

Then select **Backend Server** in the mode selector on the page. The server runs on `http://localhost:5000` by default.

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `RMBG_MODEL` | `briaai/RMBG-1.4` | Hugging Face model ID |
| `RMBG_DEVICE` | `0` | GPU device index |
| `FLASK_DEBUG` | `0` | Set to `1` for debug mode |
| `PORT` | `5000` | Server port |

## License

GPLv3 — see [LICENSE](LICENSE).
