// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const CONFIG = {
    DPI: 300,
    CANVAS_4X6_WIDTH: 1200,  // 4 inches * 300 DPI
    CANVAS_4X6_HEIGHT: 1800, // 6 inches * 300 DPI
    ARROW_STEP: 10,
    BASE_ZOOM: 0.02,
    MAX_ZOOM: 0.1,
    BACKEND_URL: "/remove_background",
};

const PRESETS = [
    { label: "US Passport", width: 2, height: 2, unit: "inches", region: "North America" },
    { label: "US Visa", width: 2, height: 2, unit: "inches", region: "North America" },
    { label: "Canada Passport", width: 5, height: 7, unit: "cm", region: "North America" },
    { label: "EU/Schengen ID", width: 3.5, height: 4.5, unit: "cm", region: "Europe" },
    { label: "UK Passport", width: 3.5, height: 4.5, unit: "cm", region: "Europe" },
    { label: "China Passport", width: 3.3, height: 4.8, unit: "cm", region: "Asia-Pacific" },
    { label: "India Passport", width: 3.5, height: 3.5, unit: "cm", region: "Asia-Pacific" },
    { label: "Japan Passport", width: 3.5, height: 4.5, unit: "cm", region: "Asia-Pacific" },
    { label: "Australia Passport", width: 3.5, height: 4.5, unit: "cm", region: "Asia-Pacific" },
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
    currentStep: 1,
    imageFile: null,
    imageDataUrl: null,
    processedDataUrl: null,
    adjustedDataUrl: null,
    adjustments: { brightness: 100, contrast: 100, saturation: 100 },
};

let cropper = null;
let isMovingCropWindow = false;
let worker = null;
let modelReady = false;
let wheelHandler = null;
let lastBlobUrl = null;

// ---------------------------------------------------------------------------
// DOM Elements
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

