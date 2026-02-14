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
    MEDIAPIPE_VISION_WASM: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm",
    MEDIAPIPE_MODEL: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    MAX_IMAGE_DIM: 2048,
    MAX_IMAGE_DIM_MOBILE: 1200,
};

const PRESETS = [
    {
        label: "US Passport", width: 2, height: 2, unit: "inches", region: "North America",
        compliance: { headHeightMin: 0.50, headHeightMax: 0.69, eyeHeightMin: 0.56, eyeHeightMax: 0.69, maxTiltDegrees: 5 },
    },
    {
        label: "US Visa", width: 2, height: 2, unit: "inches", region: "North America",
        compliance: { headHeightMin: 0.50, headHeightMax: 0.69, eyeHeightMin: 0.56, eyeHeightMax: 0.69, maxTiltDegrees: 5 },
    },
    {
        label: "Canada Passport", width: 5, height: 7, unit: "cm", region: "North America",
        compliance: { headHeightMin: 0.46, headHeightMax: 0.63, eyeHeightMin: 0.55, eyeHeightMax: 0.65, maxTiltDegrees: 5 },
    },
    {
        label: "EU/Schengen ID", width: 3.5, height: 4.5, unit: "cm", region: "Europe",
        compliance: { headHeightMin: 0.70, headHeightMax: 0.80, eyeHeightMin: 0.60, eyeHeightMax: 0.70, maxTiltDegrees: 5 },
    },
    {
        label: "UK Passport", width: 3.5, height: 4.5, unit: "cm", region: "Europe",
        compliance: { headHeightMin: 0.70, headHeightMax: 0.80, eyeHeightMin: 0.60, eyeHeightMax: 0.70, maxTiltDegrees: 5 },
    },
    {
        label: "China Passport", width: 3.3, height: 4.8, unit: "cm", region: "Asia-Pacific",
        compliance: { headHeightMin: 0.50, headHeightMax: 0.70, eyeHeightMin: 0.55, eyeHeightMax: 0.70, maxTiltDegrees: 5 },
    },
    {
        label: "India Passport", width: 3.5, height: 3.5, unit: "cm", region: "Asia-Pacific",
        compliance: { headHeightMin: 0.50, headHeightMax: 0.70, eyeHeightMin: 0.55, eyeHeightMax: 0.70, maxTiltDegrees: 5 },
    },
    {
        label: "Japan Passport", width: 3.5, height: 4.5, unit: "cm", region: "Asia-Pacific",
        compliance: { headHeightMin: 0.70, headHeightMax: 0.80, eyeHeightMin: 0.60, eyeHeightMax: 0.70, maxTiltDegrees: 5 },
    },
    {
        label: "Australia Passport", width: 3.5, height: 4.5, unit: "cm", region: "Asia-Pacific",
        compliance: { headHeightMin: 0.70, headHeightMax: 0.80, eyeHeightMin: 0.60, eyeHeightMax: 0.70, maxTiltDegrees: 5 },
    },
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
    faceData: null,
    complianceResult: null,
    isOneClickMode: false,
    selectedPresetIndex: "",
};

let cropper = null;
let isMovingCropWindow = false;
let worker = null;
let modelReady = false;
let wheelHandler = null;
let lastBlobUrl = null;
let faceLandmarker = null;

const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && window.innerWidth < 1024);

const MEMORY_TIERS = {
    high:   { processorSize: 1024, maxImageDim: 2048, label: "high" },
    medium: { processorSize: 768,  maxImageDim: 1200, label: "medium" },
    low:    { processorSize: 256,  maxImageDim: 1200, label: "low" },
};

function getMemoryTier() {
    if (!isMobile) return MEMORY_TIERS.high;

    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
        || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

    if (isIOS) {
        const minDim = Math.min(screen.width, screen.height);
        return minDim >= 768 ? MEMORY_TIERS.medium : MEMORY_TIERS.low;
    }

    const mem = navigator.deviceMemory;
    if (mem) {
        if (mem >= 8) return MEMORY_TIERS.high;
        if (mem >= 4) return MEMORY_TIERS.medium;
        return MEMORY_TIERS.low;
    }

    return MEMORY_TIERS.medium;
}

const memoryTier = getMemoryTier();
console.log(`[tier] ${memoryTier.label}: processor=${memoryTier.processorSize}px, maxImage=${memoryTier.maxImageDim}px`);

