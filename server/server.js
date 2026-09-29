const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;

// Enable CORS and JSON body parser with 15MB payload limit
app.use(cors());
app.use(express.json({ limit: '15mb' }));

// Document Type Labels
const DOC_LABELS = {
    aadhaar: "Aadhaar Card",
    pan: "PAN Card",
    pancard: "PAN Card",
    voter_id: "Voter ID",
    voterid: "Voter ID",
    passport: "Passport",
    other: "Non-Identity File / Random Photo",
    unreadable: "Unreadable / Blurry Document"
};

/**
 * Normalizes document type strings
 */
function normalizeDocType(typeStr) {
    if (!typeStr || typeof typeStr !== 'string') return 'other';
    const clean = typeStr.toLowerCase().trim().replace(/[\s\-_]/g, '');
    if (clean.includes('aadhaar') || clean.includes('uidai')) return 'aadhaar';
    if (clean.includes('pan')) return 'pan';
    if (clean.includes('voter') || clean.includes('epic')) return 'voter_id';
    if (clean.includes('passport')) return 'passport';
    if (clean.includes('unreadable') || clean.includes('blurry') || clean.includes('blank')) return 'unreadable';
    return 'other';
}

/**
 * Verhoeff Checksum Algorithm for Aadhaar Validation
 */
const verhoeffTableD = [
    [0,1,2,3,4,5,6,7,8,9],
    [1,2,3,4,0,6,7,8,9,5],
    [2,3,4,0,1,7,8,9,5,6],
    [3,4,0,1,2,8,9,5,6,7],
    [4,0,1,2,3,9,5,6,7,8],
    [5,9,8,7,6,0,4,3,2,1],
    [6,5,9,8,7,1,0,4,3,2],
    [7,6,5,9,8,2,1,0,4,3],
    [8,7,6,5,9,3,2,1,0,4],
    [9,8,7,6,5,4,3,2,1,0]
];

const verhoeffTableP = [
    [0,1,2,3,4,5,6,7,8,9],
    [1,5,7,6,2,8,3,0,9,4],
    [5,8,0,3,7,9,6,1,4,2],
    [8,9,1,6,0,4,3,5,2,7],
    [9,4,5,3,1,2,6,8,7,0],
    [4,2,8,6,5,7,3,9,0,1],
    [2,7,9,3,8,0,6,4,1,5],
    [7,0,4,6,9,1,3,2,5,8]
];

function validateVerhoeff(numStr) {
    if (!numStr || !/^\d+$/.test(numStr)) return false;
    let c = 0;
    const array = numStr.split('').map(Number).reverse();
    for (let i = 0; i < array.length; i++) {
        c = verhoeffTableD[c][verhoeffTableP[i % 8][array[i]]];
    }
    return c === 0;
}

/**
 * Backend Rule-Based Checks for Extracted ID Fields
 */
function runBackendRuleChecks(docType, extractedFields) {
    const findings = [];
    const idNumber = (extractedFields && extractedFields.id_number) ? String(extractedFields.id_number).trim() : '';

    if (!idNumber || idNumber.toLowerCase() === 'n/a' || idNumber.toLowerCase() === 'unknown' || idNumber.toLowerCase() === 'none') {
        return findings;
    }

    const normType = normalizeDocType(docType);

    if (normType === 'aadhaar') {
        const clean = idNumber.replace(/\D/g, '');
        if (clean.length !== 12) {
            findings.push({
                category: "number_format",
                finding: `Aadhaar number '${idNumber}' must contain exactly 12 digits (found ${clean.length} digits).`,
                severity: "high"
            });
        } else {
            if (clean[0] === '0' || clean[0] === '1') {
                findings.push({
                    category: "number_format",
                    finding: `Aadhaar number '${idNumber}' starts with an invalid digit ('${clean[0]}'). First digit cannot be 0 or 1.`,
                    severity: "high"
                });
            }
            if (!validateVerhoeff(clean)) {
                findings.push({
                    category: "number_format",
                    finding: `Aadhaar number '${idNumber}' fails Verhoeff checksum validation algorithm.`,
                    severity: "high"
                });
            }
        }
    } else if (normType === 'pan') {
        const clean = idNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
        if (!panRegex.test(clean)) {
            findings.push({
                category: "number_format",
                finding: `PAN number '${idNumber}' does not match standard 10-character alphanumeric pattern (AAAAA9999A).`,
                severity: "high"
            });
        } else {
            const validHolders = ['P', 'C', 'H', 'F', 'A', 'B', 'G', 'J', 'L', 'T'];
            if (!validHolders.includes(clean[3])) {
                findings.push({
                    category: "number_format",
                    finding: `4th character '${clean[3]}' of PAN '${idNumber}' is invalid. Must be one of: P, C, H, F, A, B, G, J, L, T.`,
                    severity: "high"
                });
            }
        }
    } else if (normType === 'passport') {
        const clean = idNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        const passportRegex = /^[A-PR-WYa-pr-wy][0-9]{7}$/;
        if (!passportRegex.test(clean)) {
            findings.push({
                category: "number_format",
                finding: `Passport number '${idNumber}' does not match standard Indian passport format (1 letter followed by 7 digits).`,
                severity: "high"
            });
        }
    } else if (normType === 'voter_id') {
        const clean = idNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        const voterRegex = /^[A-Z]{3}[0-9]{7}$/;
        if (!voterRegex.test(clean)) {
            findings.push({
                category: "number_format",
                finding: `Voter ID EPIC number '${idNumber}' format is invalid (expected 3 letters followed by 7 digits).`,
                severity: "high"
            });
        }
    }

    return findings;
}

