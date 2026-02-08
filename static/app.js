import {
    AutoModel,
    AutoProcessor,
    env,
    RawImage,
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";

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
    MODEL_ID: "briaai/RMBG-1.4",
    BACKEND_URL: "/remove_background",
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let cropper = null;
let isMovingCropWindow = false;
let isCropBoxMode = true;
let model = null;
let processor = null;
let modelLoading = false;

// ---------------------------------------------------------------------------
// DOM Elements
// ---------------------------------------------------------------------------
const imageInput = document.getElementById("imageInput");
const image = document.getElementById("image");
const removeBgButton = document.getElementById("remove-bg-button");
const cropButton = document.getElementById("crop-button");
const widthInput = document.getElementById("width");
const heightInput = document.getElementById("height");
const unitSelect = document.getElementById("unit");
const zoomInButton = document.getElementById("zoom-in");
const zoomOutButton = document.getElementById("zoom-out");
const toggleModeButton = document.getElementById("toggle-mode");
const toggleCursorButton = document.getElementById("toggle-cursor");
const generate4x6Button = document.getElementById("generate-4x6-button");
const statusBar = document.getElementById("status-bar");
const statusText = document.getElementById("status-text");
const progressContainer = document.getElementById("progress-container");
const progressBar = document.getElementById("progress-bar");
const backendStatus = document.getElementById("backend-status");

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
    statusBar.className = "status-bar " + type;
    statusText.textContent = message;
    statusBar.classList.remove("hidden");
}

function hideStatus() {
    statusBar.classList.add("hidden");
    progressContainer.classList.add("hidden");
}

function showProgress(percent) {
    progressContainer.classList.remove("hidden");
    progressBar.style.width = percent + "%";
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
        // A 400 (missing image) means the server is alive
        if (response.status === 400 || response.ok) {
            backendStatus.textContent = "(available)";
            backendStatus.className = "backend-available";
            return true;
        }
        throw new Error("unexpected status");
    } catch {
        backendStatus.textContent = "(unavailable)";
        backendStatus.className = "backend-unavailable";
        return false;
    }
}

// ---------------------------------------------------------------------------
// In-browser model loading
// ---------------------------------------------------------------------------
async function loadBrowserModel() {
    if (model && processor) return;
    if (modelLoading) return;
    modelLoading = true;

    env.allowLocalModels = false;
    env.backends.onnx.wasm.proxy = true;

    showStatus("Loading background removal model...", "info");
    showProgress(0);

    try {
        model = await AutoModel.from_pretrained(CONFIG.MODEL_ID, {
            config: { model_type: "custom" },
            progress_callback: (p) => {
                if (p.status === "progress" && p.total) {
                    showProgress(Math.round((p.loaded / p.total) * 100));
                }
            },
        });

        processor = await AutoProcessor.from_pretrained(CONFIG.MODEL_ID, {
            config: {
                do_normalize: true,
                do_pad: false,
                do_rescale: true,
                do_resize: true,
                image_mean: [0.5, 0.5, 0.5],
                image_std: [1, 1, 1],
                resample: 2,
                rescale_factor: 0.00392156862745098,
                size: { width: 1024, height: 1024 },
            },
        });

        showStatus("Model loaded.", "success");
        setTimeout(hideStatus, 2000);
    } catch (err) {
        showStatus("Failed to load model: " + err.message, "error");
        model = null;
        processor = null;
        throw err;
    } finally {
        modelLoading = false;
    }
}

// ---------------------------------------------------------------------------
// Background removal — browser
// ---------------------------------------------------------------------------
async function removeBackgroundBrowser(imgElement) {
    await loadBrowserModel();

    showStatus("Removing background...", "info");

    const rawImage = await RawImage.fromURL(imgElement.src);
    const { pixel_values } = await processor(rawImage);
    const { output } = await model({ input: pixel_values });

    // Build alpha mask
    const maskData = output[0].mul(255).to("uint8");
    const mask = await RawImage.fromTensor(maskData).resize(
        rawImage.width,
        rawImage.height,
    );

    // Composite onto white background via canvas
    const canvas = document.createElement("canvas");
    canvas.width = rawImage.width;
    canvas.height = rawImage.height;
    const ctx = canvas.getContext("2d");

    // Draw white background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw original image with mask as alpha
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = rawImage.width;
    tempCanvas.height = rawImage.height;
    const tempCtx = tempCanvas.getContext("2d");

    // Draw original image
    const origImg = new Image();
    origImg.crossOrigin = "anonymous";
    await new Promise((resolve, reject) => {
        origImg.onload = resolve;
        origImg.onerror = reject;
        origImg.src = imgElement.src;
    });
    tempCtx.drawImage(origImg, 0, 0);

    // Apply mask to alpha channel
    const imageData = tempCtx.getImageData(0, 0, canvas.width, canvas.height);
    const maskPixels = mask.data;
    for (let i = 0; i < maskPixels.length; i++) {
        imageData.data[i * 4 + 3] = maskPixels[i]; // Set alpha from mask
    }
    tempCtx.putImageData(imageData, 0, 0);

    // Composite masked image onto white background
    ctx.drawImage(tempCanvas, 0, 0);

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
    return URL.createObjectURL(blob);
}

