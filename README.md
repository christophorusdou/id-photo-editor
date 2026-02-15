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
- **iPhone optimized** — quantized int8 model (~44MB vs 176MB) with automatic server-side fallback on Cloudflare Pages
- **Manual mode** — full step-by-step wizard (Upload → Background → Adjust → Crop → Export) for fine-grained control
- Optional GPU-accelerated backend for faster inference

## Quick Start

No installation needed. Open `index.html` in a modern browser, or serve the files:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

The background removal model downloads automatically on first use and is cached by the browser (~44MB quantized on iPhone, ~176MB full precision on desktop).

## Deployment

Production is hosted on **Cloudflare Pages** at [id-photo-editor.cdrift.com](https://id-photo-editor.cdrift.com).

This is a static site with no build step. Deploy via the Wrangler CLI:

```bash
npx wrangler pages deploy . --project-name id-photo-editor --branch main --commit-dirty=true
```

The Cloudflare Pages project name is `id-photo-editor`, with custom domain `id-photo-editor.cdrift.com` configured via the Cloudflare dashboard.

## Mobile / iPhone Compatibility

The app runs on iPhones but Safari has strict per-tab memory limits (~300–500MB on 4GB devices like iPhone 12/13). Several optimizations keep inference within budget:

- **Quantized model (int8):** ~44MB instead of 176MB fp32 — 75% smaller weights, 40% lower peak memory
- **Reduced image dimensions:** 800px max on iPhone (vs 1200px on desktop)
- **Main-thread inference:** bypasses Web Worker's lower memory ceiling on iOS
- **Aggressive cleanup:** model unloaded after inference, canvases zeroed, GC yields

If deployed on Cloudflare Pages, the app auto-detects a server-side fallback at `/api/remove-background` — sending the image to the server for processing with zero local ML memory.

See [`IPHONE-MEMORY-FIX.md`](IPHONE-MEMORY-FIX.md) for the full root cause analysis and memory budget breakdown.

## Server-Side Fallback (Cloudflare Pages)

When deployed on Cloudflare Pages, an optional Pages Function at `functions/api/remove-background.js` provides server-side background removal. The frontend auto-detects it on iOS and uses it transparently.

Configure one of these backends via Cloudflare Pages environment variables / bindings:

| Backend | Config | Free Tier |
|---|---|---|
| Cloudflare Images | `IMAGES_BUCKET` R2 binding | 5,000/month |
| Workers AI | `AI` binding | 10,000 neurons/day |
| remove.bg | `REMOVE_BG_API_KEY` env var | 50 previews/month |

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
