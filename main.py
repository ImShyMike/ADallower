"""Serve random images"""

import os
import random

from flask import Flask, Response

app = Flask(__name__)
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0

images = [
    img
    for img in os.listdir("static")
    if img.endswith((".png", ".jpg", ".jpeg", ".gif"))
]


@app.route("/")
def home():
    """woah"""
    return "it's working :schoking:"


@app.route("/random/<path:dummy>")
def random_image(dummy: str):
    """Redirect to a random image"""
    print("Serving random image for:", dummy)
    img = random.choice(images)
    return app.send_static_file(img)


@app.route("/count")
def count_images():
    """Return the count of available images"""
    return str(len(images))


@app.route("/image/<int:num>")
def serve_image(num: int):
    """Serve image by index"""
    if 0 <= num < len(images):
        img = images[num]
        return app.send_static_file(img)
    return {"error": "Image not found"}, 404


@app.after_request
def disable_static_cache(response: Response):
    """Disable caching for static files"""
    if response.direct_passthrough:
        response.headers["Cache-Control"] = (
            "no-store, no-cache, must-revalidate, max-age=0"
        )
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5069)
