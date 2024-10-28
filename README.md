# Photo ID Generator

A simple web application that allows users to upload a photo, crop, and remove the background using briaai/RMBG-1.4.

## Features

-   Remove the background using briaai/RMBG-1.4.

## Installation

### Prerequisites

-   Python 3.x < 3.13
-   pip
-   Virtual environment (recommended)

### Setup

1. Clone the repository:

    ```bash
    git clone <repository-url>
    cd <repository-directory>
    ```

2. Create a virtual environment:

    ```bash
    python3 -m venv venv
    source venv/bin/activate  # On Windows: venv\Scripts\activate
    ```

3. Install the required packages:

    ```bash
    pip install Flask Pillow torchvision scikit-image transformers
    ```

4. Start the application:

    ```bash
    python app.py
    ```
