# AI Model Integration Guide

This guide explains how to connect the website (Frontend or Backend) directly to the Local AI Model API, without relying on any external APIs (like OpenAI or cloud providers).

## 🚀 Overview of the AI Server

The AI model runs as a standalone **FastAPI service** (typically on port `8000`). It is designed to process land document images and extract structured JSON data (Owners, Survey Number, Area, etc.).

### Modes of Operation
The API route (`/api/process-document`) automatically detects its environment:
1. **Real AI Inference (GPU):** If a GPU is detected, it loads the `Qwen2.5-VL-7B-Instruct` model and processes the image.
2. **Simulation Mode (CPU/Laptop):** If no GPU is available, it returns simulated, realistic JSON data. This allows you to test the website integration seamlessly without needing heavy hardware.

---

## 🔗 Endpoint Details

- **URL:** `http://localhost:8000/api/process-document`
- **Method:** `POST`
- **Headers Required:**
  - `Content-Type: application/json`
  - `X-API-Key: default-secret-key` (Must match the `AI_API_KEY` in the AI `.env` file)

### Request Payload (JSON)

The AI server accepts the image directly as a **Base64 string**, meaning you do not need to save the file to disk before processing.

```json
{
  "documentId": "doc-12345",
  "documentType": "7/12 Extract",
  "imageBase64": "iVBORw0KGgoAAAANSUhEUgAA...", // Raw base64 string without the 'data:image/jpeg;base64,' prefix
  "mimeType": "image/jpeg",
  "language": "mr",
  "schemaVersion": "v1"
}
```

### Success Response (JSON)

```json
{
  "model": "Qwen2.5-VL-7B-Instruct",
  "mode": "REAL_MODEL", // or "SIMULATION"
  "schemaVersion": "v1",
  "extractedData": {
    "owners": [
      {"name": "रमेश पाटील", "share": "1/2"}
    ],
    "survey_number": "142/3",
    "village": "सिन्नर",
    "district": "नाशिक",
    "area": {
      "unit": "Hectare",
      "total": "१.५",
      "cultivable": "१.०",
      "uncultivable": "०.५"
    }
  }
}
```

---

## 💻 How to Call from the Frontend (JavaScript/React)

To keep things as simple as possible, you can bypass the Node/Django backend entirely for extraction and call the AI server directly from the browser.

### Example Integration Code

```javascript
/**
 * Takes a File object from an HTML <input type="file"> and sends it to the local AI.
 */
async function extractDocumentData(file) {
    try {
        // 1. Convert the file to Base64 (in-memory)
        const base64Data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            // We strip the Data URL prefix (e.g., 'data:image/jpeg;base64,')
            reader.onload = () => resolve(reader.result.split(',')[1]); 
            reader.onerror = error => reject(error);
        });

        // 2. Make the POST request to the Local AI Server
        const response = await fetch("http://localhost:8000/api/process-document", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": "default-secret-key" // Secures the local API
            },
            body: JSON.stringify({
                documentId: "doc-" + Date.now(),
                documentType: file.type.includes("pdf") ? "PDF" : "Image",
                imageBase64: base64Data,        
                mimeType: file.type || "image/jpeg",
                language: "mr",
                schemaVersion: "v1"
            })
        });

        if (!response.ok) throw new Error(`AI Server error: ${response.status}`);

        const result = await response.json();
        
        console.log("Extracted Data:", result.extractedData);
        return result.extractedData; 

    } catch (error) {
        console.error("Failed to process document:", error);
        alert("Failed to process document. Make sure the AI server is running on port 8000.");
    }
}
```

### Usage
```javascript
// Assuming you have: <input type="file" id="uploadInput" />
document.getElementById('uploadInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
        const data = await extractDocumentData(file);
        
        // Auto-fill forms based on the data!
        // document.getElementById('surveyNumInput').value = data.survey_number;
    }
});
```

---

## 🔄 How to Call from the Backend (Node.js)

If you prefer to route the image through your backend first (e.g. to save it to an S3 bucket or database before processing), you can call the AI API from Node using `axios` or `fetch`.

```javascript
const axios = require('axios');

async function processImageFromBackend(base64Image, mimeType) {
    const response = await axios.post('http://localhost:8000/api/process-document', {
        documentId: "doc-" + Date.now(),
        documentType: "Document",
        imageBase64: base64Image,
        mimeType: mimeType,
        language: "mr",
        schemaVersion: "v1"
    }, {
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'default-secret-key'
        }
    });

    return response.data.extractedData;
}
```
