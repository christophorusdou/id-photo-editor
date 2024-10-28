from flask import Flask, render_template, request, jsonify, send_file
from transformers import pipeline
from PIL import Image
import io
import requests

app = Flask(__name__)

# Load the model pipeline
pipe = pipeline("image-segmentation", model="briaai/RMBG-1.4", trust_remote_code=True, device=0)

# @app.route('/remove_background', methods=['POST'])
# def remove_background():
#     if 'image' not in request.files:
#         return jsonify({"error": "No image provided"}), 400

#     # Load the image
#     file = request.files['image']
#     image = Image.open(file)

#     # Perform background removal
#     result_image = pipe(image)

#     # Save result to an in-memory file
#     img_io = io.BytesIO()
#     result_image.save(img_io, 'PNG')
#     img_io.seek(0)

#     return send_file(img_io, mimetype='image/png')


@app.route('/remove_background', methods=['POST'])
def remove_background():
    if 'image' not in request.files:
        return jsonify({"error": "No image provided"}), 400

    # Load and process the image
    file = request.files['image']
    image = Image.open(file)

    # Perform background removal
    result_image = pipe(image)

    # Convert to RGB and add a white background
    result_image = result_image.convert("RGBA")
    white_bg = Image.new("RGBA", result_image.size, (255, 255, 255, 255))
    result_image = Image.alpha_composite(white_bg, result_image).convert("RGB")

    # Save to in-memory file
    img_io = io.BytesIO()
    result_image.save(img_io, 'PNG')
    img_io.seek(0)

    return send_file(img_io, mimetype='image/png')

@app.route('/')
def index():
  return render_template('index.html')  # Serves index.html from the templates folder


if __name__ == '__main__':
    app.run(debug=True)