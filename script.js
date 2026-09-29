/**
 * Multi-Document Teachable Machine Classification Script
 * Supported Documents: Aadhaar Card, PAN Card, Passport & Voter ID
 */

// SESSION GUARD: Protect route if user is not authenticated
(function checkSession() {
    if (sessionStorage.getItem("isLoggedIn") !== "true") {
        window.location.href = "login.html";
    }
})();

// Data-Driven Document Registry Configuration
const DOC_TYPES = {
    aadhaar: {
        id: "aadhaar",
        label: "Aadhaar Card",
        icon: "fa-address-card",
        modelPath: "./model-aadhaar/",
        resultTitle: "Aadhaar Card Check Result"
    },
    pan: {
        id: "pan",
        label: "PAN Card",
        icon: "fa-id-card",
        modelPath: "./model-pancard/",
        resultTitle: "PAN Card Check Result"
    },
    pancard: {
        id: "pancard",
        label: "PAN Card",
        icon: "fa-id-card",
        modelPath: "./model-pancard/",
        resultTitle: "PAN Card Check Result"
    },
    passport: {
        id: "passport",
        label: "Passport",
        icon: "fa-passport",
        modelPath: "./model-passport/",
        resultTitle: "Passport Check Result"
    },
    voterid: {
        id: "voterid",
        label: "Voter ID Card",
        icon: "fa-check-to-slot",
        modelPath: "./model-voterid/",
        resultTitle: "Voter ID Check Result"
    }
};

// Application State
let currentDocType = "aadhaar";
const loadedModels = {}; // Cache map for all loaded models
let webcamStream = null;
let isLivePredicting = false;
let livePredictAnimationFrame = null;

// Multimodal & Identification Gate State
let currentImageData = null; // { base64, mimeType }
let isMismatchActive = false;
let isMismatchOverridden = false;
let detectedDocInfo = null;

// DOM Elements
const modelStatusPill = document.getElementById("model-status");
const modelStatusText = document.getElementById("model-status-text");

const docResultBanner = document.getElementById("doc-result-banner");
const docResultIcon = document.getElementById("doc-result-icon");
const docResultTitle = document.getElementById("doc-result-title");
const activeModelFolder = document.getElementById("active-model-folder");

const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");

const webcamVideo = document.getElementById("webcam-video");
const webcamOverlay = document.getElementById("webcam-overlay");
const startWebcamBtn = document.getElementById("start-webcam-btn");
const stopWebcamBtn = document.getElementById("stop-webcam-btn");
const captureWebcamBtn = document.getElementById("capture-webcam-btn");
const livePredictBtn = document.getElementById("live-predict-btn");
const livePredictText = document.getElementById("live-predict-text");

const previewCard = document.getElementById("preview-card");
const previewImage = document.getElementById("preview-image");
const imageInfoName = document.getElementById("image-info-name");
const classifyBtn = document.getElementById("classify-btn");

const resultsEmpty = document.getElementById("results-empty");
const resultsLoading = document.getElementById("results-loading");
const resultsContent = document.getElementById("results-content");
const errorBanner = document.getElementById("error-banner");
const errorMessage = document.getElementById("error-message");
const inferenceTimeBadge = document.getElementById("inference-time-badge");

const verdictCard = document.getElementById("verdict-card");
const verdictIcon = document.getElementById("verdict-icon");
const verdictTitle = document.getElementById("verdict-title");
const verdictDesc = document.getElementById("verdict-desc");
const verdictTopScore = document.getElementById("verdict-top-score");

const userDisplayName = document.getElementById("user-display-name");

// Initialization
document.addEventListener("DOMContentLoaded", () => {
    const currentUser = sessionStorage.getItem("currentUser") || "User";
    if (userDisplayName) {
        userDisplayName.textContent = currentUser;
    }

    renderDocTypeTabs();
    preloadAllModels();
    setupDropZone();
    setupFileInput();
});

/**
 * Dynamically renders document selector tabs
 */
