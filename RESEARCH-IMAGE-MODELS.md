# Image Editing Models Research

Research into upgrading from RMBG-1.4 and adding new AI-powered features via
browser-compatible models.

---

## 1. RMBG-2.0 vs RMBG-1.4 — Is Upgrading Worth It?

### Quality Improvement

RMBG-2.0 is a major quality upgrade over 1.4:

| Metric | RMBG-1.4 | RMBG-2.0 |
|--------|----------|----------|
| Accuracy (Bria benchmark) | ~74% | ~90% |
| Architecture | IS-Net | BiRefNet (bilateral reference) |
| Training data | Proprietary | 15,000+ high-res manually labeled images |
| Edge quality | Good | Significantly better — fewer misclassifications, less indecisiveness |

RMBG-2.0 also outperforms open-source BiRefNet (90% vs 85%) and Adobe Photoshop
(90% vs 46%), and approaches commercial remove.bg (90% vs 97%).

### Model Size (ONNX)

This is the main tradeoff. RMBG-2.0 is **much** larger:

| Variant | RMBG-1.4 | RMBG-2.0 |
|---------|----------|----------|
| FP32 | 176 MB | 1.02 GB |
| FP16 | 88 MB | 514 MB |
| INT8/Quantized | 44 MB | 366 MB |
| Q4F16 | N/A | 234 MB |

Even the most aggressively quantized RMBG-2.0 (234 MB) is larger than RMBG-1.4's
full FP32 model (176 MB). Current users download ~45 MB for RMBG-1.4 — switching
to RMBG-2.0 would mean a **5-8x larger download**.

### Browser Compatibility — CRITICAL BLOCKER

**RMBG-2.0 cannot currently run in the browser via Transformers.js.**

