"""
AI Model API Server
Team BLAZE | SIH26016

Starts the FastAPI server that serves the Qwen2.5-VL-7B document extraction model.

How to run:
  Local (no GPU, simulation mode):  python main.py
  Colab (with GPU, real model):     Just run the Colab notebook cells
"""

from fastapi import FastAPI, Depends, HTTPException, Security
from fastapi.security import APIKeyHeader
from fastapi.middleware.cors import CORSMiddleware
from api.routes import router as api_router
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(
    title="AI Model API",
    description="Land Document Extraction API powered by Qwen2.5-VL-7B-Instruct",
)

# ── CORS — Allow the backend server to call this API ──────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to your backend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API Key Security ──────────────────────────────────────────────────────────
API_KEY = os.getenv("AI_API_KEY", "default-secret-key")
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

def get_api_key(api_key_header: str = Security(api_key_header)):
    if api_key_header == API_KEY:
        return api_key_header
    raise HTTPException(status_code=403, detail="Could not validate API key")

# ── Mount Routes ──────────────────────────────────────────────────────────────
app.include_router(api_router, prefix="/api", dependencies=[Depends(get_api_key)])

@app.get("/")
def health_check():
    """Health check — returns whether the real model or simulation is active."""
    from api.routes import _model
    return {
        "status": "ok",
        "message": "AI Model API is running",
        "mode": "REAL_MODEL" if _model is not None else "SIMULATION",
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("AI_PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
