# One-Click ID Photo Generator — Implementation Plan

## Concept

Upload photo → pick preset → click ONE button → get a finished ID photo with:
- Background removed (BiRefNet Lite, better quality + Apache 2.0 license)
- Face auto-detected and centered (MediaPipe, ~3MB)
- Compliance checks shown (head size, centering, tilt)
- Manual override available at every step if result is bad

## Architecture

```
User uploads photo + selects preset (e.g. "US Passport 2x2")
         │
         ▼
[1] Face Detection ──── MediaPipe Face Landmarker (main thread, ~50ms)
         │
         ▼
[2] Background Removal ── BiRefNet Lite via Web Worker (~5-15s)
         │
         ▼
[3] Auto-Crop ─────── Compute crop rect from face geometry + preset
         │
         ▼
[4] Compliance Check ── Validate face position against preset rules
         │
         ▼
[5] Show Result ────── Export-ready photo + compliance report
                       "Adjust Manually" button for overrides
```

The manual 5-step wizard stays fully intact. One-click is an orchestrator
that calls the same existing functions programmatically.

---

## Phase 1: Swap Background Removal Model (worker.js)

**What:** Replace RMBG-1.4 with BiRefNet Lite in the web worker.

**Why:** Better edge quality, Apache 2.0 license (no commercial restriction).

**Changes to `static/worker.js`:**
- Change `MODEL_ID` from `"briaai/RMBG-1.4"` to `"onnx-community/BiRefNet_lite"`
- Update `loadModel()`: remove manual processor config, add `dtype: "fp32"`
- Update `runInference()`:
  - Input: `{ input_image: pixel_values }` (was `{ input: pixel_values }`)
  - Output: `output_image` (was `output`)
  - Post-process: `.sigmoid().mul(255)` (was `.mul(255)`)
- Message protocol (load-model/inference/result) stays identical

**No changes needed in `app.js`** — it consumes `maskData/width/height` the same way.

**Risk:** BiRefNet Lite is ~115MB (fp16) vs 45MB. Mitigate by showing progress bar
(already exists) and leveraging browser cache. Consider keeping RMBG-1.4 as
fallback option in Settings.

---

## Phase 2: Add Face Detection (app.js)

**What:** Integrate MediaPipe Face Landmarker for face detection.

**Load via CDN (ES module, no build step needed):**
```js
import { FaceLandmarker, FilesetResolver } from
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs";
```

**Runs on main thread** (not worker) because:
- Model is tiny (~3MB), inference is ~50ms
- Needs Canvas API which isn't available in all workers

**New functions in `app.js`:**
- `initFaceLandmarker()` — lazy-load the model on first use
- `detectFace(imageElement)` — returns structured face geometry:
  - Face bounding box (top/bottom/left/right in pixels)
  - Eye center position
  - Face center position
  - Head roll angle (tilt in degrees)
  - 478 landmarks for advanced checks

---

## Phase 3: One-Click UI + Orchestrator (index.html + app.js + style.css)

### UI Changes

**Step 1 (Upload):** Add a "Quick Generate" panel below the upload preview:
```
┌──────────────────────────────────┐
│  Quick Generate                  │
│  Select preset: [US Passport ▼]  │
│  [ ✨ Generate ID Photo ]        │
│                                  │
│  or continue with manual steps → │
└──────────────────────────────────┘
```
Panel appears after photo is uploaded. Button enables after preset is selected.

**Step 5 (Export):** Add a compliance panel above the export buttons:
```
┌──────────────────────────────────┐
│  Compliance Check                │
│  ✓ Head height: 58% (50-69%)    │
│  ✓ Face centered: 1.2% off      │
│  ✓ Head tilt: 1.8° (< 5°)      │
│  ✗ Top margin: 6% (need 8-15%)  │
│                                  │
│  [ Adjust Manually ]             │
└──────────────────────────────────┘
```

**Step 4 (Crop):** Add small "Auto-center face" button in toolbar
(useful in manual mode too — detects face and repositions crop box).

### Orchestrator: `oneClickGenerate()`

Chains the pipeline:
1. Validate image + preset are selected
2. Call `detectFace()` → get face geometry
3. Call `removeBackgroundBrowser()` (or backend) → get processed image
4. Navigate to Step 4, init CropperJS
5. Call `applyCropFromFaceData()` → programmatically set crop box
6. Call `checkCompliance()` → validate against preset rules
7. Navigate to Step 5 with compliance results displayed

Progress shown via existing `showStatus()`/`showProgress()` throughout.

### Smart Crop: `applyCropFromFaceData()`

Computes crop rectangle so that:
- Face is horizontally centered
- Head occupies ~60% of frame height (per ID photo standards)
- ~12% margin above head (forehead clearance)
- Crop box clamped to image boundaries

---

## Phase 4: Compliance Checks (app.js)

### Extended PRESETS with compliance rules

Each preset gets a `compliance` object with country-specific rules:

```js
{ label: "US Passport", width: 2, height: 2, unit: "inches",
  compliance: {
    headHeightMin: 0.50, headHeightMax: 0.69,  // head as % of frame
    eyeHeightMin: 0.56, eyeHeightMax: 0.69,    // eyes from bottom
    maxTiltDegrees: 5,
  }
}
```

### Checks performed

| Check | What it validates | Source |
|-------|-------------------|--------|
| Head height ratio | Head is 50-69% of frame (US) or 70-80% (EU) | Face landmarks |
| Eye position | Eyes at correct height from bottom | Face landmarks |
| Horizontal centering | Face within 5% of center | Face landmarks |
| Head tilt | Roll angle < 5 degrees | Eye alignment |
| Face in frame | Entire face within crop boundaries | Bounding box |
| Top margin | 8-15% space above head | Face top vs crop top |

### Result structure
```js
{ allPassed: boolean, checks: [{ id, label, expected, passed }] }
```

---

## Phase 5: Polish

- **Fallback:** If BiRefNet fails to load, offer RMBG-1.4 in Settings
- **Edge cases:** No face detected → "Please use manual mode" message
- **Manual mode enhancement:** "Auto-center face" button in Step 4 toolbar
  (reuses `detectFace` + `applyCropFromFaceData`)
- **Reset:** Start-over handler clears `faceData`, `complianceResult`, `isOneClickMode`
- **Responsive:** New components work at 680px breakpoint

---

## File Change Summary

| File | Changes |
|------|---------|
| `static/worker.js` | Swap model ID, update input/output tensor names, add sigmoid |
| `static/app.js` | Add MediaPipe import, face detection, one-click orchestrator, compliance checks, new DOM refs, extended PRESETS |
| `index.html` | Add one-click panel (Step 1), compliance panel (Step 5), auto-center button (Step 4) |
| `static/style.css` | Styles for one-click panel, compliance indicators, new buttons |

No new files. No build step changes. No npm dependencies.