function logMem(label) {
    if (!isMobile) return;
    const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1) + "MB";
    // performance.memory is Chrome-only; on Safari just log the label
    if (performance.memory) {
        console.log(`[mem] ${label}: used=${mb(performance.memory.usedJSHeapSize)} total=${mb(performance.memory.totalJSHeapSize)}`);
    } else {
        console.log(`[mem] ${label}`);
    }
}

// ---------------------------------------------------------------------------
// Image Resize Helper (prevents mobile OOM crashes with 12MP+ photos)
// ---------------------------------------------------------------------------
function resizeImageIfNeeded(dataUrl, maxDim) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            if (img.width <= maxDim && img.height <= maxDim) {
                resolve(dataUrl);
                return;
            }
            const scale = maxDim / Math.max(img.width, img.height);
            const w = Math.round(img.width * scale);
            const h = Math.round(img.height * scale);
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            canvas.getContext("2d").drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL("image/jpeg", 0.92));
        };
        img.src = dataUrl;
    });
}

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
    oneClickPanel: $("one-click-panel"),
    quickPresetSelect: $("quick-preset-select"),
    oneClickButton: $("one-click-button"),
    skipBgOption: $("skip-bg-option"),
    skipBgCheckbox: $("skip-bg-checkbox"),
    manualModeLink: $("manual-mode-link"),

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
    autoCenterFace: $("auto-center-face"),
    toggleMode: $("toggle-mode"),
    step4Back: $("step4-back"),
    step4Next: $("step4-next"),

    // Step 5
    exportCanvas: $("export-canvas"),
    compliancePanel: $("compliance-panel"),
    complianceList: $("compliance-list"),
    manualAdjustButton: $("manual-adjust-button"),
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
        dom.oneClickPanel.classList.remove("hidden");
    }
}

function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) return;

    state.imageFile = file;
    const reader = new FileReader();
    reader.onload = async () => {
        const maxDim = memoryTier.maxImageDim;
        logMem(`handleFile start (maxDim=${maxDim}, rawLen=${(reader.result.length / 1024 / 1024).toFixed(1)}MB)`);
        state.imageDataUrl = await resizeImageIfNeeded(reader.result, maxDim);
        logMem("handleFile resized");
        // Reset downstream state
        state.processedDataUrl = null;
        state.adjustedDataUrl = null;
        state.adjustments = { brightness: 100, contrast: 100, saturation: 100 };
        state.faceData = null;
        state.complianceResult = null;
        state.isOneClickMode = false;
        state.selectedPresetIndex = "";

        dom.previewImage.src = state.imageDataUrl;
        dom.dropZonePrompt.classList.add("hidden");
        dom.uploadPreview.classList.remove("hidden");
        dom.step1Next.disabled = false;
        dom.oneClickPanel.classList.remove("hidden");
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
        if (e.target.closest("#one-click-panel")) return;
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
    // Restore preset from state (DOM value is lost when select is rebuilt)
    if (state.selectedPresetIndex !== "") {
        dom.presetSelect.value = state.selectedPresetIndex;
    }

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

    // Enable auto-center button if face data is available
    dom.autoCenterFace.disabled = !state.faceData;

    // Skip cropper init when one-click mode handles it via initializeCropperAsync()
    if (state.isOneClickMode) return;

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

function populatePresetSelect(select) {
    // Keep only the first option (e.g. "Custom" or "Select ID type...")
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

function populatePresets() {
    populatePresetSelect(dom.presetSelect);
}

function populateQuickPresets() {
    populatePresetSelect(dom.quickPresetSelect);
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

function initializeCropper(onReady) {
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

    const options = {
        aspectRatio: widthValue / heightValue,
        dragMode: "crop",
    };

    const enableControls = () => {
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
    };

    if (onReady) {
        options.ready = () => {
            enableControls();
            onReady();
        };
    }

    cropper = new Cropper(dom.image, options);

    if (!onReady) {
        enableControls();
    }
}

// Returns a promise that resolves when CropperJS is fully ready
function initializeCropperAsync() {
    const widthValue = parseFloat(dom.widthInput.value);
    const heightValue = parseFloat(dom.heightInput.value);

    if (!widthValue || !heightValue || widthValue <= 0 || heightValue <= 0) {
        return Promise.reject(new Error("Invalid crop dimensions"));
    }

    return new Promise((resolve) => {
        initializeCropper(resolve);
    });
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

    // Show compliance panel if we have results
    if (state.complianceResult) {
        renderCompliancePanel(state.complianceResult);
    } else {
        dom.compliancePanel.classList.add("hidden");
    }
}

// ---------------------------------------------------------------------------
// Face Detection (MediaPipe)
// ---------------------------------------------------------------------------
async function initFaceLandmarker() {
    if (faceLandmarker) return faceLandmarker;

    showStatus("Loading face detection model...", "info");

    const { FaceLandmarker, FilesetResolver } = await import(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/vision_bundle.mjs"
    );

    const vision = await FilesetResolver.forVisionTasks(CONFIG.MEDIAPIPE_VISION_WASM);
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: CONFIG.MEDIAPIPE_MODEL,
        },
        runningMode: "IMAGE",
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
    });

    showStatus("Face detection model loaded.", "success");

    return faceLandmarker;
}

