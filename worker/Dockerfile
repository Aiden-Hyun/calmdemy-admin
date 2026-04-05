FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python dependencies
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy worker code
COPY . .

# Model weights are mounted at /models via the persistent disk
ENV MODEL_DIR=/models
ENV GOOGLE_CLOUD_PROJECT=calmnest-e910e

CMD ["python3", "main.py"]
