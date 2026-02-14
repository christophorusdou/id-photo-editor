import {
    AutoModel,
    AutoProcessor,
    env,
    RawImage,
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.1.2";

env.allowLocalModels = false;

const MODEL_ID = "onnx-community/BiRefNet_lite";

let model = null;
let processor = null;

async function loadModel(data) {
    if (model && processor) {
        self.postMessage({ type: "model-ready" });
        return;
    }

    try {
        model = await AutoModel.from_pretrained(MODEL_ID, {
            dtype: "fp32",
            progress_callback: (p) => {
                if (p.status === "progress" && p.total) {
                    self.postMessage({
                        type: "progress",
                        percent: Math.round((p.loaded / p.total) * 100),
                    });
                }
            },
        });

        processor = await AutoProcessor.from_pretrained(MODEL_ID);

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
    const { output_image } = await model({ input_image: pixel_values });

    const maskData = output_image[0].sigmoid().mul(255).to("uint8");
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