async function detectFace(imageElement) {
    const fl = await initFaceLandmarker();
    const result = fl.detect(imageElement);

    if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
        return null;
    }

    const landmarks = result.faceLandmarks[0];

    // Key landmark indices
    const foreheadCenter = landmarks[10];
    const chin = landmarks[152];
    const leftEyeInner = landmarks[362];
    const rightEyeInner = landmarks[133];
    const leftCheek = landmarks[454];
    const rightCheek = landmarks[234];

    const imgW = imageElement.naturalWidth || imageElement.width;
    const imgH = imageElement.naturalHeight || imageElement.height;

    // Face center (midpoint between eyes)
    const eyeCenterX = ((leftEyeInner.x + rightEyeInner.x) / 2) * imgW;
    const eyeCenterY = ((leftEyeInner.y + rightEyeInner.y) / 2) * imgH;

    // Face bounding box (forehead landmark to chin)
    const faceTop = foreheadCenter.y * imgH;
    const faceBottom = chin.y * imgH;
    const faceLeft = rightCheek.x * imgW;
    const faceRight = leftCheek.x * imgW;
    const faceHeight = faceBottom - faceTop;
    const faceWidth = faceRight - faceLeft;
    const faceCenterX = (faceLeft + faceRight) / 2;
    const faceCenterY = (faceTop + faceBottom) / 2;

    // Estimated full head (forehead landmark is at hairline, not top of skull)
    const headTop = Math.max(0, faceTop - faceHeight * 0.25);
    const headHeight = faceBottom - headTop;

    // Head tilt (roll) from eye alignment
    const rollAngle = Math.atan2(
        (leftEyeInner.y - rightEyeInner.y) * imgH,
        (leftEyeInner.x - rightEyeInner.x) * imgW,
    ) * (180 / Math.PI);

    return {
        landmarks,
        eyeCenterX, eyeCenterY,
        faceCenterX, faceCenterY,
        faceTop, faceBottom, faceLeft, faceRight,
        faceHeight, faceWidth,
        headTop, headHeight,
        rollAngle,
        imgW, imgH,
    };
}

// ---------------------------------------------------------------------------
// Smart Crop from Face Data
// ---------------------------------------------------------------------------
function applyCropFromFaceData(faceData) {
    if (!cropper || !faceData) return;

    const containerData = cropper.getContainerData();
    const imageData = cropper.getImageData();
    const canvasData = cropper.getCanvasData();

    // Get aspect ratio from current crop settings
    const widthValue = parseFloat(dom.widthInput.value);
    const heightValue = parseFloat(dom.heightInput.value);
    if (!widthValue || !heightValue) return;
    const aspectRatio = widthValue / heightValue;

    // Scale factor from original image coords to CropperJS canvas coords
    const scaleX = canvasData.width / canvasData.naturalWidth;
    const scaleY = canvasData.height / canvasData.naturalHeight;

    // Face geometry in CropperJS canvas coordinates
    const faceCenterXCanvas = faceData.faceCenterX * scaleX + canvasData.left;
    const headTopCanvas = faceData.headTop * scaleY + canvasData.top;
    const headHeightCanvas = faceData.headHeight * scaleY;

    // Target: head (including top of skull) occupies ~55% of frame height
    const targetHeadRatio = 0.55;
    const cropHeight = headHeightCanvas / targetHeadRatio;
    const cropWidth = cropHeight * aspectRatio;

    // Vertical positioning: ~18% margin above top of head
    const headMarginTop = 0.18;
    const cropTop = headTopCanvas - (cropHeight * headMarginTop);
    const cropLeft = faceCenterXCanvas - (cropWidth / 2);

    // Clamp to container boundaries
    const clampedLeft = Math.max(0, Math.min(cropLeft, containerData.width - cropWidth));
    const clampedTop = Math.max(0, Math.min(cropTop, containerData.height - cropHeight));

    cropper.setCropBoxData({
        left: clampedLeft,
        top: clampedTop,
        width: Math.min(cropWidth, containerData.width),
        height: Math.min(cropHeight, containerData.height),
    });
}

