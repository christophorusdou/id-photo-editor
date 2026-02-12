"""
Optional backend server for Photo ID Generator.

Provides GPU-accelerated background removal via briaai/RMBG-1.4.
The frontend works without this server (uses in-browser inference),
but this backend is faster when a GPU is available.

Usage:
    pip install -r requirements.txt
    python app.py
"""

import io
import os

from flask import Flask, send_file, request, jsonify
from flask_cors import CORS
from PIL import Image
from transformers import pipeline

app = Flask(__name__, static_folder="static", static_url_path="/static")
CORS(app)

MODEL_ID = os.environ.get("RMBG_MODEL", "briaai/RMBG-1.4")
DEVICE = int(os.environ.get("RMBG_DEVICE", "0"))

pipe = pipeline("image-segmentation", model=MODEL_ID, trust_remote_code=True, device=DEVICE)


@app.route("/")
def index():
    return send_file("index.html")


@app.route("/remove_background", methods=["POST"])
def remove_background():
    if "image" not in request.files:
        return jsonify({"error": "No image provided"}), 400

    file = request.files["image"]
    image = Image.open(file)

    result_image = pipe(image)

    result_image = result_image.convert("RGBA")
    white_bg = Image.new("RGBA", result_image.size, (255, 255, 255, 255))
    result_image = Image.alpha_composite(white_bg, result_image).convert("RGB")

    img_io = io.BytesIO()
    result_image.save(img_io, "PNG")
    img_io.seek(0)

    return send_file(img_io, mimetype="image/png")


if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    port = int(os.environ.get("PORT", "5000"))
    app.run(debug=debug, port=port)