function renderDocTypeTabs() {
    const container = document.getElementById("doc-tabs-container");
    if (!container) return;

    // Filter unique doc types for UI buttons (aadhaar, pan, passport, voterid)
    const uniqueKeys = ["aadhaar", "pan", "passport", "voterid"];

    container.innerHTML = uniqueKeys.map(key => {
        const doc = DOC_TYPES[key];
        const isActive = (key === currentDocType || (key === "pan" && currentDocType === "pancard"));
        return `
            <button class="doc-btn ${isActive ? 'active' : ''}" 
                    id="doc-${key}-btn" 
                    onclick="selectDocumentType('${key}')">
                <i class="fa-solid ${doc.icon}"></i> ${doc.label}
            </button>
        `;
    }).join('');
}

// Logout Session Function
function logout() {
    sessionStorage.removeItem("isLoggedIn");
    sessionStorage.removeItem("currentUser");
    sessionStorage.removeItem("currentUserEmail");
    window.location.href = "login.html";
}

/* ==========================================================================
   1. Sensitive PII Masking Helper
   ========================================================================== */
function maskSensitiveIdNumbers(text) {
    if (!text || typeof text !== 'string') return text;
    // Mask 12-digit Aadhaar numbers: 1234 5678 9012 -> XXXX-XXXX-9012
    let masked = text.replace(/\b\d{4}\s?\d{4}\s?(\d{4})\b/g, 'XXXX-XXXX-$1');
    // Mask 10-char PAN numbers: ABCDE1234F -> XXXXX1234F
    masked = masked.replace(/\b[A-Z]{5}(\d{4}[A-Z])\b/g, 'XXXXX$1');
    return masked;
}

/* ==========================================================================
   2. Client-Side Image Resizing (Max 1280px on longest side)
   ========================================================================== */
function getResizedBase64(imgElement, maxDimension = 1280) {
    if (!imgElement || !imgElement.src) return null;

    try {
        const canvas = document.createElement("canvas");
        let width = imgElement.naturalWidth || imgElement.width || 640;
        let height = imgElement.naturalHeight || imgElement.height || 480;

        if (width > maxDimension || height > maxDimension) {
            if (width > height) {
                height = Math.round((height * maxDimension) / width);
                width = maxDimension;
            } else {
                width = Math.round((width * maxDimension) / height);
                height = maxDimension;
            }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(imgElement, 0, 0, width, height);

        const mimeType = "image/jpeg";
        const dataUrl = canvas.toDataURL(mimeType, 0.85);

        return {
            base64: dataUrl,
            mimeType: mimeType
        };
    } catch (e) {
        console.warn("Canvas resize exception:", e.message);
        return {
            base64: imgElement.src,
            mimeType: "image/jpeg"
        };
    }
}

function getCurrentImageData() {
    if (!currentImageData && previewImage && previewImage.src && previewCard.style.display !== 'none') {
        currentImageData = getResizedBase64(previewImage, 1280);
    }
    return currentImageData;
}

/* ==========================================================================
   3. Step 2 Mismatch Gate BEFORE Classifier Result is Shown
   ========================================================================== */
async function handleImageIngestion() {
    if (!previewImage.src || previewCard.style.display === 'none') return;

    currentImageData = getResizedBase64(previewImage, 1280);
    isMismatchOverridden = false;
    isMismatchActive = false;

    // Show loading state in results section while identifying document type
    showLoading(true, "Verifying document type with Gemini Vision...");

    try {
        const response = await fetch("http://localhost:5001/api/identify-doc", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                image: currentImageData,
                selectedType: currentDocType
            })
        });

        const data = await response.json();
        showLoading(false);

        if (data && data.success) {
            detectedDocInfo = data;
            let detected = (data.detectedType || "other").toLowerCase().trim();
            if (detected === "pancard" || detected === "pan_card" || detected === "pan card") detected = "pan";

            let selectedNorm = (currentDocType === "pancard") ? "pan" : currentDocType;
            const isSupported = DOC_TYPES[detected] !== undefined;

            const evidenceText = (data.visibleEvidence && data.visibleEvidence.length > 0)
                ? data.visibleEvidence.join(", ")
                : "visual layout indicators";

            if (isSupported && detected !== selectedNorm && data.confidence !== "low") {
                // MISMATCH GATE TRIGGERED!
                isMismatchActive = true;
                const detectedLabel = DOC_TYPES[detected].label;
                const selectedLabel = DOC_TYPES[selectedNorm] ? DOC_TYPES[selectedNorm].label : selectedNorm.toUpperCase();

                renderMismatchWarningCard(selectedLabel, detectedLabel, detected, evidenceText);
                return;
            } else if (!isSupported || detected === "other" || detected === "unreadable") {
                // UNREADABLE / NON-DOCUMENT PHOTO GATE TRIGGERED!
                isMismatchActive = true;
                renderUnreadableWarningCard();
                return;
            } else {
                // Match confirmed -> Proceed to classify with TM model
                isMismatchActive = false;
                classifyActiveImage();
            }
        } else {
            // Fallback if API fails -> proceed to classification
            classifyActiveImage();
        }
    } catch (err) {
        console.warn("Identification request failed, proceeding to direct classification:", err.message);
        showLoading(false);
        classifyActiveImage();
    }
}