// ---------------------------------------------------------------------------
// Compliance Checks
// ---------------------------------------------------------------------------
function checkCompliance(faceData, presetIndex) {
    const preset = PRESETS[parseInt(presetIndex)];
    const rules = preset && preset.compliance;
    if (!rules || !faceData || !cropper) return { allPassed: true, checks: [] };

    const cropData = cropper.getData();
    const checks = [];

    // 1. Head-to-frame height ratio (using estimated full head height)
    const headRatio = faceData.headHeight / cropData.height;
    checks.push({
        id: "head-height",
        label: `Head height: ${(headRatio * 100).toFixed(0)}% of frame`,
        expected: `${(rules.headHeightMin * 100).toFixed(0)}%\u2013${(rules.headHeightMax * 100).toFixed(0)}%`,
        passed: headRatio >= rules.headHeightMin && headRatio <= rules.headHeightMax,
    });

    // 2. Eye height from bottom
    if (rules.eyeHeightMin && rules.eyeHeightMax) {
        const eyeFromBottom = (cropData.y + cropData.height - faceData.eyeCenterY) / cropData.height;
        checks.push({
            id: "eye-height",
            label: `Eye position: ${(eyeFromBottom * 100).toFixed(0)}% from bottom`,
            expected: `${(rules.eyeHeightMin * 100).toFixed(0)}%\u2013${(rules.eyeHeightMax * 100).toFixed(0)}%`,
            passed: eyeFromBottom >= rules.eyeHeightMin && eyeFromBottom <= rules.eyeHeightMax,
        });
    }

    // 3. Horizontal centering
    const faceCenterInCrop = (faceData.faceCenterX - cropData.x) / cropData.width;
    const centerDeviation = Math.abs(faceCenterInCrop - 0.5);
    checks.push({
        id: "horizontal-center",
        label: `Face centering: ${(centerDeviation * 100).toFixed(1)}% off-center`,
        expected: "< 5%",
        passed: centerDeviation < 0.05,
    });

    // 4. Head tilt
    const absTilt = Math.abs(faceData.rollAngle);
    checks.push({
        id: "head-tilt",
        label: `Head tilt: ${absTilt.toFixed(1)}\u00b0`,
        expected: `< ${rules.maxTiltDegrees}\u00b0`,
        passed: absTilt < rules.maxTiltDegrees,
    });

    // 5. Face fully within frame
    const faceInFrame =
        faceData.faceTop >= cropData.y &&
        faceData.faceBottom <= cropData.y + cropData.height &&
        faceData.faceLeft >= cropData.x &&
        faceData.faceRight <= cropData.x + cropData.width;
    checks.push({
        id: "face-in-frame",
        label: faceInFrame ? "Face fully within frame" : "Face partially outside frame",
        passed: faceInFrame,
    });

    // 6. Top margin (space above top of head)
    const topMargin = (faceData.headTop - cropData.y) / cropData.height;
    checks.push({
        id: "top-margin",
        label: `Top margin: ${(topMargin * 100).toFixed(0)}%`,
        expected: "8%\u201315%",
        passed: topMargin >= 0.08 && topMargin <= 0.15,
    });

    return {
        allPassed: checks.every((c) => c.passed),
        checks,
    };
}

