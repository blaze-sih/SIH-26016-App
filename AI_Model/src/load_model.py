import torch
from transformers import Qwen2_5_VLForConditionalGeneration, AutoProcessor, BitsAndBytesConfig

model_id = "Qwen/Qwen2.5-VL-7B-Instruct"

# 4-bit NF4 Quantization (keeps VRAM around ~6-7 GB on your 15GB T4 GPU)
compute_dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16

bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=compute_dtype,
    bnb_4bit_use_double_quant=True
)

# Resolution bounds to prevent VRAM spikes
processor = AutoProcessor.from_pretrained(
    model_id,
    min_pixels=256 * 28 * 28,
    max_pixels=1280 * 28 * 28
)

print("⏳ Downloading and loading Qwen2.5-VL-7B in 4-bit (takes ~2 minutes)...")
model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
    model_id,
    device_map="auto",
    torch_dtype=compute_dtype,
    quantization_config=bnb_config
)

print("✅ Qwen2.5-VL-7B loaded successfully into Colab GPU!")