const dom = {
    landing: $("landing"),
    appShell: $("app-shell"),
    getStarted: $("get-started"),
    stepProgress: $("step-progress"),

    statusToast: $("status-toast"),
    statusText: $("status-text"),
    progressContainer: $("progress-container"),
    progressBar: $("progress-bar"),

    // Step 1
    dropZone: $("drop-zone"),
    dropZonePrompt: $("drop-zone-prompt"),
    uploadPreview: $("upload-preview"),
    previewImage: $("preview-image"),
    imageInput: $("imageInput"),
    browseButton: $("browse-button"),
    changePhoto: $("change-photo"),
    step1Next: $("step1-next"),

    // Step 2
    baBefore: $("ba-before"),
    baAfter: $("ba-after"),
    baPlaceholder: $("ba-placeholder"),
    removeBgButton: $("remove-bg-button"),
    step2Back: $("step2-back"),
    step2Skip: $("step2-skip"),
    step2Next: $("step2-next"),

    // Step 3
    adjustCanvas: $("adjust-canvas"),
    brightnessSlider: $("brightness-slider"),
    contrastSlider: $("contrast-slider"),
    saturationSlider: $("saturation-slider"),
    brightnessValue: $("brightness-value"),
    contrastValue: $("contrast-value"),
    saturationValue: $("saturation-value"),
    resetAdjustments: $("reset-adjustments"),
    step3Back: $("step3-back"),
    step3Next: $("step3-next"),

    // Step 4
    presetSelect: $("preset-select"),
    widthInput: $("width"),
    heightInput: $("height"),
    unitSelect: $("unit"),
    image: $("image"),
    cropContainer: $("crop-container"),
    zoomIn: $("zoom-in"),
    zoomOut: $("zoom-out"),
    toggleMode: $("toggle-mode"),
    step4Back: $("step4-back"),
    step4Next: $("step4-next"),

    // Step 5
    exportCanvas: $("export-canvas"),
    cropButton: $("crop-button"),
    generate4x6Button: $("generate-4x6-button"),
    step5Back: $("step5-back"),
    step5StartOver: $("step5-start-over"),

    // Settings
    settingsToggle: $("settings-toggle"),
    settingsDrawer: $("settings-drawer"),
    settingsOverlay: $("settings-overlay"),
    settingsClose: $("settings-close"),
    backendStatus: $("backend-status"),
    preloadButton: $("preload-model-button"),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function convertToPixels(value, unit) {
    return unit === "inches" ? value * CONFIG.DPI : (value * CONFIG.DPI) / 2.54;
}

function getInferenceMode() {
    return document.querySelector('input[name="inference-mode"]:checked').value;
}

function showStatus(message, type = "info") {
    dom.statusToast.className = "status-toast " + type;
    dom.statusText.textContent = message;
    dom.statusToast.classList.remove("hidden");
}

function hideStatus() {
    dom.statusToast.classList.add("hidden");
    dom.progressContainer.classList.add("hidden");
}

function showProgress(percent) {
    dom.progressContainer.classList.remove("hidden");
    dom.progressBar.style.width = percent + "%";
}

// ---------------------------------------------------------------------------
// Wizard Navigation
// ---------------------------------------------------------------------------
function goToStep(n) {
    if (n < 1 || n > 5) return;

    state.currentStep = n;

    document.querySelectorAll(".wizard-step").forEach((el) => {
        el.classList.remove("active");
    });
    const target = document.querySelector(`.wizard-step[data-step="${n}"]`);
    if (target) target.classList.add("active");

    updateProgressIndicator();
    setupStep(n);
}

function updateProgressIndicator() {
    const items = dom.stepProgress.querySelectorAll(".step-item");
    const lines = dom.stepProgress.querySelectorAll(".step-line");

    items.forEach((item) => {
        const step = parseInt(item.dataset.step);
        item.classList.remove("active", "completed");
        if (step === state.currentStep) {
            item.classList.add("active");
        } else if (step < state.currentStep) {
            item.classList.add("completed");
        }
    });

    lines.forEach((line, i) => {
        line.classList.toggle("completed", i + 1 < state.currentStep);
    });
}

function setupStep(n) {
    switch (n) {
        case 1: setupStep1(); break;
        case 2: setupStep2(); break;
        case 3: setupStep3(); break;
        case 4: setupStep4(); break;
        case 5: setupStep5(); break;
    }
}

// ---------------------------------------------------------------------------
// Step 1: Upload
// ---------------------------------------------------------------------------
function setupStep1() {
    if (state.imageDataUrl) {
        dom.previewImage.src = state.imageDataUrl;
        dom.dropZonePrompt.classList.add("hidden");
        dom.uploadPreview.classList.remove("hidden");
        dom.step1Next.disabled = false;
    }
}

function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) return;

    state.imageFile = file;
    const reader = new FileReader();
    reader.onload = () => {
        state.imageDataUrl = reader.result;
        // Reset downstream state
        state.processedDataUrl = null;
        state.adjustedDataUrl = null;
        state.adjustments = { brightness: 100, contrast: 100, saturation: 100 };

        dom.previewImage.src = state.imageDataUrl;
        dom.dropZonePrompt.classList.add("hidden");
        dom.uploadPreview.classList.remove("hidden");
        dom.step1Next.disabled = false;
    };
    reader.readAsDataURL(file);
}

function openFilePicker() {
    dom.imageInput.value = "";
    dom.imageInput.click();
}

function setupDropZone() {
    const zone = dom.dropZone;

    zone.addEventListener("click", (e) => {
        if (e.target === dom.imageInput) return;
        if (e.target.closest("#change-photo") || e.target.closest("#browse-button")) return;
        openFilePicker();
    });

    dom.browseButton.addEventListener("click", (e) => {
        e.stopPropagation();
        openFilePicker();
    });

    dom.changePhoto.addEventListener("click", (e) => {
        e.stopPropagation();
        openFilePicker();
    });

    dom.imageInput.addEventListener("change", () => {
        const file = dom.imageInput.files[0];
        if (file) handleFile(file);
    });

    zone.addEventListener("dragenter", (e) => {
        e.preventDefault();
        zone.classList.add("dragover");
    });

    zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        zone.classList.add("dragover");
    });

    zone.addEventListener("dragleave", (e) => {
        e.preventDefault();
        if (!zone.contains(e.relatedTarget)) {
            zone.classList.remove("dragover");
        }
    });

    zone.addEventListener("drop", (e) => {
        e.preventDefault();
        zone.classList.remove("dragover");
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    });
}

