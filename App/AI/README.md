# Secure Land Acquisition Document Extraction

## Objective
To train or fine-tune an AI model capable of intelligently reading complex Marathi land documents (like 7-12 extracts / सातबारा उतारा), understanding dense multi-column tabular layouts, seals, and handwriting, and extracting relevant entities into a verified, structured JSON format.

## Model & Training Architecture


- **Base Model**: `Qwen/Qwen2.5-VL-3B-Instruct` (or `Qwen/Qwen2-VL-2B-Instruct`)

- **Quantization**: **4-bit NF4 Quantization** via `bitsandbytes` (`load_in_4bit=True`, `bnb_4bit_compute_dtype=torch.bfloat16`, `bnb_4bit_use_double_quant=True`).
  - Reduces model weight footprint to ~2.2 - 2.8 GB VRAM.
- **Fine-Tuning Technique**: **QLoRA (Quantized Low-Rank Adaptation)** via Hugging Face `peft`.
  - Freezes base vision/language weights, attaching lightweight trainable LoRA adapters (`r=16`, `lora_alpha=32`, targeting projection layers).
  - Trainable parameters are < 1% of total model size.


## Security & Privacy Constraints
- **Zero Data Leakage**: Sensitive land records must **never** be sent to third-party APIs (e.g., OpenAI, Google Cloud). All AI training and inference occur locally or on controlled private infrastructure.

## DATA set used in First stage
https://huggingface.co/datasets/Process-Venue/Marathi_Handwritten

## Repository Structure
- `notebooks/`: Jupyter notebooks ready to run on Colab / Kaggle free GPUs (e.g. `01_qwen_vl_qlora_guide.ipynb`).
- `src/`: Modular Python scripts for preprocessing, dataset preparation, model loading, training, and structured inference.
- `data/`:
  - `raw/`: Scanned Marathi document samples (7-12 samples first).
  - `processed/`: Processed image-text pairs and ground-truth JSON annotations.
- `models/`: Saved LoRA adapter weights and export configurations.
