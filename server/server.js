const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;

// Enable CORS and JSON body parser
app.use(cors());
app.use(express.json());

// System Instruction for Gemini AI Security Specialist
const SYSTEM_INSTRUCTION = `You are an expert AI Document Security Specialist assisting users with identity document verification.
The user is reviewing an identity document (such as an Aadhaar Card or PAN Card) that was flagged as FAKE by a computer vision classification model.

Your task:
1. Explain in plain, clear, professional language common reasons and visual red flags why this specific type of document gets flagged as fake.
2. Mention general security indicators to inspect (e.g. font alignment errors, QR code formatting inconsistencies, photo edge tampering, pattern anomalies, or missing micro-text/hologram features).
3. Frame your explanation generally as helpful security guidelines, noting that computer vision models inspect pixel-level features.
4. Keep responses concise, well-structured (bullet points where appropriate), and easy to read.
5. Provide helpful, context-aware answers to any follow-up questions the user asks.`;

/**
 * Helper function to call Gemini API via REST with multi-model fallback
 */
async function callGemini(contents) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "YOUR_GEMINI_API_KEY_HERE") {
        throw new Error("Gemini API key is not configured in server environment (.env).");
    }

    // Prioritized model fallback list
    const models = [
        "gemini-2.5-flash-lite",
        "gemini-2.5-flash",
        "gemini-3.6-flash",
        "gemini-2.5-pro",
        "gemini-flash-latest"
    ];

    let lastError = null;

    for (const modelName of models) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: contents,
                    systemInstruction: {
                        parts: [{ text: SYSTEM_INSTRUCTION }]
                    },
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 800
                    }
                })
            });

            const data = await response.json();

            if (response.ok && data.candidates && data.candidates.length > 0) {
                const text = data.candidates[0].content.parts.map(p => p.text).join('\n');
                return text;
            } else if (data.error) {
                console.warn(`Model ${modelName} returned error: ${data.error.message}`);
                lastError = new Error(data.error.message || `API Error from ${modelName}`);
            }
        } catch (err) {
            console.warn(`Model ${modelName} fetch exception:`, err.message);
            lastError = err;
        }
    }

    throw lastError || new Error("Failed to generate response from Gemini API.");
}

/**
 * POST /api/explain-fake
 * Payload: { docType, classificationResult, confidenceScore, chatHistory, userMessage }
 */
app.post('/api/explain-fake', async (req, res) => {
    try {
        const { docType = 'Identity Document', confidenceScore = '90%', chatHistory = [], userMessage } = req.body;

        const contents = [];

        // Build Gemini conversation payload from chatHistory if present
        if (Array.isArray(chatHistory) && chatHistory.length > 0) {
            chatHistory.forEach(msg => {
                contents.push({
                    role: msg.sender === 'user' ? 'user' : 'model',
                    parts: [{ text: msg.text }]
                });
            });
        }

        // Add current user prompt
        if (userMessage) {
            contents.push({
                role: 'user',
                parts: [{ text: userMessage }]
            });
        } else {
            // Initial Explanation Request
            const initialPrompt = `My uploaded ${docType} was classified as FAKE with ${confidenceScore} confidence by the classification model. Please explain why this document is likely fake, listing key visual red flags and verification guidelines to check on a ${docType}.`;
            contents.push({
                role: 'user',
                parts: [{ text: initialPrompt }]
            });
        }

        const explanation = await callGemini(contents);

        res.json({
            success: true,
            explanation: explanation
        });
    } catch (error) {
        console.error("Express /api/explain-fake Error:", error.message);
        res.status(500).json({
            success: false,
            message: error.message || "Failed to process AI explanation request."
        });
    }
});

// Start Express Server
app.listen(PORT, () => {
    console.log(`Backend proxy server running on http://localhost:${PORT}`);
});
