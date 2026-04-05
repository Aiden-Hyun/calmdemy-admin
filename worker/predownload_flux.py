"""
Pre-download the configured image generation model so it's cached locally
before any content factory job needs it.

Usage:
  cd apps/calmdemy/worker
  python3 predownload_flux.py
"""

import os
import sys

# Disable HuggingFace xet transfer (crashes on macOS with NULL object panic)
os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "0"

# Load .env BEFORE importing config so MODEL_DIR is set
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
except ImportError:
    pass

import config
from factory_v2.shared.image_generator import (
    _load_pretrained_pipeline,
    _model_cache_dir,
    _pipeline_pretrained_kwargs,
    _resolve_pipeline_class,
)

def main():
    model_id = config.IMAGE_MODEL_ID
    cache_dir = _model_cache_dir(model_id)
    os.makedirs(cache_dir, exist_ok=True)

    print(f"Model:     {model_id}")
    print(f"Cache dir: {cache_dir}")
    print(f"HF Token:  {'set' if config.HF_TOKEN else 'NOT SET'}")
    print()
    print("Downloading model (this may take 10-30 minutes)...")
    print()

    PipelineClass = _resolve_pipeline_class(model_id)

    kwargs = _pipeline_pretrained_kwargs(model_id, dtype=None)
    kwargs["cache_dir"] = cache_dir
    _load_pretrained_pipeline(PipelineClass, model_id, kwargs)

    print()
    print("Download complete! The model is now cached and ready to use.")
    print(f"Location: {cache_dir}")


if __name__ == "__main__":
    main()
