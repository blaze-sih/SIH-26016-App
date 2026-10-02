"""
AI Document Extraction API Routes
Team BLAZE | SIH26016

Loads the Qwen2.5-VL-7B-Instruct model and exposes a /process-document
endpoint that reads land document images and extracts structured data.

Works in two modes:
  - GPU mode (Colab/server): Loads the real model, does actual inference
  - CPU/fallback mode (local laptop): Returns simulated data for testing
"""

import json
import traceback

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

# ── Model Loading (runs once at startup) ───────────────────────────────────────

_model = None
_processor = None
_device = None

def _load_model():
    """Load Qwen2.5-VL model with 4-bit quantization. Safe to call multiple times."""
    global _model, _processor, _device

    if _model is not None:
        return  # already loaded

    try:
        import torch
        if not torch.cuda.is_available():
            print("⚠️  No GPU detected — running in SIMULATION mode (no real model)")
            return

        from transformers import Qwen2_5_VLForConditionalGeneration, AutoProcessor, BitsAndBytesConfig

        model_id = "Qwen/Qwen2.5-VL-7B-Instruct"
        compute_dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16

        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=compute_dtype,
            bnb_4bit_use_double_quant=True,
        )

        print(f"⏳ Loading {model_id} in 4-bit (takes ~2 minutes on first run)...")

        _processor = AutoProcessor.from_pretrained(
            model_id,
            min_pixels=256 * 28 * 28,
            max_pixels=1280 * 28 * 28,
        )

        _model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
            model_id,
            device_map="auto",
            torch_dtype=compute_dtype,
            quantization_config=bnb_config,
        )

        _device = "cuda"
        print("✅ Model loaded successfully!")

    except Exception as e:
        print(f"⚠️  Model loading failed: {e}")
        print("   Running in SIMULATION mode instead.")
        _model = None


# Load model when server starts
_load_model()


# ── Request / Response Models ──────────────────────────────────────────────────

class ProcessDocumentRequest(BaseModel):
    documentId: str
    documentType: str
    imageBase64: str
    mimeType: str = "image/jpeg"
    language: str = "mr"
    schemaVersion: str = "v1"


# ── Extraction Prompt ─────────────────────────────────────────────────────────

EXTRACTION_PROMPT = """You are an expert land document reader for Indian government records.
Analyze this land document image carefully and extract the following fields.
Return your answer as ONLY a valid JSON object, with no extra text before or after.

Required JSON structure:
{
  "owners": [{"name": "owner full name", "share": "share fraction or null"}],
  "survey_number": "the survey/plot number",
  "village": "village name",
  "village_code": "numeric village code or null",
  "taluka": "taluka name",
  "district": "district name",
  "area": {
    "unit": "Hectare or Acre or Guntha",
    "total": "total area as string",
    "cultivable": "cultivable area as string",
    "uncultivable": "uncultivable area as string"
  },
  "encumbrances": "any mortgages/liens mentioned or null",
  "mutation_entries": "any mutation numbers or null",
  "crop_type": "current crop if mentioned or null"
}

Important rules:
- Extract values exactly as written in the document (keep Marathi/Devanagari text as-is)
- If a field is not visible in the document, set it to null
- For owners, include ALL owners listed in the document
- Return ONLY the JSON, no explanations
"""





# ── Real Model Inference ───────────────────────────────────────────────────────

def _run_real_inference(image_b64: str, mime_type: str, language: str) -> dict:
    """Run inference using the loaded Qwen2.5-VL model."""
    import torch
    from qwen_vl_utils import process_vision_info

    # Build the chat message with image
    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "image": f"data:{mime_type};base64,{image_b64}",
                },
                {
                    "type": "text",
                    "text": EXTRACTION_PROMPT,
                },
            ],
        }
    ]

    # Process with the model
    text = _processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    image_inputs, video_inputs = process_vision_info(messages)

    inputs = _processor(
        text=[text],
        images=image_inputs,
        videos=video_inputs,
        padding=True,
        return_tensors="pt",
    ).to(_device)

    with torch.no_grad():
        generated_ids = _model.generate(
            **inputs,
            max_new_tokens=1024,
            temperature=0.1,       # low temperature = more deterministic
            do_sample=False,
        )

    # Decode only the generated part (skip the input tokens)
    generated_ids_trimmed = [
        out_ids[len(in_ids):]
        for in_ids, out_ids in zip(inputs.input_ids, generated_ids)
    ]

    output_text = _processor.batch_decode(
        generated_ids_trimmed,
        skip_special_tokens=True,
        clean_up_tokenization_spaces=False,
    )[0]

    # Parse JSON from model output
    # The model sometimes wraps JSON in ```json ... ```, so we strip that
    cleaned = output_text.strip()
    if cleaned.startswith("```"):
        # Remove markdown code fences
        lines = cleaned.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        cleaned = "\n".join(lines)

    try:
        extracted = json.loads(cleaned)
    except json.JSONDecodeError:
        # If JSON parsing fails, return the raw text as an error
        return {
            "owners": [],
            "area": {"unit": "Unknown", "total": "0", "cultivable": "0", "uncultivable": "0"},
            "_raw_model_output": output_text,
            "_parse_error": "Model output was not valid JSON",
        }

    return extracted


# ── Simulation Fallback ───────────────────────────────────────────────────────

def _run_simulated_inference(document_type: str) -> dict:
    """Return realistic simulated data when no GPU/model is available."""
    return {
        "owners": [
            {"name": "रमेश पाटील", "share": "1/2"},
            {"name": "सुरेश पाटील", "share": "1/2"},
        ],
        "survey_number": "142/3",
        "village": "सिन्नर",
        "village_code": "546321",
        "taluka": "सिन्नर",
        "district": "नाशिक",
        "area": {
            "unit": "Hectare",
            "total": "१.५",
            "cultivable": "१.०",
            "uncultivable": "०.५",
        },
        "encumbrances": None,
        "mutation_entries": "क्र. ४५६७",
        "crop_type": "ऊस",
    }


# ── Main Endpoint ─────────────────────────────────────────────────────────────

@router.post("/process-document")
async def process_document(request: ProcessDocumentRequest):
    """
    Process a land document image and extract structured data.

    If a GPU and model are available → real AI inference.
    If not → returns simulated data (for testing without a GPU).
    """
    try:
        is_real_model = _model is not None

        if is_real_model:
            extracted_data = _run_real_inference(request.imageBase64, request.mimeType, request.language)
            mode = "REAL_MODEL"
        else:
            extracted_data = _run_simulated_inference(request.documentType)
            mode = "SIMULATION"

        # Ensure required fields exist (even if model missed them)
        if "owners" not in extracted_data:
            extracted_data["owners"] = []
        if "area" not in extracted_data:
            extracted_data["area"] = {"unit": "Unknown", "total": "0", "cultivable": "0", "uncultivable": "0"}

        response = {
            "model": "Qwen2.5-VL-7B-Instruct",
            "mode": mode,
            "schemaVersion": request.schemaVersion,
            "extractedData": extracted_data,
        }

        return response

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"AI processing error: {str(e)}")