function renderCompliancePanel(complianceResult) {
    const list = dom.complianceList;
    list.innerHTML = "";

    complianceResult.checks.forEach((check) => {
        const li = document.createElement("li");
        li.className = "compliance-item " + (check.passed ? "pass" : "fail");

        const svg = check.passed
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

        const expectedStr = check.expected ? ` (required: ${check.expected})` : "";
        li.innerHTML = `${svg}<span>${check.label}${expectedStr}</span>`;
        list.appendChild(li);
    });

    dom.compliancePanel.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// One-Click Pipeline
// ---------------------------------------------------------------------------
async function oneClickGenerate() {
    if (!state.imageDataUrl) {
        showStatus("Please upload a photo first.", "error");
        return;
    }

    const presetIndex = dom.quickPresetSelect.value;
    if (presetIndex === "") {
        showStatus("Please select an ID photo type.", "error");
        return;
    }

    state.isOneClickMode = true;
    const preset = PRESETS[parseInt(presetIndex)];
    dom.oneClickButton.disabled = true;

    try {
        // Step 1: Detect face
        showStatus("Detecting face...", "info");
        const tempImg = new Image();
        await new Promise((resolve, reject) => {
            tempImg.onload = resolve;
            tempImg.onerror = reject;
            tempImg.src = state.imageDataUrl;
        });

        const faceData = await detectFace(tempImg);
        tempImg.src = "";
        logMem("tempImg freed");
        if (!faceData) {
            showStatus("No face detected. Please use manual steps.", "error");
            state.isOneClickMode = false;
            dom.oneClickButton.disabled = false;
            return;
        }
        state.faceData = faceData;

        // Free MediaPipe on mobile before BG removal to reclaim ~30-50MB
        if (isMobile && faceLandmarker) {
            faceLandmarker.close();
            faceLandmarker = null;
            logMem("MediaPipe closed");
        }

        // Step 2: Background removal (skip if user opted out on mobile)
        if (dom.skipBgCheckbox && !dom.skipBgCheckbox.checked) {
            console.log("[one-click] skipping BG removal (user opted out)");
            state.processedDataUrl = state.imageDataUrl;
        } else {
            const mode = getInferenceMode();
            if (mode === "backend") {
                const available = await checkBackend();
                if (!available) {
                    showStatus("Backend not available. Switch to Browser mode in Settings.", "error");
                    state.isOneClickMode = false;
                    dom.oneClickButton.disabled = false;
                    return;
                }
                state.processedDataUrl = await removeBackgroundBackend(state.imageFile);
            } else {
                state.processedDataUrl = await removeBackgroundBrowser(state.imageDataUrl);
            }
        }

        // Step 3: Skip adjustments (use defaults for one-click)
        state.adjustedDataUrl = state.processedDataUrl;
        state.adjustments = { brightness: 100, contrast: 100, saturation: 100 };

        // Step 4: Set up crop with preset dimensions
        dom.widthInput.value = preset.width;
        dom.heightInput.value = preset.height;
        dom.unitSelect.value = preset.unit === "inches" ? "inches" : "cm";
        dom.presetSelect.value = presetIndex;
        state.selectedPresetIndex = presetIndex;

        // Navigate to step 4 to initialize CropperJS with the image
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

        // Show step 4 so CropperJS has a visible container
        goToStep(4);

        // Wait for image to load then initialize cropper
        await new Promise((resolve) => {
            if (dom.image.complete && dom.image.naturalWidth) {
                resolve();
            } else {
                dom.image.onload = resolve;
            }
        });

        showStatus("Centering face and cropping...", "info");
        await initializeCropperAsync();

        // Apply smart crop based on face data
        applyCropFromFaceData(faceData);

        // Step 5: Compliance checks
        state.complianceResult = checkCompliance(faceData, presetIndex);

        // Navigate to export
        goToStep(5);

        state.isOneClickMode = false;

        if (state.complianceResult.allPassed) {
            showStatus("ID photo generated. All compliance checks passed!", "success");
        } else {
            showStatus("ID photo generated. Review compliance warnings below.", "info");
        }
        setTimeout(hideStatus, 5000);
    } catch (err) {
        showStatus("Generation failed: " + err.message, "error");
        state.isOneClickMode = false;
    } finally {
        dom.oneClickButton.disabled = false;
    }
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
        worker = new Worker("static/worker.js?v=4", { type: "module" });
    }
    return worker;
}

function destroyWorker() {
    if (worker) {
        worker.terminate();
        worker = null;
    }
    modelReady = false;
}

// ---------------------------------------------------------------------------
// Main-thread inference for low-tier devices (iPhone)
// iOS Safari Web Workers have a ~100-150MB memory ceiling that's too small for
// RMBG-1.4 (~45MB weights + ~25MB WASM + ~30-50MB activations). Running on the
// main thread uses the page's larger memory budget (~500-700MB).
// ---------------------------------------------------------------------------
let mainThreadModel = null;
let mainThreadProcessor = null;
let mainThreadModelReady = false;