/**
 * Render Mismatch Warning Card in Results Panel
 */
function renderMismatchWarningCard(selectedLabel, detectedLabel, detectedKey, evidenceText) {
    resultsEmpty.style.display = 'none';
    resultsLoading.style.display = 'none';
    resultsContent.style.display = 'block';

    if (typeof hideChatbotPanel === "function") {
        hideChatbotPanel();
    }

    verdictCard.className = "verdict-card verdict-warning-mismatch";
    verdictIcon.className = "fa-solid fa-triangle-exclamation";
    verdictTitle.textContent = "Wrong Document Type Detected";
    verdictDesc.innerHTML = `
        You selected <strong>${selectedLabel}</strong>, but this image looks like an <strong>${detectedLabel}</strong> 
        <br><span class="mismatch-evidence">(Seen: ${evidenceText})</span>.
        <br><small style="color: #fde68a;">Classification results for the wrong document type are invalid.</small>
    `;

    verdictTopScore.textContent = "MISMATCH";

    // Insert action buttons
    let actionBox = document.getElementById("mismatch-action-box");
    if (!actionBox) {
        actionBox = document.createElement("div");
        actionBox.id = "mismatch-action-box";
        actionBox.className = "mismatch-action-container";
        verdictCard.appendChild(actionBox);
    }

    actionBox.style.display = "flex";
    actionBox.innerHTML = `
        <button class="btn btn-warning btn-md" onclick="switchSelectorAndRecheck('${detectedKey}')">
            <i class="fa-solid fa-arrow-rotate-right"></i> Switch to ${detectedLabel} & Re-check
        </button>
        <button class="btn btn-outline btn-md" onclick="overrideMismatchAndClassify()">
            <i class="fa-solid fa-circle-question"></i> Keep ${selectedLabel} Anyway
        </button>
    `;
}

/**
 * Render Unreadable / Non-Document Photo Card
 */
function renderUnreadableWarningCard() {
    resultsEmpty.style.display = 'none';
    resultsLoading.style.display = 'none';
    resultsContent.style.display = 'block';

    if (typeof hideChatbotPanel === "function") {
        hideChatbotPanel();
    }

    verdictCard.className = "verdict-card verdict-warning-unreadable";
    verdictIcon.className = "fa-solid fa-camera-rotate";
    verdictTitle.textContent = "Unclear or Unsupported Photo";
    verdictDesc.innerHTML = `This doesn't look like a supported ID document or the image is too unclear. Please upload a clear, well-lit, full-frame photo.`;
    verdictTopScore.textContent = "N/A";

    const actionBox = document.getElementById("mismatch-action-box");
    if (actionBox) actionBox.style.display = "none";
}

function switchSelectorAndRecheck(targetDocTypeId) {
    const actionBox = document.getElementById("mismatch-action-box");
    if (actionBox) actionBox.style.display = "none";

    isMismatchActive = false;
    isMismatchOverridden = false;

    selectDocumentType(targetDocTypeId);
}

function overrideMismatchAndClassify() {
    const actionBox = document.getElementById("mismatch-action-box");
    if (actionBox) actionBox.style.display = "none";

    isMismatchActive = false;
    isMismatchOverridden = true;

    classifyActiveImage();
}

/* ==========================================================================
   4. Model Loader & Cache Manager
   ========================================================================== */
