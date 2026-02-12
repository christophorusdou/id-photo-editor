# Photo ID Generator

A web application for uploading photos, cropping them to ID/passport dimensions, removing backgrounds with AI, and exporting print-ready layouts. Runs entirely in the browser — no server required.

## Features

- Upload and crop photos to any ID/passport dimension (inches or cm)
- AI background removal powered by [briaai/RMBG-1.4](https://huggingface.co/briaai/RMBG-1.4), running directly in your browser
- Generate print-ready 4x6 inch layouts tiled with cropped photos
- Adaptive zoom, keyboard navigation, and drag controls
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