async function loadMainThreadModel(processorSize) {
    if (mainThreadModel && mainThreadProcessor) {
        console.log("[main-thread] model already loaded");
        return;
    }
    console.log("[main-thread] loading Transformers.js...");
    const { AutoModel, AutoProcessor, env } = await import(
        "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.1.2"
    );
    env.allowLocalModels = false;

    const MODEL_ID = "briaai/RMBG-1.4";

    console.log("[main-thread] loading model...");
    mainThreadModel = await AutoModel.from_pretrained(MODEL_ID, {
        config: { model_type: "custom" },
        progress_callback: (p) => {
            if (p.status === "progress" && p.total) {
                showProgress(Math.round((p.loaded / p.total) * 100));
            }
        },
    });

    console.log(`[main-thread] loading processor (${processorSize}px)...`);
    mainThreadProcessor = await AutoProcessor.from_pretrained(MODEL_ID, {
        config: {
            do_normalize: true,
            do_pad: false,
            do_rescale: true,
            do_resize: true,
            image_mean: [0.5, 0.5, 0.5],
            image_std: [1, 1, 1],
            resample: 2,
            rescale_factor: 0.00392156862745098,
            size: { width: processorSize, height: processorSize },
        },
    });

    mainThreadModelReady = true;
    console.log("[main-thread] model ready");
}

async function runInferenceMainThread(imageDataUrl, processorSize) {
    const { RawImage } = await import(
        "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.1.2"
    );

    if (!mainThreadModelReady) {
        showStatus("Loading background removal model...", "info");
        showProgress(0);
        await loadMainThreadModel(processorSize);
    }

    showStatus("Removing background \u2014 the screen may freeze for 15\u201330s, this is normal...", "info");
    logMem("[main-thread] inference start");

    const rawImage = await RawImage.fromURL(imageDataUrl);
    console.log(`[main-thread] image: ${rawImage.width}x${rawImage.height}`);

    console.log(`[main-thread] running processor (${processorSize}px)...`);
    const { pixel_values } = await mainThreadProcessor(rawImage);

    console.log("[main-thread] running model inference...");
    const { output } = await mainThreadModel({ input: pixel_values });
    pixel_values.dispose?.();  // Free ~3MB
    logMem("[main-thread] pixel_values disposed");

    console.log("[main-thread] resizing mask...");
    const maskData = output[0].mul(255).to("uint8");
    output.dispose?.();  // Free ~1MB
    logMem("[main-thread] output disposed");
    const mask = await RawImage.fromTensor(maskData).resize(
        rawImage.width,
        rawImage.height,
    );

    logMem("[main-thread] inference done");
    const resultData = { maskData: mask.data, width: rawImage.width, height: rawImage.height };

    // Free model + processor + WASM runtime to reclaim ~100MB before export steps
    console.log("[main-thread] freeing model to reclaim memory...");
    if (mainThreadModel && mainThreadModel.dispose) mainThreadModel.dispose();
    mainThreadModel = null;
    mainThreadProcessor = null;
    mainThreadModelReady = false;
    logMem("[main-thread] model freed");

    // Yield to event loop so GC can collect before mask application
    await new Promise(r => setTimeout(r, 50));

    return resultData;
}

function sendWorkerMessage(msg, transferables, timeoutMs = 0) {
    return new Promise((resolve, reject) => {
        const w = getWorker();
        let timer = null;

        function cleanup() {
            w.removeEventListener("message", onMessage);
            w.removeEventListener("error", onError);
            if (timer) clearTimeout(timer);
        }

        function onMessage(e) {
            const { type } = e.data;
            if (type === "progress") {
                showProgress(e.data.percent);
                return;
            }
            cleanup();
            if (type === "error") {
                reject(new Error(e.data.message));
            } else {
                resolve(e.data);
            }
        }

        function onError(e) {
            cleanup();
            reject(new Error(e.message || "Worker error"));
        }

        if (timeoutMs > 0) {
            timer = setTimeout(() => {
                cleanup();
                reject(new Error("Worker timeout"));
            }, timeoutMs);
        }

        w.addEventListener("message", onMessage);
        w.addEventListener("error", onError);
        w.postMessage(msg, transferables || []);
    });
}

