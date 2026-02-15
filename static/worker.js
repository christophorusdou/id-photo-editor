import {
    AutoModel,
    AutoProcessor,
    env,
    RawImage,
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.1.2";

env.allowLocalModels = false;

const MODEL_ID = "briaai/RMBG-1.4";

let model = null;
let processor = null;
let currentProcessorSize = 1024;

function makeProcessorConfig(size) {
    return {
        do_normalize: true,
        do_pad: false,
        do_rescale: true,
        do_resize: true,
        image_mean: [0.5, 0.5, 0.5],
        image_std: [1, 1, 1],
        resample: 2,
        rescale_factor: 0.00392156862745098,
        size: { width: size, height: size },
    };
}

let currentDtype = null;

async function loadModel(data) {
    const requestedSize = (data && data.processorSize) || 1024;
    const requestedDtype = (data && data.dtype) || "fp32";

    // If model and processor exist and size + dtype match, skip
    if (model && processor && currentProcessorSize === requestedSize && currentDtype === requestedDtype) {
        self.postMessage({ type: "model-ready" });
        return;
    }

    try {
        // Reload model if dtype changed or not loaded yet
        if (!model || currentDtype !== requestedDtype) {
            if (model && model.dispose) model.dispose();
            model = null;
            console.log(`[worker] loading model (dtype=${requestedDtype})...`);
            model = await AutoModel.from_pretrained(MODEL_ID, {
                dtype: requestedDtype,
                config: { model_type: "custom" },
                progress_callback: (p) => {
                    if (p.status === "progress" && p.total) {
                        self.postMessage({
                            type: "progress",
                            percent: Math.round((p.loaded / p.total) * 100),
                        });
                    }
                },
            });
            currentDtype = requestedDtype;
        }

        // Create/recreate processor at requested size (cheap)
        console.log("[worker] processor size:", requestedSize);
        processor = await AutoProcessor.from_pretrained(MODEL_ID, {
            config: makeProcessorConfig(requestedSize),
        });
        currentProcessorSize = requestedSize;

        self.postMessage({ type: "model-ready" });
    } catch (err) {
        model = null;
        processor = null;
        throw err;
    }
}

async function runInference(data) {
    if (!model || !processor) {
        await loadModel();
    }

    let rawImage;
    if (data.imageData) {
        // Mobile path: raw pixels transferred from main thread (zero-copy)
        const pixels = new Uint8ClampedArray(data.imageData);
        rawImage = new RawImage(pixels, data.width, data.height, 4);
        console.log(`[worker] mobile path: ${data.width}x${data.height} (${(pixels.byteLength / 1024 / 1024).toFixed(1)}MB)`);
    } else {
        // Desktop path: decode data URL
        rawImage = await RawImage.fromURL(data.imageDataUrl);
        console.log(`[worker] desktop path: ${rawImage.width}x${rawImage.height}`);
    }

    console.log(`[worker] running processor (${currentProcessorSize}x${currentProcessorSize})...`);
    const { pixel_values } = await processor(rawImage);
    console.log("[worker] running model inference...");
    const { output } = await model({ input: pixel_values });
    pixel_values.dispose?.();  // Free processor output tensor (~3MB)

    console.log("[worker] resizing mask...");
    const maskData = output[0].mul(255).to("uint8");
    output.dispose?.();  // Free model output tensor (~1MB)
    const mask = await RawImage.fromTensor(maskData).resize(
        rawImage.width,
        rawImage.height,
    );
    maskData.dispose?.();  // Free intermediate mask tensor
    console.log("[worker] inference complete");

    self.postMessage({
        type: "result",
        maskData: mask.data,
        width: rawImage.width,
        height: rawImage.height,
    });
}

self.addEventListener("message", async (e) => {
    const { type } = e.data;
    try {
        if (type === "load-model") {
            await loadModel(e.data);
        } else if (type === "inference") {
            await runInference(e.data);
        }
    } catch (err) {
        self.postMessage({ type: "error", message: err.message });
    }
});