// ---------------------------------------------------------------------------
// Cropper
// ---------------------------------------------------------------------------
function initializeCropper() {
    if (cropper) cropper.destroy();

    const widthValue = parseFloat(widthInput.value);
    const heightValue = parseFloat(heightInput.value);

    if (!widthValue || !heightValue || widthValue <= 0 || heightValue <= 0) {
        return;
    }

    cropper = new Cropper(image, {
        aspectRatio: widthValue / heightValue,
        dragMode: "crop",
    });

    cropButton.disabled = false;
    zoomInButton.disabled = false;
    zoomOutButton.disabled = false;
    toggleModeButton.disabled = false;
    toggleCursorButton.disabled = false;
    generate4x6Button.disabled = false;

    // Adaptive zoom handling
    image.addEventListener("wheel", (event) => {
        event.preventDefault();
        const speedFactor = Math.abs(event.deltaY) / 100;
        const zoomFactor = Math.min(CONFIG.BASE_ZOOM * speedFactor, CONFIG.MAX_ZOOM);
        const delta = event.deltaY > 0 ? -zoomFactor : zoomFactor;
        cropper.zoom(delta);
    });
}

// ---------------------------------------------------------------------------
// Event Listeners
// ---------------------------------------------------------------------------

// Image upload
imageInput.addEventListener("change", () => {
    const file = imageInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        image.src = reader.result;
        image.style.display = "block";
        removeBgButton.disabled = false;
    };
    reader.readAsDataURL(file);
});

// Remove background
removeBgButton.addEventListener("click", async () => {
    removeBgButton.disabled = true;
    try {
        const mode = getInferenceMode();
        let resultUrl;

        if (mode === "backend") {
            const available = await checkBackend();
            if (!available) {
                showStatus(
                    "Backend server is not available. Start the server with 'python app.py' or switch to Browser mode.",
                    "error",
                );
                removeBgButton.disabled = false;
                return;
            }
            resultUrl = await removeBackgroundBackend(imageInput.files[0]);
        } else {
            resultUrl = await removeBackgroundBrowser(image);
        }

        image.src = resultUrl;
        showStatus("Background removed successfully.", "success");
        setTimeout(hideStatus, 3000);
        initializeCropper();
    } catch (err) {
        showStatus("Background removal failed: " + err.message, "error");
    } finally {
        removeBgButton.disabled = false;
    }
});

// Dimension inputs reinitialize cropper
widthInput.addEventListener("input", initializeCropper);
heightInput.addEventListener("input", initializeCropper);
unitSelect.addEventListener("change", initializeCropper);

// Zoom
zoomInButton.addEventListener("click", () => {
    if (cropper) cropper.zoom(0.1);
});
zoomOutButton.addEventListener("click", () => {
    if (cropper) cropper.zoom(-0.1);
});

// Toggle between moving image or crop window (keyboard arrows)
toggleModeButton.addEventListener("click", () => {
    isMovingCropWindow = !isMovingCropWindow;
    toggleModeButton.textContent = isMovingCropWindow
        ? "Move Image"
        : "Move Crop Window";
});

// Toggle cursor drag mode
toggleCursorButton.addEventListener("click", () => {
    isCropBoxMode = !isCropBoxMode;
    cropper.setDragMode(isCropBoxMode ? "crop" : "move");
    toggleCursorButton.textContent = isCropBoxMode
        ? "Toggle Cursor (Move Crop Box)"
        : "Toggle Cursor (Move Image)";
});

// Keyboard navigation
document.addEventListener("keydown", (event) => {
    if (!cropper) return;
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

// Crop & Save
cropButton.addEventListener("click", () => {
    const width = convertToPixels(parseFloat(widthInput.value), unitSelect.value);
    const height = convertToPixels(parseFloat(heightInput.value), unitSelect.value);
    const croppedCanvas = cropper.getCroppedCanvas({ width, height });

    croppedCanvas.toBlob((blob) => {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "photo_id.png";
        link.click();
    }, "image/png");
});

// Generate 4x6 Layout
generate4x6Button.addEventListener("click", () => {
    if (!cropper) return;

    const idWidth = convertToPixels(parseFloat(widthInput.value), unitSelect.value);
    const idHeight = convertToPixels(parseFloat(heightInput.value), unitSelect.value);

    const columns = Math.floor(CONFIG.CANVAS_4X6_WIDTH / idWidth);
    const rows = Math.floor(CONFIG.CANVAS_4X6_HEIGHT / idHeight);

    const canvas = document.createElement("canvas");
    canvas.width = CONFIG.CANVAS_4X6_WIDTH;
    canvas.height = CONFIG.CANVAS_4X6_HEIGHT;
    const context = canvas.getContext("2d");

    // White background for the 4x6 sheet
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

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
checkBackend();
