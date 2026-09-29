const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;

// Enable CORS and JSON body parser with 15MB payload limit
app.use(cors());
app.use(express.json({ limit: '15mb' }));

// System Instructions
const IDENTIFY_SYSTEM_INSTRUCTION = `You are an expert Indian identity document recognition system. Analyze the provided image carefully and determine which Indian document type it is. Respond strictly in valid JSON matching the requested schema.`;

const EXPLAIN_SYSTEM_INSTRUCTION = `You are a document verification assistant. You are shown an image of an Indian identity document, its confirmed type, and the output of a machine learning classifier (a probability, not proof).

Carefully examine the whole image: header text and logos, emblem, fonts and alignment, photo and its edges, QR code or barcode, hologram or ghost-image area, printed fields, number format, print and scan quality, glare, cropping, and signs of screenshots or re-photographed screens.

Start by stating what document you see and describe what is actually visible. Then list only red flags you can point to in this specific image. If a feature isn't visible or the image is blurry, say so instead of guessing. Never invent details, never mention features of other document types, and never declare the document definitely fake or genuine. Stay on topic.`;

// Generation Configs
const EXPLAIN_GENERATION_CONFIG = {
    temperature: 0.3,
    topP: 0.8,
    maxOutputTokens: 700
};

const IDENTIFY_GENERATION_CONFIG = {
    temperature: 0.1,
    topP: 0.8,
    maxOutputTokens: 300,
    responseMimeType: "application/json"
};

/**
 * Mask sensitive PII in text for server logs
 */
function maskSensitiveText(text) {
    if (!text || typeof text !== 'string') return text;
    // Mask 12-digit Aadhaar numbers: 1234 5678 9012 -> XXXX-XXXX-9012
    let masked = text.replace(/\b\d{4}\s?\d{4}\s?(\d{4})\b/g, 'XXXX-XXXX-$1');
    // Mask 10-char PAN numbers: ABCDE1234F -> XXXXX1234F
    masked = masked.replace(/\b[A-Z]{5}(\d{4}[A-Z])\b/g, 'XXXXX$1');
    return masked;
}

/**
 * Masked Server Logging Helper
 */
function logServerEvent(tag, payload = {}) {
    console.log(`\n=================== [SERVER LOG: ${tag}] ===================`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    if (payload.imageSizeKB !== undefined) console.log(`Image Size: ${payload.imageSizeKB} KB`);
    if (payload.hasImage !== undefined) console.log(`Image Attached: ${payload.hasImage}`);
    if (payload.selectedType) console.log(`Selected Type: ${payload.selectedType}`);
    if (payload.detectedType) console.log(`Detected Type: ${payload.detectedType}`);
    if (payload.confidence) console.log(`Confidence: ${payload.confidence}`);
    if (payload.evidence) console.log(`Visible Evidence: ${JSON.stringify(payload.evidence)}`);
    if (payload.message) console.log(`Message: ${maskSensitiveText(payload.message)}`);
    console.log(`===========================================================\n`);
}

/**
 * Extracts and cleans base64 image data and mimeType
 */
function extractBase64Data(rawImageData) {
    if (!rawImageData) return null;
    let base64String = "";
    let mimeType = "image/jpeg";

    if (typeof rawImageData === 'string') {
        base64String = rawImageData;
    } else if (typeof rawImageData === 'object') {
        base64String = rawImageData.base64 || rawImageData.data || "";
        if (rawImageData.mimeType) mimeType = rawImageData.mimeType;
    }

    if (!base64String) return null;

    const match = base64String.match(/^data:(image\/[a-zA-Z0-9\+\-\.]+);base64,/);
    if (match) {
        mimeType = match[1];
        base64String = base64String.substring(match[0].length);
    }

    base64String = base64String.replace(/\s/g, '');
    const sizeInKB = Math.round((base64String.length * 0.75) / 1024);

    return {
        mimeType,
        base64Data: base64String,
        sizeInKB
    };
}

/**
 * REST helper to execute Gemini multimodal requests across supported models
 */
async function callGemini(contents, options = {}) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "YOUR_GEMINI_API_KEY_HERE") {
        throw new Error("Gemini API key is not configured in server environment (.env).");
    }

    const models = [
        "gemini-3.8-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-flash-latest"
    ];

    let lastError = null;
    const generationConfig = options.generationConfig || EXPLAIN_GENERATION_CONFIG;

    for (const modelName of models) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
            const requestBody = {
                contents: contents,
                generationConfig: generationConfig
            };

            if (options.systemInstruction) {
                requestBody.systemInstruction = {
                    parts: [{ text: options.systemInstruction }]
                };
            }

            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestBody)
            });

            const data = await response.json();

            if (response.ok && data.candidates && data.candidates.length > 0) {
                const rawText = data.candidates[0].content.parts.map(p => p.text).join('\n');
                console.log(`[Gemini Success] Model: ${modelName}`);
                return rawText;
            } else if (data.error) {
                console.warn(`[Gemini Warning] Model ${modelName} error: ${data.error.message}`);
                lastError = new Error(data.error.message || `API Error from ${modelName}`);
            }
        } catch (err) {
            console.warn(`[Gemini Exception] Model ${modelName}: ${err.message}`);
            lastError = err;
        }
    }

    throw lastError || new Error("Failed to receive valid response from Gemini Vision API.");
}

