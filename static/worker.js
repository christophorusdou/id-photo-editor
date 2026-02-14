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

async function loadModel(data) {
    if (model && processor) {
        self.postMessage({ type: "model-ready" });
        return;
    }

    try {
        model = await AutoModel.from_pretrained(MODEL_ID, {
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

        processor = await AutoProcessor.from_pretrained(MODEL_ID, {
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

    const rawImage = await RawImage.fromURL(data.imageDataUrl);
    const { pixel_values } = await processor(rawImage);
    const { output } = await model({ input: pixel_values });

    const maskData = output[0].mul(255).to("uint8");
    const mask = await RawImage.fromTensor(maskData).resize(
        rawImage.width,
        rawImage.height,
    );

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