/**
 * Extracts and validates base64 image payload (max 10MB)
 */
function extractAndValidateImage(rawImageData) {
    if (!rawImageData) {
        throw { statusCode: 400, message: "No image payload was provided in the request." };
    }

    let base64String = "";
    let mimeType = "image/jpeg";

    if (typeof rawImageData === 'string') {
        base64String = rawImageData;
    } else if (typeof rawImageData === 'object') {
        base64String = rawImageData.base64 || rawImageData.data || "";
        if (rawImageData.mimeType) mimeType = rawImageData.mimeType;
    }

    if (!base64String) {
        throw { statusCode: 400, message: "Image payload contains no base64 content." };
    }

    const match = base64String.match(/^data:([a-zA-Z0-9\+\-\.\/]+);base64,/);
    if (match) {
        mimeType = match[1].toLowerCase();
        base64String = base64String.substring(match[0].length);
    }

    // Allowed MIME types: image/jpeg, image/png, image/webp, application/pdf
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowedMimeTypes.includes(mimeType)) {
        throw { statusCode: 400, message: `Unsupported file format '${mimeType}'. Allowed formats: JPG, PNG, WEBP, PDF.` };
    }

    base64String = base64String.replace(/\s/g, '');
    const sizeInMB = (base64String.length * 0.75) / (1024 * 1024);

    if (sizeInMB > 10.0) {
        throw { statusCode: 400, message: `File size (${sizeInMB.toFixed(2)} MB) exceeds maximum limit of 10 MB.` };
    }

    return {
        mimeType,
        base64Data: base64String,
        sizeInMB: parseFloat(sizeInMB.toFixed(2))
    };
}

/**
 * Helper to call Gemini REST API safely
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
    const generationConfig = options.generationConfig || {
        temperature: 0.1,
        topP: 0.8,
        maxOutputTokens: 1000,
        responseMimeType: "application/json"
    };

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
                return rawText;
            } else if (data.error) {
                console.warn(`[Gemini API Warning] ${modelName}: ${data.error.message}`);
                lastError = new Error(data.error.message || `API Error from ${modelName}`);
            }
        } catch (err) {
            console.warn(`[Gemini API Exception] ${modelName}: ${err.message}`);
            lastError = err;
        }
    }

    throw lastError || new Error("Failed to receive valid response from Gemini API.");
}

/**
 * Robust JSON Parser that strips code fences and handles errors safely
 */