async function loadModelForDocType(docTypeId) {
    let normTypeId = (docTypeId === "pan") ? "pancard" : docTypeId;
    if (loadedModels[normTypeId]) {
        return loadedModels[normTypeId];
    }
    const docConfig = DOC_TYPES[normTypeId];
    if (!docConfig) throw new Error(`Unknown document type: ${docTypeId}`);

    const modelURL = docConfig.modelPath + "model.json";
    const metadataURL = docConfig.modelPath + "metadata.json";

    const model = await tmImage.load(modelURL, metadataURL);
    loadedModels[normTypeId] = model;
    return model;
}

async function preloadAllModels() {
    updateModelStatus("loading", "Loading Models...");
    try {
        if (typeof tmImage === "undefined") {
            throw new Error("Teachable Machine library not loaded. Check CDN script tags.");
        }

        // Preload models for unique document keys
        const keys = ["aadhaar", "pancard", "passport", "voterid"];
        await Promise.all(keys.map(id => loadModelForDocType(id)));

        updateModelStatus("ready", `Models Loaded (4 Document Types Ready)`);
    } catch (err) {
        console.error("Error preloading models:", err);
        updateModelStatus("error", "Model Load Failed");
        showError(
            `Failed to load document models. Please run a local web server (e.g. <code>python -m http.server 5000</code>).`
        );
    }
}

function updateModelStatus(state, text) {
    if (modelStatusPill) modelStatusPill.className = `model-status-badge status-${state}`;
    if (modelStatusText) modelStatusText.textContent = text;
}

/* ==========================================================================
   5. Document Type Selection & Auto Re-classification
   ========================================================================== */
function selectDocumentType(docTypeId) {
    let normId = (docTypeId === "pan") ? "pancard" : docTypeId;
    if (!DOC_TYPES[normId]) return;
    currentDocType = normId;

    // Update tab highlight
    document.querySelectorAll(".doc-btn").forEach(btn => btn.classList.remove("active"));
    const activeBtn = document.getElementById(`doc-${docTypeId === 'pancard' ? 'pan' : docTypeId}-btn`) || document.getElementById(`doc-${normId}-btn`);
    if (activeBtn) activeBtn.classList.add("active");

    // Update Result Banner & Folder Metadata
    const docConfig = DOC_TYPES[normId];
    docResultIcon.className = `fa-solid ${docConfig.icon}`;
    docResultTitle.textContent = docConfig.resultTitle;
    if (activeModelFolder) activeModelFolder.textContent = docConfig.modelPath;

    // Auto re-ingest active preview image if present
    if (previewImage.src && previewCard.style.display !== 'none') {
        handleImageIngestion();
    }
}

/* ==========================================================================
   6. Tab Switching Logic (Upload vs Webcam)
   ========================================================================== */
function switchTab(tabName) {
    document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
    document.getElementById(`tab-${tabName}-btn`).classList.add("active");

    document.querySelectorAll(".tab-content").forEach(content => content.classList.remove("active"));
    document.getElementById(`${tabName}-tab`).classList.add("active");

    if (tabName !== "webcam" && webcamStream) {
        stopWebcam();
    }
}

/* ==========================================================================
   7. File Upload & Drag-and-Drop
   ========================================================================== */
function setupDropZone() {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
    });

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files && files.length > 0) {
            handleSelectedFile(files[0]);
        }
    });

    dropZone.addEventListener('click', (e) => {
        if (e.target !== fileInput && !e.target.classList.contains('btn')) {
            fileInput.click();
        }
    });
}

function setupFileInput() {
    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            handleSelectedFile(e.target.files[0]);
        }
    });
}

function handleSelectedFile(file) {
    clearError();
    if (!file.type.startsWith('image/')) {
        showError("Invalid file type. Please select a valid image file (JPG, PNG, WEBP).");
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        previewImage.src = e.target.result;
        imageInfoName.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
        previewCard.style.display = 'block';

        previewImage.onload = () => {
            handleImageIngestion();
        };
    };
    reader.readAsDataURL(file);
}

function clearSelectedImage() {
    previewImage.src = '';
    currentImageData = null;
    isMismatchActive = false;
    isMismatchOverridden = false;
    detectedDocInfo = null;

    const actionBox = document.getElementById("mismatch-action-box");
    if (actionBox) actionBox.style.display = "none";

    previewCard.style.display = 'none';
    fileInput.value = '';
    resetResultsUI();
}

/* ==========================================================================
   8. Webcam Controls
   ========================================================================== */
