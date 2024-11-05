// Use an object to hold the state
export const state = {
    imageSelected: false,
    modelDownloaded: false,
};

export function setImageSelected(value) {
    state.imageSelected = value;
}

export function getImageSelected() {
    return state.imageSelected;
}

export function setModelDownloaded(value) {
    state.modelDownloaded = value;
}

export function getModelDownloaded() {
    return state.modelDownloaded;
}