async function preloadModel() {
    const useMainThread = memoryTier === MEMORY_TIERS.low;

    if (useMainThread ? mainThreadModelReady : modelReady) {
        showStatus("Model already loaded.", "success");
        setTimeout(hideStatus, 2000);
        return;
    }
    showStatus("Loading background removal model...", "info");
    showProgress(0);
    try {
        if (useMainThread) {
            await loadMainThreadModel(memoryTier.processorSize);
        } else {
            await sendWorkerMessage({ type: "load-model", processorSize: memoryTier.processorSize }, [], 120000);
            modelReady = true;
        }
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
// Background removal — browser (via worker) with crash recovery
// ---------------------------------------------------------------------------
const TIER_ORDER = [MEMORY_TIERS.high, MEMORY_TIERS.medium, MEMORY_TIERS.low];

async function attemptInference(imageDataUrl, processorSize, useMainThread = false) {
    let result;
    let sourceImg = null;

    if (useMainThread) {
        // Main-thread path for low-tier devices (iPhone)
        console.log(`[bg-removal] using main-thread inference (processor=${processorSize}px)`);
        result = await runInferenceMainThread(imageDataUrl, processorSize);
    } else {
        // Worker path for medium/high-tier devices
        if (!modelReady) {
            showStatus("Loading background removal model...", "info");
            showProgress(0);
            await sendWorkerMessage({ type: "load-model", processorSize }, [], 120000);
            modelReady = true;
            dom.preloadButton.textContent = "Model Loaded";
            dom.preloadButton.disabled = true;
        } else {
            await sendWorkerMessage({ type: "load-model", processorSize }, [], 120000);
        }

        showStatus("Removing background...", "info");
        logMem("removeBackground start");

        if (isMobile) {
            sourceImg = new Image();
            await new Promise((resolve, reject) => {
                sourceImg.onload = resolve;
                sourceImg.onerror = reject;
                sourceImg.src = imageDataUrl;
            });
            logMem(`removeBackground decoded (${sourceImg.width}x${sourceImg.height}, ~${(sourceImg.width * sourceImg.height * 4 / 1024 / 1024).toFixed(1)}MB RGBA)`);
            const offscreen = document.createElement("canvas");
            offscreen.width = sourceImg.width;
            offscreen.height = sourceImg.height;
            const offCtx = offscreen.getContext("2d");
            offCtx.drawImage(sourceImg, 0, 0);
            const pixelData = offCtx.getImageData(0, 0, sourceImg.width, sourceImg.height);
            offscreen.width = 0;
            offscreen.height = 0;
            logMem("removeBackground pixels extracted, canvas freed");

            result = await sendWorkerMessage({
                type: "inference",
                imageData: pixelData.data.buffer,
                width: sourceImg.width,
                height: sourceImg.height,
            }, [pixelData.data.buffer], 60000);
            logMem("removeBackground inference done (buffer transferred)");
        } else {
            result = await sendWorkerMessage({
                type: "inference",
                imageDataUrl,
            }, [], 60000);
        }
    }

    const { maskData, width, height } = result;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    if (!sourceImg) {
        sourceImg = new Image();
        await new Promise((resolve, reject) => {
            sourceImg.onload = resolve;
            sourceImg.onerror = reject;
            sourceImg.src = imageDataUrl;
        });
    }
    ctx.drawImage(sourceImg, 0, 0);

    const imageData = ctx.getImageData(0, 0, width, height);
    for (let i = 0; i < maskData.length; i++) {
        imageData.data[i * 4 + 3] = maskData[i];
    }
    ctx.putImageData(imageData, 0, 0);
    logMem("removeBackground mask applied");

    const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
    // Free the mask-application canvas (~4.8MB for a 1012x1200 image)
    canvas.width = 0;
    canvas.height = 0;
    if (lastBlobUrl) URL.revokeObjectURL(lastBlobUrl);
    lastBlobUrl = URL.createObjectURL(blob);
    logMem("removeBackground done (blob URL)");
    return lastBlobUrl;
}

async function removeBackgroundBrowser(imageDataUrl) {
    // Build list of tiers to try, starting from current tier and stepping down
    const startIdx = TIER_ORDER.indexOf(memoryTier);
    const tiersToTry = TIER_ORDER.slice(startIdx);

    for (let i = 0; i < tiersToTry.length; i++) {
        const tier = tiersToTry[i];
        // Low tier (iPhone) uses main thread — worker memory ceiling is too low
        const useMainThread = tier === MEMORY_TIERS.low;
        try {
            console.log(`[bg-removal] attempting at ${tier.label} tier (processor=${tier.processorSize}px, mainThread=${useMainThread})`);
            return await attemptInference(imageDataUrl, tier.processorSize, useMainThread);
        } catch (err) {
            console.warn(`[bg-removal] failed at ${tier.label} tier:`, err.message);
            if (!useMainThread) destroyWorker();

            if (i < tiersToTry.length - 1) {
                const nextTier = tiersToTry[i + 1];
                showStatus(`Retrying at lower quality (${nextTier.processorSize}px)...`, "info");
                console.log(`[bg-removal] retrying at ${nextTier.label} tier`);
            } else {
                throw new Error(
                    "Background removal failed — your device may not have enough memory. " +
                    "Try unchecking \"Remove background\" and using the photo without BG removal."
                );
            }
        }
    }
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

    // One-click panel
    dom.quickPresetSelect.addEventListener("change", () => {
        dom.oneClickButton.disabled = dom.quickPresetSelect.value === "";
    });

    dom.oneClickButton.addEventListener("click", oneClickGenerate);

    dom.manualModeLink.addEventListener("click", () => {
        dom.step1Next.click();
    });

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

    dom.step4Next.addEventListener("click", () => {
        // Run compliance check before going to export if we have face data
        if (state.faceData) {
            const presetIndex = dom.presetSelect.value;
            if (presetIndex !== "") {
                state.complianceResult = checkCompliance(state.faceData, presetIndex);
            }
        }
        goToStep(5);
    });

    dom.presetSelect.addEventListener("change", () => {
        state.selectedPresetIndex = dom.presetSelect.value;
        applyPreset(dom.presetSelect.value);
    });

    dom.widthInput.addEventListener("input", () => {
        dom.presetSelect.value = "";
        state.selectedPresetIndex = "";
        initializeCropper();
    });

    dom.heightInput.addEventListener("input", () => {
        dom.presetSelect.value = "";
        state.selectedPresetIndex = "";
        initializeCropper();
    });

    dom.unitSelect.addEventListener("change", initializeCropper);

    dom.zoomIn.addEventListener("click", () => {
        if (cropper) cropper.zoom(0.1);
    });

    dom.zoomOut.addEventListener("click", () => {
        if (cropper) cropper.zoom(-0.1);
    });

    // Auto-center face button
    dom.autoCenterFace.addEventListener("click", async () => {
        if (!cropper) return;

        // If no face data yet, detect now
        if (!state.faceData) {
            dom.autoCenterFace.disabled = true;
            showStatus("Detecting face...", "info");
            try {
                const tempImg = new Image();
                await new Promise((resolve, reject) => {
                    tempImg.onload = resolve;
                    tempImg.onerror = reject;
                    tempImg.src = state.adjustedDataUrl || state.processedDataUrl || state.imageDataUrl;
                });
                const faceData = await detectFace(tempImg);
                if (!faceData) {
                    showStatus("No face detected in the image.", "error");
                    setTimeout(hideStatus, 3000);
                    dom.autoCenterFace.disabled = false;
                    return;
                }
                state.faceData = faceData;
            } catch (err) {
                showStatus("Face detection failed: " + err.message, "error");
                dom.autoCenterFace.disabled = false;
                return;
            }
        }

        applyCropFromFaceData(state.faceData);
        hideStatus();
        dom.autoCenterFace.disabled = false;
    });

    dom.toggleMode.addEventListener("click", () => {
        isMovingCropWindow = !isMovingCropWindow;
        dom.toggleMode.textContent = isMovingCropWindow ? "Move Image" : "Move Crop";
    });

    // Step 5
    dom.step5Back.addEventListener("click", () => goToStep(4));

    dom.manualAdjustButton.addEventListener("click", () => goToStep(4));

    dom.step5StartOver.addEventListener("click", () => {
        state.imageFile = null;
        state.imageDataUrl = null;
        state.processedDataUrl = null;
        state.adjustedDataUrl = null;
        state.adjustments = { brightness: 100, contrast: 100, saturation: 100 };
        state.faceData = null;
        state.complianceResult = null;
        state.isOneClickMode = false;
        state.selectedPresetIndex = "";
        if (cropper) { cropper.destroy(); cropper = null; }
        if (wheelHandler) {
            dom.image.removeEventListener("wheel", wheelHandler);
            wheelHandler = null;
        }

        dom.dropZonePrompt.classList.remove("hidden");
        dom.uploadPreview.classList.add("hidden");
        dom.oneClickPanel.classList.add("hidden");
        dom.compliancePanel.classList.add("hidden");
        dom.step1Next.disabled = true;
        dom.imageInput.value = "";
        dom.quickPresetSelect.value = "";
        dom.oneClickButton.disabled = true;

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
populateQuickPresets();
attachEventListeners();
updateProgressIndicator();
checkBackend();

// Show "Remove background" opt-out checkbox on mobile only
if (isMobile && dom.skipBgOption) {
    dom.skipBgOption.classList.remove("hidden");
}