// ---------------------------------------------------------------------------
// Step 2: Remove Background
// ---------------------------------------------------------------------------
function setupStep2() {
    dom.baBefore.src = state.imageDataUrl;

    if (state.processedDataUrl) {
        dom.baAfter.src = state.processedDataUrl;
        dom.baAfter.classList.remove("hidden");
        dom.baPlaceholder.classList.add("hidden");
        dom.step2Next.disabled = false;
    } else {
        dom.baAfter.classList.add("hidden");
        dom.baPlaceholder.classList.remove("hidden");
        dom.step2Next.disabled = true;
    }
}

// ---------------------------------------------------------------------------
// Step 3: Adjust
// ---------------------------------------------------------------------------
function setupStep3() {
    dom.brightnessSlider.value = state.adjustments.brightness;
    dom.contrastSlider.value = state.adjustments.contrast;
    dom.saturationSlider.value = state.adjustments.saturation;
    updateSliderValues();
    renderAdjustmentPreview();
}

function getFilterString() {
    const { brightness, contrast, saturation } = state.adjustments;
    return `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
}

// Detect ctx.filter support (Safari doesn't support it)
const _ctxFilterSupported = (() => {
    const c = document.createElement("canvas").getContext("2d");
    c.filter = "brightness(100%)";
    return c.filter === "brightness(100%)";
})();

function renderAdjustmentPreview() {
    const src = state.processedDataUrl || state.imageDataUrl;
    if (!src) return;

    const img = new Image();
    img.onload = () => {
        const canvas = dom.adjustCanvas;
        const maxW = 500;
        const maxH = 350;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        // Use CSS filter on the canvas element (works in all browsers)
        canvas.style.filter = getFilterString();
    };
    img.src = src;
}

// Pixel-level adjustment fallback for browsers without ctx.filter (Safari)
function applyAdjustmentsPixel(ctx, w, h) {
    const { brightness, contrast, saturation } = state.adjustments;
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    const bf = brightness / 100;
    const cf = contrast / 100;
    const sf = saturation / 100;

    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;

        // Brightness
        let r = d[i] * bf;
        let g = d[i + 1] * bf;
        let b = d[i + 2] * bf;

        // Contrast (around 128 midpoint)
        r = (r - 128) * cf + 128;
        g = (g - 128) * cf + 128;
        b = (b - 128) * cf + 128;

        // Saturation (luminance-preserving)
        const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = gray + sf * (r - gray);
        g = gray + sf * (g - gray);
        b = gray + sf * (b - gray);

        d[i]     = Math.max(0, Math.min(255, Math.round(r)));
        d[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
        d[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }
    ctx.putImageData(imageData, 0, 0);
}

function bakeAdjustments() {
    const src = state.processedDataUrl || state.imageDataUrl;
    if (!src) return Promise.resolve();

    const { brightness, contrast, saturation } = state.adjustments;
    if (brightness === 100 && contrast === 100 && saturation === 100) {
        state.adjustedDataUrl = src;
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d");

            if (_ctxFilterSupported) {
                ctx.filter = getFilterString();
                ctx.drawImage(img, 0, 0);
            } else {
                ctx.drawImage(img, 0, 0);
                applyAdjustmentsPixel(ctx, canvas.width, canvas.height);
            }

            state.adjustedDataUrl = canvas.toDataURL("image/png");
            resolve();
        };
        img.onerror = resolve;
        img.src = src;
    });
}

function updateSliderValues() {
    dom.brightnessValue.textContent = state.adjustments.brightness + "%";
    dom.contrastValue.textContent = state.adjustments.contrast + "%";
    dom.saturationValue.textContent = state.adjustments.saturation + "%";
}

// ---------------------------------------------------------------------------
// Step 4: Crop
// ---------------------------------------------------------------------------
function setupStep4() {
    populatePresets();

    const src = state.adjustedDataUrl || state.processedDataUrl || state.imageDataUrl;
    dom.image.src = src;
    dom.image.style.display = "block";

    // Destroy existing cropper
    if (cropper) {
        cropper.destroy();
        cropper = null;
    }
    if (wheelHandler) {
        dom.image.removeEventListener("wheel", wheelHandler);
        wheelHandler = null;
    }

    // If dimensions are already set, init cropper once image loads
    const w = parseFloat(dom.widthInput.value);
    const h = parseFloat(dom.heightInput.value);
    if (w > 0 && h > 0) {
        if (dom.image.complete && dom.image.naturalWidth) {
            initializeCropper();
        } else {
            dom.image.onload = () => initializeCropper();
        }
    }
}

function populatePresets() {
    const select = dom.presetSelect;
    // Keep only the first "Custom" option
    while (select.children.length > 1) {
        select.removeChild(select.lastChild);
    }

    const regions = {};
    PRESETS.forEach((p, i) => {
        if (!regions[p.region]) regions[p.region] = [];
        regions[p.region].push({ ...p, index: i });
    });

    Object.entries(regions).forEach(([region, presets]) => {
        const group = document.createElement("optgroup");
        group.label = region;
        presets.forEach((p) => {
            const opt = document.createElement("option");
            const sizeStr = p.unit === "inches"
                ? `${p.width}\u00d7${p.height}\u2033`
                : `${Math.round(p.width * 10)}\u00d7${Math.round(p.height * 10)}mm`;
            opt.value = p.index;
            opt.textContent = `${p.label} (${sizeStr})`;
            group.appendChild(opt);
        });
        select.appendChild(group);
    });
}

function applyPreset(index) {
    if (index === "") {
        dom.widthInput.value = "";
        dom.heightInput.value = "";
        return;
    }

    const preset = PRESETS[parseInt(index)];
    dom.widthInput.value = preset.width;
    dom.heightInput.value = preset.height;
    dom.unitSelect.value = preset.unit === "inches" ? "inches" : "cm";

    initializeCropper();
}

function initializeCropper() {
    if (cropper) cropper.destroy();
    if (wheelHandler) {
        dom.image.removeEventListener("wheel", wheelHandler);
        wheelHandler = null;
    }

    const widthValue = parseFloat(dom.widthInput.value);
    const heightValue = parseFloat(dom.heightInput.value);

    if (!widthValue || !heightValue || widthValue <= 0 || heightValue <= 0) {
        dom.step4Next.disabled = true;
        dom.zoomIn.disabled = true;
        dom.zoomOut.disabled = true;
        dom.toggleMode.disabled = true;
        return;
    }

    cropper = new Cropper(dom.image, {
        aspectRatio: widthValue / heightValue,
        dragMode: "crop",
    });

    dom.step4Next.disabled = false;
    dom.zoomIn.disabled = false;
    dom.zoomOut.disabled = false;
    dom.toggleMode.disabled = false;

    // Adaptive zoom
    wheelHandler = (event) => {
        event.preventDefault();
        const speedFactor = Math.abs(event.deltaY) / 100;
        const zoomFactor = Math.min(CONFIG.BASE_ZOOM * speedFactor, CONFIG.MAX_ZOOM);
        const delta = event.deltaY > 0 ? -zoomFactor : zoomFactor;
        cropper.zoom(delta);
    };
    dom.image.addEventListener("wheel", wheelHandler);
}

// ---------------------------------------------------------------------------
// Step 5: Export
// ---------------------------------------------------------------------------
function setupStep5() {
    if (!cropper) return;

    const width = convertToPixels(parseFloat(dom.widthInput.value), dom.unitSelect.value);
    const height = convertToPixels(parseFloat(dom.heightInput.value), dom.unitSelect.value);

    const croppedCanvas = cropper.getCroppedCanvas({ width, height });
    const previewCanvas = dom.exportCanvas;
    const maxW = 200;
    const maxH = 250;
    const scale = Math.min(maxW / width, maxH / height, 1);
    previewCanvas.width = width * scale;
    previewCanvas.height = height * scale;
    const ctx = previewCanvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    ctx.drawImage(croppedCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
}

// ---------------------------------------------------------------------------
// Backend availability check
// ---------------------------------------------------------------------------
async function checkBackend() {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(CONFIG.BACKEND_URL, {
            method: "POST",
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (response.status === 400 || response.ok) {
            dom.backendStatus.textContent = "available";
            dom.backendStatus.className = "badge available";
            return true;
        }
        throw new Error("unexpected status");
    } catch {
        dom.backendStatus.textContent = "unavailable";
        dom.backendStatus.className = "badge unavailable";
        return false;
    }
}

// ---------------------------------------------------------------------------
// Web Worker for in-browser inference
// ---------------------------------------------------------------------------
function getWorker() {
    if (!worker) {
        worker = new Worker("static/worker.js", { type: "module" });
    }
    return worker;
}

function sendWorkerMessage(msg) {
    return new Promise((resolve, reject) => {
        const w = getWorker();

        function onMessage(e) {
            const { type } = e.data;
            if (type === "progress") {
                showProgress(e.data.percent);
                return;
            }
            w.removeEventListener("message", onMessage);
            w.removeEventListener("error", onError);
            if (type === "error") {
                reject(new Error(e.data.message));
            } else {
                resolve(e.data);
            }
        }

        function onError(e) {
            w.removeEventListener("message", onMessage);
            w.removeEventListener("error", onError);
            reject(new Error(e.message || "Worker error"));
        }

        w.addEventListener("message", onMessage);
        w.addEventListener("error", onError);
        w.postMessage(msg);
    });
}

async function preloadModel() {
    if (modelReady) {
        showStatus("Model already loaded.", "success");
        setTimeout(hideStatus, 2000);
        return;
    }
    showStatus("Loading background removal model...", "info");
    showProgress(0);
    try {
        await sendWorkerMessage({ type: "load-model" });
        modelReady = true;
        dom.preloadButton.textContent = "Model Loaded";
        dom.preloadButton.disabled = true;
        showStatus("Model loaded and ready.", "success");
        setTimeout(hideStatus, 2000);
    } catch (err) {
        dom.progressContainer.classList.add("hidden");
        showStatus("Failed to load model: " + err.message, "error");
        setTimeout(hideStatus, 5000);
    }
}

// ---------------------------------------------------------------------------
// Background removal — browser (via worker)
// ---------------------------------------------------------------------------
async function removeBackgroundBrowser(imageDataUrl) {
    if (!modelReady) {
        showStatus("Loading background removal model...", "info");
        showProgress(0);
        await sendWorkerMessage({ type: "load-model" });
        modelReady = true;
        dom.preloadButton.textContent = "Model Loaded";
        dom.preloadButton.disabled = true;
    }

    showStatus("Removing background...", "info");

    const result = await sendWorkerMessage({
        type: "inference",
        imageDataUrl,
    });

    const { maskData, width, height } = result;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    // Draw original image and apply mask as alpha (keep transparent bg)
    const origImg = new Image();
    await new Promise((resolve, reject) => {
        origImg.onload = resolve;
        origImg.onerror = reject;
        origImg.src = imageDataUrl;
    });
    ctx.drawImage(origImg, 0, 0);

    const imageData = ctx.getImageData(0, 0, width, height);
    for (let i = 0; i < maskData.length; i++) {
        imageData.data[i * 4 + 3] = maskData[i];
    }
    ctx.putImageData(imageData, 0, 0);

    return canvas.toDataURL("image/png");
}

// ---------------------------------------------------------------------------
// Background removal — backend
// ---------------------------------------------------------------------------
async function removeBackgroundBackend(file) {
    showStatus("Sending to backend server...", "info");

    const formData = new FormData();
    formData.append("image", file);

    const response = await fetch(CONFIG.BACKEND_URL, {
        method: "POST",
        body: formData,
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
            "Backend error (" + response.status + ")" +
            (detail ? ": " + detail : ""),
        );
    }

    const blob = await response.blob();
    if (lastBlobUrl) URL.revokeObjectURL(lastBlobUrl);
    lastBlobUrl = URL.createObjectURL(blob);
    return lastBlobUrl;
}

// ---------------------------------------------------------------------------
// Event Listeners
// ---------------------------------------------------------------------------
function attachEventListeners() {
    // Step 1
    dom.step1Next.addEventListener("click", () => goToStep(2));

    // Step 2
    dom.step2Back.addEventListener("click", () => goToStep(1));

    dom.step2Skip.addEventListener("click", () => {
        state.processedDataUrl = state.imageDataUrl;
        goToStep(3);
    });

    dom.step2Next.addEventListener("click", () => goToStep(3));

    dom.removeBgButton.addEventListener("click", async () => {
        dom.removeBgButton.disabled = true;
        try {
            const mode = getInferenceMode();
            let resultUrl;

            if (mode === "backend") {
                const available = await checkBackend();
                if (!available) {
                    showStatus(
                        "Backend not available. Switch to Browser mode in Settings.",
                        "error",
                    );
                    dom.removeBgButton.disabled = false;
                    return;
                }
                resultUrl = await removeBackgroundBackend(state.imageFile);
            } else {
                resultUrl = await removeBackgroundBrowser(state.imageDataUrl);
            }

            state.processedDataUrl = resultUrl;
            dom.baAfter.src = resultUrl;
            dom.baAfter.classList.remove("hidden");
            dom.baPlaceholder.classList.add("hidden");
            dom.step2Next.disabled = false;

            showStatus("Background removed successfully.", "success");
            setTimeout(hideStatus, 3000);
        } catch (err) {
            showStatus("Background removal failed: " + err.message, "error");
        } finally {
            dom.removeBgButton.disabled = false;
        }
    });

    // Step 3
    dom.step3Back.addEventListener("click", () => goToStep(2));

    dom.step3Next.addEventListener("click", () => {
        bakeAdjustments().then(() => goToStep(4));
    });

    const onSliderChange = () => {
        state.adjustments.brightness = parseInt(dom.brightnessSlider.value);
        state.adjustments.contrast = parseInt(dom.contrastSlider.value);
        state.adjustments.saturation = parseInt(dom.saturationSlider.value);
        updateSliderValues();
        renderAdjustmentPreview();
    };

    dom.brightnessSlider.addEventListener("input", onSliderChange);
    dom.contrastSlider.addEventListener("input", onSliderChange);
    dom.saturationSlider.addEventListener("input", onSliderChange);

    dom.resetAdjustments.addEventListener("click", () => {
        state.adjustments = { brightness: 100, contrast: 100, saturation: 100 };
        dom.brightnessSlider.value = 100;
        dom.contrastSlider.value = 100;
        dom.saturationSlider.value = 100;
        updateSliderValues();
        renderAdjustmentPreview();
    });

    // Step 4
    dom.step4Back.addEventListener("click", () => {
        if (cropper) {
            cropper.destroy();
            cropper = null;
        }
        if (wheelHandler) {
            dom.image.removeEventListener("wheel", wheelHandler);
            wheelHandler = null;
        }
        goToStep(3);
    });

    dom.step4Next.addEventListener("click", () => goToStep(5));

    dom.presetSelect.addEventListener("change", () => {
        applyPreset(dom.presetSelect.value);
    });

    dom.widthInput.addEventListener("input", () => {
        dom.presetSelect.value = "";
        initializeCropper();
    });

    dom.heightInput.addEventListener("input", () => {
        dom.presetSelect.value = "";
        initializeCropper();
    });

    dom.unitSelect.addEventListener("change", initializeCropper);

    dom.zoomIn.addEventListener("click", () => {
        if (cropper) cropper.zoom(0.1);
    });

    dom.zoomOut.addEventListener("click", () => {
        if (cropper) cropper.zoom(-0.1);
    });

    dom.toggleMode.addEventListener("click", () => {
        isMovingCropWindow = !isMovingCropWindow;
        dom.toggleMode.textContent = isMovingCropWindow ? "Move Image" : "Move Crop";
    });

    // Step 5
    dom.step5Back.addEventListener("click", () => goToStep(4));

    dom.step5StartOver.addEventListener("click", () => {
        state.imageFile = null;
        state.imageDataUrl = null;
        state.processedDataUrl = null;
        state.adjustedDataUrl = null;
        state.adjustments = { brightness: 100, contrast: 100, saturation: 100 };
        if (cropper) { cropper.destroy(); cropper = null; }
        if (wheelHandler) {
            dom.image.removeEventListener("wheel", wheelHandler);
            wheelHandler = null;
        }

        dom.dropZonePrompt.classList.remove("hidden");
        dom.uploadPreview.classList.add("hidden");
        dom.step1Next.disabled = true;
        dom.imageInput.value = "";

        goToStep(1);
    });

    // Crop & Save (single photo) — composite onto white for export
    dom.cropButton.addEventListener("click", () => {
        if (!cropper) return;
        const width = convertToPixels(parseFloat(dom.widthInput.value), dom.unitSelect.value);
        const height = convertToPixels(parseFloat(dom.heightInput.value), dom.unitSelect.value);
        const croppedCanvas = cropper.getCroppedCanvas({ width, height });

        const exportCanvas = document.createElement("canvas");
        exportCanvas.width = width;
        exportCanvas.height = height;
        const ectx = exportCanvas.getContext("2d");
        ectx.fillStyle = "#ffffff";
        ectx.fillRect(0, 0, width, height);
        ectx.drawImage(croppedCanvas, 0, 0);

        exportCanvas.toBlob((blob) => {
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = "photo_id.png";
            link.click();
        }, "image/png");
    });

    // Generate 4x6 Layout
    dom.generate4x6Button.addEventListener("click", () => {
        if (!cropper) return;

        const idWidth = convertToPixels(parseFloat(dom.widthInput.value), dom.unitSelect.value);
        const idHeight = convertToPixels(parseFloat(dom.heightInput.value), dom.unitSelect.value);

        const columns = Math.floor(CONFIG.CANVAS_4X6_WIDTH / idWidth);
        const rows = Math.floor(CONFIG.CANVAS_4X6_HEIGHT / idHeight);

        const canvas = document.createElement("canvas");
        canvas.width = CONFIG.CANVAS_4X6_WIDTH;
        canvas.height = CONFIG.CANVAS_4X6_HEIGHT;
        const context = canvas.getContext("2d");

        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);

        const croppedCanvas = cropper.getCroppedCanvas({
            width: idWidth,
            height: idHeight,
        });

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < columns; col++) {
                context.drawImage(croppedCanvas, col * idWidth, row * idHeight, idWidth, idHeight);
            }
        }

        canvas.toBlob((blob) => {
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = "photo_id_4x6.png";
            link.click();
        }, "image/png");
    });

    // Keyboard navigation (only active on crop step)
    document.addEventListener("keydown", (event) => {
        if (!cropper || state.currentStep !== 4) return;
        const step = CONFIG.ARROW_STEP;

        if (isMovingCropWindow) {
            const data = cropper.getData();
            switch (event.key) {
                case "ArrowUp":    data.y -= step; break;
                case "ArrowDown":  data.y += step; break;
                case "ArrowLeft":  data.x -= step; break;
                case "ArrowRight": data.x += step; break;
                default: return;
            }
            cropper.setData(data);
        } else {
            switch (event.key) {
                case "ArrowUp":    cropper.move(0, -step); break;
                case "ArrowDown":  cropper.move(0, step);  break;
                case "ArrowLeft":  cropper.move(-step, 0);  break;
                case "ArrowRight": cropper.move(step, 0);   break;
                default: return;
            }
        }
    });

    // Settings drawer
    dom.settingsToggle.addEventListener("click", () => {
        dom.settingsDrawer.classList.remove("hidden");
        dom.settingsOverlay.classList.remove("hidden");
    });

    const closeSettings = () => {
        dom.settingsDrawer.classList.add("hidden");
        dom.settingsOverlay.classList.add("hidden");
    };

    dom.settingsClose.addEventListener("click", closeSettings);
    dom.settingsOverlay.addEventListener("click", closeSettings);

    dom.preloadButton.addEventListener("click", preloadModel);

    document.querySelectorAll('input[name="inference-mode"]').forEach((radio) => {
        radio.addEventListener("change", () => {
            if (radio.value === "backend") checkBackend();
        });
    });
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
dom.getStarted.addEventListener("click", () => {
    dom.landing.classList.add("hidden");
    dom.appShell.classList.remove("hidden");
});

setupDropZone();
attachEventListeners();
updateProgressIndicator();
checkBackend();