async function startWebcam() {
    clearError();
    try {
        const constraints = {
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: "user"
            }
        };

        webcamStream = await navigator.mediaDevices.getUserMedia(constraints);
        webcamVideo.srcObject = webcamStream;
        webcamOverlay.style.display = 'none';

        startWebcamBtn.disabled = true;
        stopWebcamBtn.disabled = false;
        captureWebcamBtn.disabled = false;
        livePredictBtn.disabled = false;

    } catch (err) {
        console.error("Webcam access error:", err);
        showError("Unable to access camera. Please allow camera permissions in your browser settings.");
    }
}

function stopWebcam() {
    if (isLivePredicting) {
        toggleLivePredict();
    }

    if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
        webcamStream = null;
    }

    webcamVideo.srcObject = null;
    webcamOverlay.style.display = 'flex';

    startWebcamBtn.disabled = false;
    stopWebcamBtn.disabled = true;
    captureWebcamBtn.disabled = true;
    livePredictBtn.disabled = true;
}

function captureWebcamImage() {
    if (!webcamStream) return;

    const hiddenCanvas = document.getElementById("hidden-canvas");
    const ctx = hiddenCanvas.getContext("2d");
    
    hiddenCanvas.width = webcamVideo.videoWidth || 640;
    hiddenCanvas.height = webcamVideo.videoHeight || 480;

    ctx.drawImage(webcamVideo, 0, 0, hiddenCanvas.width, hiddenCanvas.height);
    
    const dataUrl = hiddenCanvas.toDataURL("image/jpeg");
    previewImage.src = dataUrl;
    imageInfoName.textContent = "Webcam Snapshot (" + new Date().toLocaleTimeString() + ")";
    previewCard.style.display = 'block';

    previewImage.onload = () => {
        handleImageIngestion();
    };
}

function toggleLivePredict() {
    if (isLivePredicting) {
        isLivePredicting = false;
        cancelAnimationFrame(livePredictAnimationFrame);
        livePredictBtn.classList.remove("btn-danger");
        livePredictBtn.classList.add("btn-outline");
        livePredictText.textContent = "Live Classify";
    } else {
        if (!webcamStream) return;
        isLivePredicting = true;
        livePredictBtn.classList.remove("btn-outline");
        livePredictBtn.classList.add("btn-danger");
        livePredictText.textContent = "Stop Live";
        runLivePredictionLoop();
    }
}

async function runLivePredictionLoop() {
    if (!isLivePredicting || !webcamVideo) return;

    if (webcamVideo.readyState === 4) {
        try {
            const activeModel = await loadModelForDocType(currentDocType);
            const predictions = await activeModel.predict(webcamVideo);
            displayPredictions(predictions, 0);
        } catch (e) {
            console.error("Live prediction error:", e);
        }
    }
    
    livePredictAnimationFrame = requestAnimationFrame(runLivePredictionLoop);
}

/* ==========================================================================
   9. Teachable Machine Classification & Display Logic
   ========================================================================== */
async function classifyActiveImage() {
    clearError();
    showLoading(true, "Running classification model...");

    const startTime = performance.now();

    try {
        const activeModel = await loadModelForDocType(currentDocType);

        if (!previewImage.src || previewCard.style.display === 'none') {
            showError("Please upload or capture an image first.");
            showLoading(false);
            return;
        }

        const predictions = await activeModel.predict(previewImage);
        const endTime = performance.now();
        const duration = Math.round(endTime - startTime);

        displayPredictions(predictions, duration);
    } catch (err) {
        console.error("Inference Error:", err);
        showError("Classification failed: " + err.message);
    } finally {
        showLoading(false);
    }
}

function normalizeClassName(rawLabel) {
    if (!rawLabel) return "UNKNOWN";
    const clean = rawLabel.trim().toUpperCase();
    if (clean.includes("ORIGINAL")) return "ORIGINAL";
    if (clean.includes("FAKE")) return "FAKE";
    return clean;
}

