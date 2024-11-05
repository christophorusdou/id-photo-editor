import {
    AutoModel,
    AutoProcessor,
    env,
    RawImage,
} from "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";
import { initializeCropper } from "./app.js";
import { getImageSelected, setModelDownloaded } from "./state.js";
// Set up environment to prevent local model checks and use WASM proxy
env.allowLocalModels = false;
env.backends.onnx.wasm.proxy = true;

// DOM Elements
const imageInput = document.getElementById("imageInput");
const image = document.getElementById("image");
const removeBgButton = document.getElementById("remove-bg-button");
const status = document.getElementById("status");
const spinner = document.getElementById("spinner");

// Disable button initially
removeBgButton.disabled = true;
status.textContent = "Loading model...";

// Load model and processor with progress feedback
async function loadModel() {
    status.textContent = "Downloading model...";

    // Fetch and initialize model
    const model = await AutoModel.from_pretrained("briaai/RMBG-1.4", {
        config: { model_type: "custom" },
        onProgress: (progress) => {
            status.textContent = `Model download: ${Math.round(
                progress * 100
            )}%`;
        },
    });

    // Fetch and initialize processor
    const processor = await AutoProcessor.from_pretrained("briaai/RMBG-1.4", {
        config: {
            do_normalize: true,
            do_pad: false,
            do_rescale: true,
            do_resize: true,
            image_mean: [0.5, 0.5, 0.5],
            feature_extractor_type: "ImageFeatureExtractor",
            image_std: [1, 1, 1],
            resample: 2,
            rescale_factor: 0.00392156862745098,
            size: { width: 1024, height: 1024 },
        },
        onProgress: (progress) => {
            status.textContent = `Processor download: ${Math.round(
                progress * 100
            )}%`;
        },
    });

    // Enable button and update status once fully loaded
    setModelDownloaded(true);
    if (getImageSelected()) {
        removeBgButton.disabled = false;
    }
    spinner.hidden = true;
    status.textContent = "Model ready!";
    return { model, processor };
}

// Initialize model and processor
const { model, processor } = await loadModel();

// Function to handle background removal
async function removeBackground(imageSrc) {
    const tfImage = await RawImage.fromURL(imageSrc);
    const { pixel_values } = await processor(tfImage);
    const { output } = await model({ input: pixel_values });

    // Apply mask to original image
    const mask = await RawImage.fromTensor(
        output[0].mul(255).to("uint8")
    ).resize(tfImage.width, tfImage.height);
    const canvas = document.createElement("canvas");
    canvas.width = tfImage.width;
    canvas.height = tfImage.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(tfImage.toCanvas(), 0, 0);

    const pixelData = ctx.getImageData(0, 0, tfImage.width, tfImage.height);
    for (let i = 0; i < mask.data.length; ++i) {
        pixelData.data[4 * i + 3] = mask.data[i];
    }
    ctx.putImageData(pixelData, 0, 0);

    image.src = canvas.toDataURL(); // Replace original with processed image
}

// Add event listener for image upload
imageInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = () => {
        image.src = reader.result;
        image.style.display = "block";
        removeBgButton.disabled = false;
    };
    reader.readAsDataURL(file);
});

// Remove background on button click
removeBgButton.addEventListener("click", async () => {
    ToggleStatus(false);
    status.textContent = "Removing background...";
    await removeBackground(image.src);
    ToggleStatus(true);
    status.textContent = "Background removed!";
    initializeCropper();
});
function ToggleStatus(on) {
    spinner.hidden = on;
    removeBgButton.disabled = !on;
}