The underlying issue was `onnxruntime-web` bug
[#21968](https://github.com/microsoft/onnxruntime/issues/21968) — BiRefNet
models didn't work on WebGPU. That issue is now **closed**, suggesting the core
bug is fixed. However:

- Xenova (Transformers.js maintainer) noted the model is very memory-intensive
  and causes out-of-memory errors with WASM
- WebGPU support is needed but still not universally available (Chrome/Edge only;
  Firefox/Safari experimental)
- No confirmed working Transformers.js example exists for RMBG-2.0 in-browser
  as of early 2026

### Licensing

Both models require a commercial license from BRIA for commercial use:
- RMBG-1.4: Custom "bria-rmbg-1.4" license (non-commercial free)
- RMBG-2.0: CC BY-NC 4.0 (non-commercial free)
- Commercial license pricing: not publicly disclosed (contact BRIA)
- Third-party API (fal.ai): $0.018/image for RMBG-2.0

### Recommendation

**Don't upgrade to RMBG-2.0 yet for in-browser use.** The browser runtime
support is not ready, model size is prohibitive for client-side download, and
the licensing terms are equivalent. Monitor these:
- `onnxruntime-web` WebGPU maturity for BiRefNet architectures
- Transformers.js v4 model compatibility updates

**For the backend server (`app.py`):** upgrading to RMBG-2.0 is straightforward
and worthwhile if quality matters. Just change the model ID — the `transformers`
pipeline API is the same.

---

## 2. Alternative Background Removal Models

### BiRefNet Lite (Recommended as next upgrade)

- **Repo:** [onnx-community/BiRefNet_lite-ONNX](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX)
- **Architecture:** Same BiRefNet as RMBG-2.0, but with `swin_v1_tiny` backbone
- **Size:** ~4-5x smaller than full BiRefNet (~200 MB FP32 estimated, ~100 MB FP16)
- **Speed:** ~4x faster than full BiRefNet
- **Quality:** Better than RMBG-1.4, slightly below RMBG-2.0
- **Browser:** Works with Transformers.js via `AutoModel.from_pretrained`
- **License:** Apache 2.0 — **free for commercial use**

This is likely the best near-term upgrade path for in-browser background removal.

### MODNet

- **Repo:** [Xenova/modnet](https://huggingface.co/Xenova/modnet)
- **Size:** ~110 MB total (lighter than RMBG-1.4)
- **Specialty:** Portrait-specific matting (people only, not general objects)
- **Browser:** Works with Transformers.js pipeline API (`'background-removal'`)
- **License:** Apache 2.0
- **Tradeoff:** Only handles portraits/people, not arbitrary objects

Good as a **secondary model** for portrait-specific background removal (which
is the primary use case for ID photos anyway).

### Depth Anything V2 (for depth-based removal)

- **Repo:** [onnx-community/depth-anything-v2-small](https://huggingface.co/onnx-community/depth-anything-v2-small)
- **Approach:** Depth estimation instead of segmentation — remove background by
  depth threshold
- **Size:** Small variant is 24.8M parameters (~50-100 MB ONNX)
- **Browser:** Fully works with Transformers.js, WebGPU supported
- **License:** Apache 2.0 (Small variant) — **free for commercial use**
- **Bonus:** Can also enable portrait bokeh/background blur effects

---

## 3. New Feature Opportunities — Models Worth Adding

### A. Auto Face Detection & Centering

For an ID photo editor, auto-detecting the face and centering the crop is a
high-value feature. Options:

**MediaPipe Face Landmarker (Recommended)**
- **Size:** ~3 MB (very lightweight)
- **What it does:** Detects 478 face landmarks in real-time
- **Browser:** Runs via `@mediapipe/tasks-vision` JS package, uses WebGL/WASM
- **License:** Apache 2.0
- **Use case:** Auto-position crop box centered on face, validate face size
  meets ID photo requirements, check head tilt/rotation

**onnx-facial-lmk-detector**
- End-to-end face detection + 106 landmarks in a single ONNX model
- Can run with onnxruntime-web directly

**Implementation idea:** After upload, detect face -> auto-set crop box centered
on face with correct proportions -> user can fine-tune. Could also validate:
- Face is centered within acceptable tolerance
- Head is not tilted beyond threshold
- Eyes are open
- Face occupies correct percentage of frame (per passport photo specs)

### B. Portrait Bokeh / Background Blur

Using **Depth Anything V2** to create a depth map, then apply graduated blur:

- Foreground (face) stays sharp
- Background gets progressively blurred
- User controls blur intensity with a slider
- Could offer "studio backdrop" effect

**Implementation:**
```
depth map → per-pixel blur radius → canvas StackBlur or CSS filter
```

Small model (~50 MB), fast inference, Apache 2.0 license.

### C. Image Super-Resolution / Upscaling

For when users upload low-resolution photos:

**SwinIR (via super-resolution-js)**
- **Demo:** [josephrocca.github.io/super-resolution-js](https://josephrocca.github.io/super-resolution-js/)
- ONNX-ported SwinIR model, runs in browser
- 2x or 4x upscaling

**WebSR / RealESRGAN (WebGPU)**
- **Repo:** [github.com/sb2702/websr](https://github.com/sb2702/websr)
- Real-time upscaling via WebGPU compute shaders
- Multiple pre-trained weights for photo content
- Powers [free.upscaler.video](https://free.upscaler.video/)

**Tradeoff:** Upscaling is computationally expensive. Best offered as an
optional "enhance" step with WebGPU requirement.

### D. Smart Cropping

**smartcrop.js**
- **Repo:** [github.com/jwagner/smartcrop.js](https://github.com/jwagner/smartcrop.js)
- Content-aware cropping — finds the most important region
- Lightweight, no ML model needed (uses simple saliency heuristics)
- Can be combined with face detection for better results
- MIT license

---

## 4. Priority Ranking for Implementation

Ranked by value-to-effort ratio for an ID photo editor:

| Priority | Feature | Model/Library | Size | License | Effort |
|----------|---------|--------------|------|---------|--------|
| 1 | Auto face centering | MediaPipe Face Landmarker | ~3 MB | Apache 2.0 | Medium |
| 2 | Better bg removal (browser) | BiRefNet Lite ONNX | ~100-200 MB | Apache 2.0 | Low |
| 3 | Portrait bokeh/blur | Depth Anything V2 Small | ~50-100 MB | Apache 2.0 | Medium |
| 4 | ID photo compliance check | MediaPipe (reuse from #1) | 0 (reuse) | Apache 2.0 | Medium |
| 5 | Image upscaling | SwinIR / WebSR | varies | varies | High |
| 6 | Better bg removal (server) | RMBG-2.0 | N/A (server) | CC BY-NC 4.0 | Low |

### Why this order:

1. **Auto face centering** is the highest-value feature for an ID photo tool.
   Users struggle most with positioning. MediaPipe is tiny (3 MB) and proven.

2. **BiRefNet Lite** is a near drop-in replacement for RMBG-1.4 in the worker,
   with better quality and a permissive Apache 2.0 license (vs BRIA's
   non-commercial restriction). Low effort since the architecture
   (AutoModel + AutoProcessor) is the same.

3. **Depth-based portrait bokeh** adds a unique, visible feature. Works well
   with the existing pipeline (apply after background removal as an
   alternative to full removal).

4. **Compliance checking** reuses the face landmarks from #1 to verify head
   position, face size ratio, eye visibility — extremely useful for passport
   photos and essentially free once face detection is in place.

5. **Upscaling** is nice-to-have but computationally heavy and requires WebGPU.
   Lower priority since most phone cameras produce high-enough resolution.

6. **RMBG-2.0 server-side** is trivial to add (one line change in `app.py`) but
   only benefits users running the optional backend.

---

## 5. Technical Considerations

### Transformers.js Version

The codebase currently uses `@huggingface/transformers@3.1.2`. Transformers.js
v4 is now in preview with a rewritten WebGPU runtime and ~200 supported
architectures. Upgrading to v4 would unlock more models and better performance,
but it's still in preview.

**Recommendation:** Stay on v3 for now, plan v4 migration when it stabilizes.

### WebGPU vs WASM

- WASM: Works everywhere, slower (CPU-bound)
- WebGPU: Up to 100x faster, Chrome/Edge only (Firefox/Safari experimental)
- Current setup uses WASM — adding WebGPU as an option would benefit users
  with Chrome/Edge

### Multi-Model Loading

Loading multiple models simultaneously would increase memory pressure. Consider:
- Lazy loading: only load a model when the user enters that step
- Model unloading: release models after use via `model.dispose()`
- Sequential loading: don't load depth model if user skips bokeh step

### CDN vs NPM

The project loads Transformers.js from CDN (jsdelivr). This works well for the
no-build-step architecture. New models can also be loaded from HuggingFace Hub
CDN directly — no npm needed.