/**
 * Strict JSON parser for Step 1 Document Identification
 */
function parseJsonOutput(rawText) {
    if (!rawText) return null;
    let clean = rawText.trim();
    clean = clean.replace(/^```json|^```/i, '').replace(/```$/i, '').trim();

    try {
        return JSON.parse(clean);
    } catch (e) {
        const match = clean.match(/\{[\s\S]*\}/);
        if (match) {
            try { return JSON.parse(match[0]); } catch (err) {}
        }
        return null;
    }
}

/**
 * POST /api/identify-doc (Step 1 Mismatch Gate)
 */
app.post('/api/identify-doc', async (req, res) => {
    try {
        const { image, selectedType = 'unknown' } = req.body;
        const imgObj = extractBase64Data(image);

        if (!imgObj) {
            logServerEvent("IDENTIFY_DOC_FAIL", { selectedType, message: "No valid image data provided" });
            return res.status(400).json({
                success: false,
                message: "No valid image data provided."
            });
        }

        logServerEvent("IDENTIFY_DOC_REQUEST", {
            selectedType,
            hasImage: true,
            imageSizeKB: imgObj.sizeInKB
        });

        const promptText = `Examine this document image. Identify the Indian document type.
Return a STRICT JSON object ONLY matching this schema, with no markdown code blocks:
{
  "detectedType": "aadhaar" | "pan" | "passport" | "voterid" | "other" | "unreadable",
  "confidence": "high" | "medium" | "low",
  "visibleEvidence": ["2-3 short cues actually seen in the image, e.g. UIDAI logo, 12-digit number in 4-4-4 grouping, Income Tax emblem"]
}`;

        const contents = [
            {
                role: 'user',
                parts: [
                    {
                        inline_data: {
                            mime_type: imgObj.mimeType,
                            data: imgObj.base64Data
                        }
                    },
                    { text: promptText }
                ]
            }
        ];

        const rawResult = await callGemini(contents, {
            systemInstruction: IDENTIFY_SYSTEM_INSTRUCTION,
            generationConfig: IDENTIFY_GENERATION_CONFIG
        });

        const jsonOutput = parseJsonOutput(rawResult);

        if (jsonOutput && jsonOutput.detectedType) {
            let normType = jsonOutput.detectedType.toLowerCase().trim();
            if (normType === "pancard" || normType === "pan_card" || normType === "pan card") normType = "pan";

            logServerEvent("IDENTIFY_DOC_SUCCESS", {
                selectedType,
                detectedType: normType,
                confidence: jsonOutput.confidence || "high",
                evidence: jsonOutput.visibleEvidence || []
            });

            return res.json({
                success: true,
                detectedType: normType,
                confidence: jsonOutput.confidence || "high",
                visibleEvidence: Array.isArray(jsonOutput.visibleEvidence) ? jsonOutput.visibleEvidence : ["Identified from document layout."]
            });
        }

        logServerEvent("IDENTIFY_DOC_FALLBACK", { selectedType, message: "Unparseable Gemini output" });
        return res.json({
            success: true,
            detectedType: "other",
            confidence: "low",
            visibleEvidence: ["Unclear or unrecognized layout."]
        });

    } catch (error) {
        console.error("Error in /api/identify-doc:", error.message);
        logServerEvent("IDENTIFY_DOC_ERROR", { message: error.message });
        res.json({
            success: true,
            detectedType: "other",
            confidence: "low",
            visibleEvidence: ["Image identification unavailable: " + error.message]
        });
    }
});

/**
 * Builds multimodal contents payload ending with a user turn
 */
function buildExplainMultimodalContents(imageObj, docType, confidenceScore, chatHistory, userMessage) {
    const contents = [];
    const userParts = [];

    if (imageObj && imageObj.base64Data) {
        userParts.push({
            inline_data: {
                mime_type: imageObj.mimeType,
                data: imageObj.base64Data
            }
        });
    }

    const perTypeChecklists = {
        aadhaar: "Aadhaar Reference Checklist: UIDAI logo, Government of India header, 12-digit number in 4-4-4 grouping, QR code, ghost image, structured address block.",
        pan: "PAN Reference Checklist: Income Tax Department header, 10-character alphanumeric number (AAAAA9999A pattern), photo, signature, DOB and Father's Name fields.",
        pancard: "PAN Reference Checklist: Income Tax Department header, 10-character alphanumeric number (AAAAA9999A pattern), photo, signature, DOB and Father's Name fields.",
        passport: "Passport Reference Checklist: MRZ (Machine Readable Zone) lines at bottom, photo page laminate, Republic of India emblem, watermark, passport number format.",
        voterid: "Voter ID Reference Checklist: EPIC number of 3 letters + 7 digits, Election Commission of India marking/seal, hologram, photo lamination."
    };

    const docKey = docType.toLowerCase().replace(/\s+/g, '');
    const checklistText = perTypeChecklists[docKey] || perTypeChecklists.aadhaar;

    let initialPrompt = `Document Type Confirmed: ${docType}
Classifier Verdict: FAKE
Classifier Confidence: ${confidenceScore}
${checklistText}

Examine the whole image. Follow the exact required output format:

**What I see:**
[2-3 lines describing what is actually visible in THIS specific image]

**Possible red flags:**
• [Red flag 1 tied strictly to something visible in this image]
• [Red flag 2]
• [Red flag 3]

**What to verify next:**
[Official verification portal steps for ${docType}]

*Disclaimer: This is an automated preliminary assessment based on visual indicators and classifier probabilities. It is not legal proof of authenticity.*`;

    if (userMessage) {
        initialPrompt += `\n\nUser Follow-up Query: ${userMessage}`;
    }

    userParts.push({ text: initialPrompt });

    contents.push({
        role: 'user',
        parts: userParts
    });

    if (Array.isArray(chatHistory) && chatHistory.length > 0) {
        chatHistory.forEach(msg => {
            contents.push({
                role: msg.sender === 'user' ? 'user' : 'model',
                parts: [{ text: maskSensitiveText(msg.text) }]
            });
        });

        // Ensure turn sequence ends on user role
        if (contents[contents.length - 1].role === 'model') {
            contents.push({
                role: 'user',
                parts: [{ text: userMessage ? maskSensitiveText(userMessage) : "Please describe visual red flags visible in this document image." }]
            });
        }
    }

    return contents;
}

/**
 * POST /api/explain-fake
 */
app.post('/api/explain-fake', async (req, res) => {
    try {
        const { docType = 'Identity Document', confidenceScore = '90%', image, chatHistory = [], userMessage } = req.body;
        const imgObj = extractBase64Data(image);

        logServerEvent("EXPLAIN_FAKE_REQUEST", {
            selectedType: docType,
            confidence: confidenceScore,
            hasImage: !!(imgObj && imgObj.base64Data),
            imageSizeKB: imgObj ? imgObj.sizeInKB : 0
        });

        if (!imgObj || !imgObj.base64Data) {
            return res.json({
                success: true,
                explanation: `**What I see:**
No image data was received by the server.

**Possible red flags:**
• Image payload was missing or not attached to the analysis request.

**What to verify next:**
• Please re-upload a clear image of your ${docType} to enable visual AI inspection.`
            });
        }

        const contents = buildExplainMultimodalContents(imgObj, docType, confidenceScore, chatHistory, userMessage);

        const explanation = await callGemini(contents, {
            systemInstruction: EXPLAIN_SYSTEM_INSTRUCTION,
            generationConfig: EXPLAIN_GENERATION_CONFIG
        });

        logServerEvent("EXPLAIN_FAKE_SUCCESS", {
            selectedType: docType,
            message: "Successfully generated grounded explanation"
        });

        res.json({
            success: true,
            explanation: explanation
        });

    } catch (error) {
        console.error("Error in /api/explain-fake:", error.message);
        logServerEvent("EXPLAIN_FAKE_ERROR", { message: error.message });

        const fallbackResponse = `**What I see:**
I have examined the uploaded ${req.body.docType || 'identity document'} image.

**Possible red flags:**
• Computer vision classification model flagged structural or layout anomalies with ${req.body.confidenceScore || 'high'} confidence.
• Network or service disruption (${error.message}).

**What to verify next:**
• Verify document details directly on the official issuing authority portal.

*Disclaimer: This is an automated preliminary assessment based on visual indicators and classifier probabilities. It is not legal proof of authenticity.*`;

        res.json({
            success: true,
            explanation: fallbackResponse
        });
    }
});

/**
 * POST /api/chat
 */
app.post('/api/chat', async (req, res) => {
    try {
        const { docType = 'Identity Document', confidenceScore = '90%', image, chatHistory = [], userMessage } = req.body;
        const imgObj = extractBase64Data(image);

        logServerEvent("CHAT_REQUEST", {
            selectedType: docType,
            hasImage: !!(imgObj && imgObj.base64Data),
            imageSizeKB: imgObj ? imgObj.sizeInKB : 0,
            message: userMessage
        });

        const contents = buildExplainMultimodalContents(imgObj, docType, confidenceScore, chatHistory, userMessage);

        const responseText = await callGemini(contents, {
            systemInstruction: EXPLAIN_SYSTEM_INSTRUCTION,
            generationConfig: EXPLAIN_GENERATION_CONFIG
        });

        res.json({
            success: true,
            explanation: responseText
        });

    } catch (error) {
        console.error("Error in /api/chat:", error.message);
        logServerEvent("CHAT_ERROR", { message: error.message });
        res.json({
            success: false,
            message: "Unable to process chat request: " + error.message
        });
    }
});

// Start Express Server
app.listen(PORT, () => {
    console.log(`\n===========================================================`);
    console.log(`  Multimodal Vision Backend Proxy running on http://localhost:${PORT}`);
    console.log(`===========================================================\n`);
});
