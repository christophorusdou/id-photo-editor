import { getModelDownloaded, setImageSelected } from "./state.js";
let cropper;
let isMovingCropWindow = false;
let isCropBoxMode = true;

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
const DPI = 300; // Define DPI for conversion

function convertToPixels(value, unit) {
    return unit === "inches" ? value * DPI : (value * DPI) / 2.54;
}

// function initializeCropper() {
//     if (cropper) cropper.destroy(); // Remove existing cropper instance
//     const widthValue = parseFloat(widthInput.value);
//     const heightValue = parseFloat(heightInput.value);
//     if (
//         !isNaN(widthValue) &&
//         !isNaN(heightValue) &&
//         widthValue > 0 &&
//         heightValue > 0
//     ) {
//         cropper = new Cropper(image, {
//             aspectRatio: widthValue / heightValue,
//             dragMode: "crop", // Start with crop mode to move the crop box
//             zoomOnWheel: false, // Disable default zoom on wheel
//         });
//         cropButton.disabled = false;
//         zoomInButton.disabled = false;
//         zoomOutButton.disabled = false;
//         toggleModeButton.disabled = false;
//         toggleCursorButton.disabled = false;

//         // Custom zoom handling for smoother experience
//         image.addEventListener("wheel", (event) => {
//             event.preventDefault(); // Prevent the default scroll behavior
//             const zoomFactor = 0.02; // Adjust this value for smoothness
//             const delta =
//                 event.deltaY > 0 ? -zoomFactor : zoomFactor;
//             cropper.zoom(delta);
//         });
//     }
// }

export function initializeCropper() {
    if (cropper) cropper.destroy(); // Remove existing cropper instance
    const widthValue = parseFloat(widthInput.value);
    const heightValue = parseFloat(heightInput.value);
    if (
        !isNaN(widthValue) &&
        !isNaN(heightValue) &&
        widthValue > 0 &&
        heightValue > 0
    ) {
        cropper = new Cropper(image, {
            aspectRatio: widthValue / heightValue,
            dragMode: "crop", // Start with crop mode to move the crop box
        });
        cropButton.disabled = false;
        zoomInButton.disabled = false;
        zoomOutButton.disabled = false;
        toggleModeButton.disabled = false;
        toggleCursorButton.disabled = false;
        generate4x6Button.disabled = false;
    }

    // Adaptive zoom handling
    image.addEventListener("wheel", (event) => {
        event.preventDefault(); // Prevent default scroll behavior

        // Adjust zoomFactor based on scroll speed (deltaY)
        let baseZoomFactor = 0.02; // Base zoom for slow scrolls
        let speedFactor = Math.abs(event.deltaY) / 100; // Increase factor based on scroll speed
        let zoomFactor = Math.min(baseZoomFactor * speedFactor, 0.1); // Limit zoom factor for control

        // Zoom in or out based on scroll direction
        const delta = event.deltaY > 0 ? -zoomFactor : zoomFactor;
        cropper.zoom(delta);
    });
}

imageInput.addEventListener("change", () => {
    const file = imageInput.files[0];
    const reader = new FileReader();
    reader.onload = () => {
        image.src = reader.result;
        image.style.display = "block";
        setImageSelected(true);
        if (getModelDownloaded()) {
            removeBgButton.disabled = false;
        }
    };
    reader.readAsDataURL(file);
});

// removeBgButton.addEventListener("click", async () => {
//     const formData = new FormData();
//     formData.append("image", imageInput.files[0]);

//     const response = await fetch("/remove_background", {
//         method: "POST",
//         body: formData,
//     });
//     const blob = await response.blob();
//     const url = URL.createObjectURL(blob);

//     image.src = url;
//     initializeCropper();
// });

// Reinitialize cropper when width, height, or unit changes
widthInput.addEventListener("input", initializeCropper);
heightInput.addEventListener("input", initializeCropper);
unitSelect.addEventListener("change", initializeCropper);

// Zoom functionality
zoomInButton.addEventListener("click", () => {
    if (cropper) cropper.zoom(0.1); // Zoom in by 10%
});

zoomOutButton.addEventListener("click", () => {
    if (cropper) cropper.zoom(-0.1); // Zoom out by 10%
});

// Toggle between moving image or crop window
toggleModeButton.addEventListener("click", () => {
    isMovingCropWindow = !isMovingCropWindow;
    toggleModeButton.textContent = isMovingCropWindow
        ? "Move Image"
        : "Move Crop Window";
});

// Toggle cursor between moving crop box and moving image
toggleCursorButton.addEventListener("click", () => {
    isCropBoxMode = !isCropBoxMode;
    cropper.setDragMode(isCropBoxMode ? "crop" : "move");
    toggleCursorButton.textContent = isCropBoxMode
        ? "Toggle Cursor (Move Crop Box)"
        : "Toggle Cursor (Move Image)";
});

// Keyboard arrow keys for moving image or crop window
document.addEventListener("keydown", (event) => {
    const step = 10; // Movement step in pixels

    if (!cropper) return;

    if (isMovingCropWindow) {
        // Move crop window
        const data = cropper.getData(); // Get the current position of the crop box
        switch (event.key) {
            case "ArrowUp":
                data.y -= step;
                break;
            case "ArrowDown":
                data.y += step;
                break;
            case "ArrowLeft":
                data.x -= step;
                break;
            case "ArrowRight":
                data.x += step;
                break;
            default:
                return;
        }
        cropper.setData(data); // Set the new position of the crop box
    } else {
        // Move image
        switch (event.key) {
            case "ArrowUp":
                cropper.move(0, -step); // Move image up
                break;
            case "ArrowDown":
                cropper.move(0, step); // Move image down
                break;
            case "ArrowLeft":
                cropper.move(-step, 0); // Move image left
                break;
            case "ArrowRight":
                cropper.move(step, 0); // Move image right
                break;
            default:
                return;
        }
    }
});

cropButton.addEventListener("click", () => {
    const width = convertToPixels(
        parseFloat(widthInput.value),
        unitSelect.value
    );
    const height = convertToPixels(
        parseFloat(heightInput.value),
        unitSelect.value
    );
    const croppedCanvas = cropper.getCroppedCanvas({
        width,
        height,
    });

    croppedCanvas.toBlob((blob) => {
        const croppedUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = croppedUrl;
        link.download = "photo_id.png";
        link.click();
    }, "image/png");
});
document.getElementById("generate-4x6-button").addEventListener("click", () => {
    if (!cropper) return;

    // Dimensions in pixels for 4x6 inch at 300 DPI
    const canvasWidth = 1200; // 4 inches * 300 DPI
    const canvasHeight = 1800; // 6 inches * 300 DPI

    const idWidth = convertToPixels(
        parseFloat(widthInput.value),
        unitSelect.value
    );
    const idHeight = convertToPixels(
        parseFloat(heightInput.value),
        unitSelect.value
    );

    const columns = Math.floor(canvasWidth / idWidth);
    const rows = Math.floor(canvasHeight / idHeight);

    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const context = canvas.getContext("2d");

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
            const x = col * idWidth;
            const y = row * idHeight;
            context.drawImage(
                cropper.getCroppedCanvas({ width: idWidth, height: idHeight }),
                x,
                y,
                idWidth,
                idHeight
            );
        }
    }

    canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "photo_id_4x6.png";
        link.click();
    }, "image/png");
});