function displayPredictions(predictions, durationMs = 0) {
    if (!predictions || predictions.length === 0) return;

    resultsEmpty.style.display = 'none';
    resultsContent.style.display = 'block';

    if (durationMs > 0) {
        inferenceTimeBadge.textContent = `Inference: ${durationMs}ms`;
        inferenceTimeBadge.style.display = 'inline-block';
    }

    const docConfig = DOC_TYPES[currentDocType] || DOC_TYPES.aadhaar;
    const topRaw = [...predictions].sort((a, b) => b.probability - a.probability)[0];
    const topNormClass = normalizeClassName(topRaw.className);
    const topScorePercent = (topRaw.probability * 100).toFixed(1) + "%";

    verdictTopScore.textContent = topScorePercent;

    const actionBox = document.getElementById("mismatch-action-box");
    if (actionBox) actionBox.style.display = "none";

    // Update Verdict Card styling according to ORIGINAL vs FAKE
    if (topNormClass === "ORIGINAL") {
        verdictCard.className = "verdict-card verdict-original";
        verdictIcon.className = "fa-solid fa-circle-check";
        verdictTitle.textContent = "ORIGINAL";
        verdictDesc.textContent = isMismatchOverridden 
            ? `[Low Reliability - Document Mismatch] Authentic ${docConfig.label} format detected (${topScorePercent}).`
            : `Authentic ${docConfig.label} detected with ${topScorePercent} confidence.`;
    } else if (topNormClass === "FAKE") {
        verdictCard.className = "verdict-card verdict-fake";
        verdictIcon.className = "fa-solid fa-triangle-exclamation";
        verdictTitle.textContent = "FAKE";
        verdictDesc.textContent = isMismatchOverridden
            ? `[Low Reliability - Document Mismatch] Potential fake ${docConfig.label} detected (${topScorePercent}).`
            : `Potential fake or manipulated ${docConfig.label} detected (${topScorePercent} confidence).`;
    } else {
        verdictCard.className = "verdict-card";
        verdictIcon.className = "fa-solid fa-circle-info";
        verdictTitle.textContent = topRaw.className.trim();
        verdictDesc.textContent = `Predicted class: ${topRaw.className.trim()} (${topScorePercent}).`;
    }

    // Update progress bars
    let originalProb = 0;
    let fakeProb = 0;

    predictions.forEach(pred => {
        const norm = normalizeClassName(pred.className);
        if (norm === "ORIGINAL") originalProb += pred.probability;
        if (norm === "FAKE") fakeProb += pred.probability;
    });

    const origScoreEl = document.getElementById("score-ORIGINAL");
    const origBarEl = document.getElementById("bar-ORIGINAL");
    const fakeScoreEl = document.getElementById("score-FAKE");
    const fakeBarEl = document.getElementById("bar-FAKE");

    if (origScoreEl && origBarEl) {
        const origPct = (originalProb * 100).toFixed(1);
        origScoreEl.textContent = `${origPct}%`;
        origBarEl.style.width = `${origPct}%`;
    }

    if (fakeScoreEl && fakeBarEl) {
        const fakePct = (fakeProb * 100).toFixed(1);
        fakeScoreEl.textContent = `${fakePct}%`;
        fakeBarEl.style.width = `${fakePct}%`;
    }

    // Trigger AI Chatbot panel activation (ONLY IF FAKE AND NO ACTIVE UNRESOLVED MISMATCH)
    if (typeof handleChatbotVisibility === "function") {
        if (!isMismatchActive) {
            handleChatbotVisibility(topNormClass, docConfig.label, topScorePercent);
        } else {
            hideChatbotPanel();
        }
    }
}

/* ==========================================================================
   10. UI Helpers
   ========================================================================== */
function showLoading(isLoading, customText = "Analyzing document features...") {
    if (isLoading) {
        resultsEmpty.style.display = 'none';
        resultsContent.style.display = 'none';
        resultsLoading.style.display = 'block';
        const p = resultsLoading.querySelector('p');
        if (p) p.textContent = customText;
    } else {
        resultsLoading.style.display = 'none';
    }
}

function showError(msg) {
    errorMessage.innerHTML = maskSensitiveIdNumbers(msg);
    errorBanner.style.display = 'flex';
}

function clearError() {
    errorBanner.style.display = 'none';
    errorMessage.innerHTML = '';
}

function resetResultsUI() {
    resultsEmpty.style.display = 'block';
    resultsContent.style.display = 'none';
    resultsLoading.style.display = 'none';
    inferenceTimeBadge.style.display = 'none';
    if (typeof hideChatbotPanel === "function") {
        hideChatbotPanel();
    }
    clearError();
}