function parseJsonOutput(rawText) {
    if (!rawText) return null;
    let clean = rawText.trim();
    clean = clean.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

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
 * POST /api/verify-document
 * Main Verification Endpoint implementing Document Classification Gate & Authenticity Analysis
 */
app.post('/api/verify-document', async (req, res) => {
    try {
        const { expected_type, image } = req.body;

        if (!expected_type) {
            return res.status(400).json({
                status: "error",
                message: "Expected document type ('expected_type') is required."
            });
        }

        const normalizedExpected = normalizeDocType(expected_type);

        // Validate File format & size (Max 10MB)
        let imgObj = null;
        try {
            imgObj = extractAndValidateImage(image);
        } catch (valErr) {
            return res.status(valErr.statusCode || 400).json({
                status: "error",
                message: valErr.message
            });
        }

        console.log(`\n=================== [VERIFY DOCUMENT REQUEST] ===================`);
        console.log(`Expected Type: ${normalizedExpected} (${DOC_LABELS[normalizedExpected] || normalizedExpected})`);
        console.log(`Image Format: ${imgObj.mimeType}, Size: ${imgObj.sizeInMB} MB`);
        console.log(`=================================================================\n`);

        // =========================================================================
        // STEP A: DOCUMENT TYPE DETECTION & MISMATCH REJECTION GATE
        // =========================================================================
        const detectionPrompt = `Examine this uploaded document image. Identify which identity document type it is based on these specific cues:
- Aadhaar: 12-digit number (XXXX XXXX XXXX), UIDAI logo, "Aadhaar" text, QR code, "Unique Identification Authority of India"
- PAN: 10-character alphanumeric (AAAAA9999A), "Income Tax Department", "Permanent Account Number"
- Voter ID: "Election Commission of India", EPIC number, "Elector's Photo Identity Card"
- Passport: MRZ lines at the bottom (P<IND...), "Republic of India", passport number, booklet-style page

Return ONLY a strict JSON object with no markdown fences matching this schema:
{
  "detected_type": "aadhaar" | "pan" | "voter_id" | "passport" | "other" | "unreadable",
  "type_confidence": 0-100,
  "reasoning": "what visual or text cues were detected in the image"
}`;

        const detectionContents = [
            {
                role: 'user',
                parts: [
                    {
                        inline_data: {
                            mime_type: imgObj.mimeType,
                            data: imgObj.base64Data
                        }
                    },
                    { text: detectionPrompt }
                ]
            }
        ];

        let rawDetectionText = null;
        try {
            rawDetectionText = await callGemini(detectionContents);
        } catch (apiErr) {
            console.error("Gemini API call failed during document type classification:", apiErr.message);
            return res.status(500).json({
                status: "error",
                message: "AI Document Detection Service is unavailable: " + apiErr.message
            });
        }

        const detectionResult = parseJsonOutput(rawDetectionText);

        if (!detectionResult || !detectionResult.detected_type) {
            console.warn("Unparseable output from classification model:", rawDetectionText);
            return res.status(422).json({
                status: "wrong_document",
                expected: normalizedExpected,
                detected: "unreadable",
                message: `The uploaded image could not be recognized as a valid ${DOC_LABELS[normalizedExpected] || normalizedExpected}. Please upload a clear document image.`
            });
        }

        const normalizedDetected = normalizeDocType(detectionResult.detected_type);

        console.log(`[Classification Gate Result] Expected: '${normalizedExpected}' vs Detected: '${normalizedDetected}' (Confidence: ${detectionResult.type_confidence}%)`);
        console.log(`Reasoning: ${detectionResult.reasoning}`);

        // MISMATCH REJECTION GATE: If detected_type DOES NOT MATCH expected_type or is "other"/"unreadable"
        if (normalizedDetected !== normalizedExpected || normalizedDetected === 'other' || normalizedDetected === 'unreadable') {
            const expectedName = DOC_LABELS[normalizedExpected] || normalizedExpected.toUpperCase();
            const detectedName = DOC_LABELS[normalizedDetected] || normalizedDetected.toUpperCase();

            let mismatchMsg = `You selected ${expectedName} but the uploaded file looks like ${detectedName}. Please upload the correct document.`;
            if (normalizedDetected === 'other') {
                mismatchMsg = `You selected ${expectedName}, but the uploaded file appears to be a random photo or unsupported file type. Please upload a valid ${expectedName}.`;
            } else if (normalizedDetected === 'unreadable') {
                mismatchMsg = `You selected ${expectedName}, but the uploaded image is too blurry, dark, or unreadable to verify. Please upload a clear, full-frame image.`;
            }

            console.warn(`[MISMATCH REJECTED] HTTP 422: ${mismatchMsg}`);

            return res.status(422).json({
                status: "wrong_document",
                expected: normalizedExpected,
                detected: normalizedDetected,
                message: mismatchMsg
            });
        }

        // =========================================================================
        // STEP B: AUTHENTICITY CHECK (RUNS ONLY WHEN TYPE MATCHES)
        // =========================================================================
        console.log(`[Type Match Confirmed] Proceeding to Authenticity Analysis for ${normalizedExpected}...`);

        const authenticityPrompt = `You are an expert document authenticity and security inspector analyzing an uploaded ${DOC_LABELS[normalizedExpected]}.

Thoroughly inspect the image for visual, structural, and textual authenticity cues:
1. Font & Typography: Inconsistent font styles, altered characters, blurry text, irregular character alignment.
2. Layout & Formatting: Misaligned fields, incorrect logos, missing official emblems or headers.
3. Photo & Edge Integrity: Paste lines around photo, inconsistent lighting, laminate edge tampering, headshot cutout artifacts.
4. Hologram / QR Code / Watermark: Absent, corrupt, unreadable, or fake QR codes; missing micro-printing or holograms.
5. Number Format: ID number syntax or structure errors.
6. Text Consistency: Inconsistencies between printed fields (Name, DOB, ID Number) and background pattern/watermark.
7. Image Quality: Digital screen Moire patterns, screenshot artifacts, heavy editing, or glare hiding security features.

Extract PII fields where visible (Name, ID Number, DOB).

Return ONLY a strict JSON object with no markdown fences matching this schema:
{
  "status": "verified" | "suspicious" | "fake",
  "confidence_score": 0-100,
  "reasons": [
    {
      "category": "font | layout | photo | hologram_qr | number_format | text_consistency | image_quality | metadata",
      "finding": "specific detailed observation of why this feature is original or suspicious/fake",
      "severity": "low | medium | high"
    }
  ],
  "extracted_fields": {
    "name": "Extracted Full Name or N/A",
    "id_number": "Extracted Document ID Number or N/A",
    "dob": "Extracted Date of Birth or N/A"
  },
  "summary": "2-3 sentence concise explanation summarizing the findings."
}`;

        const authenticityContents = [
            {
                role: 'user',
                parts: [
                    {
                        inline_data: {
                            mime_type: imgObj.mimeType,
                            data: imgObj.base64Data
                        }
                    },
                    { text: authenticityPrompt }
                ]
            }
        ];

        let rawAuthenticityText = null;
        try {
            rawAuthenticityText = await callGemini(authenticityContents);
        } catch (authErr) {
            console.error("Gemini API call failed during authenticity analysis:", authErr.message);
            return res.status(500).json({
                status: "error",
                message: "Authenticity Analysis Service failed: " + authErr.message
            });
        }

        let aiReport = parseJsonOutput(rawAuthenticityText);

        if (!aiReport) {
            console.warn("Unparseable output from authenticity model:", rawAuthenticityText);
            aiReport = {
                status: "suspicious",
                confidence_score: 60,
                reasons: [{
                    category: "image_quality",
                    finding: "Automated AI visual parser returned unparseable text format; manual verification recommended.",
                    severity: "medium"
                }],
                extracted_fields: { name: "N/A", id_number: "N/A", dob: "N/A" },
                summary: "The system could not fully parse automated AI visual indicators. Manual inspection is recommended."
            };
        }

        // Run Rule-Based Backend Checks on extracted fields
        const ruleFindings = runBackendRuleChecks(normalizedExpected, aiReport.extracted_fields || {});
        let reasons = Array.isArray(aiReport.reasons) ? aiReport.reasons : [];

        if (ruleFindings.length > 0) {
            console.log(`[Rule Checks Failed] Added ${ruleFindings.length} rule violation findings.`);
            reasons = [...ruleFindings, ...reasons];
        }

        // Calculate final confidence score based on severity penalties
        let baseScore = typeof aiReport.confidence_score === 'number' ? aiReport.confidence_score : 85;
        let highCount = 0;
        let medCount = 0;

        reasons.forEach(r => {
            if (r.severity === 'high') {
                baseScore -= 25;
                highCount++;
            } else if (r.severity === 'medium') {
                baseScore -= 15;
                medCount++;
            } else if (r.severity === 'low') {
                baseScore -= 5;
            }
        });

        // Clamp final score to [0, 100]
        let finalScore = Math.max(0, Math.min(100, Math.round(baseScore)));

        // Determine final status based on thresholds
        let finalStatus = "verified";
        if (finalScore >= 80 && highCount === 0) {
            finalStatus = "verified";
        } else if (finalScore >= 50 && finalScore <= 79) {
            finalStatus = "suspicious";
        } else {
            finalStatus = "fake";
        }

        // Enforce requirement: If status is suspicious or fake, reasons MUST NOT be empty!
        if ((finalStatus === "suspicious" || finalStatus === "fake") && reasons.length === 0) {
            reasons.push({
                category: "layout",
                finding: `Visual and structural anomalies detected for ${DOC_LABELS[normalizedExpected]}. Overall verification confidence is low (${finalScore}%).`,
                severity: finalStatus === "fake" ? "high" : "medium"
            });
        }

        const summaryText = aiReport.summary || `${DOC_LABELS[normalizedExpected]} analysis complete. Overall verdict: ${finalStatus.toUpperCase()} with ${finalScore}% confidence.`;

        console.log(`[Verification Complete] Final Verdict: ${finalStatus.toUpperCase()} (${finalScore}%), Reasons: ${reasons.length}`);

        return res.json({
            status: finalStatus,
            confidence_score: finalScore,
            reasons: reasons,
            extracted_fields: aiReport.extracted_fields || { name: "N/A", id_number: "N/A", dob: "N/A" },
            summary: summaryText
        });

    } catch (error) {
        console.error("Unexpected Error in /api/verify-document:", error);
        return res.status(500).json({
            status: "error",
            message: "An unexpected server error occurred: " + error.message
        });
    }
});

// Legacy Endpoint Aliases for Backward Compatibility
app.post('/api/identify-doc', async (req, res) => {
    req.body.expected_type = req.body.selectedType || 'aadhaar';
    return app._router.handle(req, res, () => {});
});

// Start Express Server
app.listen(PORT, () => {
    console.log(`\n===========================================================`);
    console.log(`  AI Document Verification Proxy running on http://localhost:${PORT}`);
    console.log(`  Target verification endpoint: POST http://localhost:${PORT}/api/verify-document`);
    console.log(`===========================================================\n`);
});
