/**
 * AI-Based Fake Identity Document Screening System
 * Client-Side Application Logic & API Communication
 */

// SESSION GUARD: Protect route if user is not authenticated
(function checkSession() {
    if (sessionStorage.getItem("isLoggedIn") !== "true") {
        window.location.href = "login.html";
    }
})();

// Document Configuration Registry
const DOC_CONFIGS = {
    aadhaar: {
        id: "aadhaar",
        label: "Aadhaar Card",
        icon: "fa-address-card",
        title: "Aadhaar Card Verification"
    },
    pan: {
        id: "pan",
        label: "PAN Card",
        icon: "fa-id-card",
        title: "PAN Card Verification"
    },
    pancard: {
        id: "pan",
        label: "PAN Card",
        icon: "fa-id-card",
        title: "PAN Card Verification"
    },
    passport: {
        id: "passport",
        label: "Passport",
        icon: "fa-passport",
        title: "Passport Verification"
    },
    voter_id: {
        id: "voter_id",
        label: "Voter ID Card",
        icon: "fa-check-to-slot",
        title: "Voter ID Verification"
    },
    voterid: {
        id: "voter_id",
        label: "Voter ID Card",
        icon: "fa-check-to-slot",
        title: "Voter ID Verification"
    }
};

// Application State
let currentDocType = "aadhaar";
let webcamStream = null;
let activeBase64Image = null;

// DOM Element References
const docMismatchBanner = document.getElementById("doc-mismatch-banner");
const mismatchBannerText = document.getElementById("mismatch-banner-text");
const uploadInlineError = document.getElementById("upload-inline-error");
const uploadInlineErrorText = document.getElementById("upload-inline-error-text");

const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");

const webcamVideo = document.getElementById("webcam-video");
const webcamOverlay = document.getElementById("webcam-overlay");
const startWebcamBtn = document.getElementById("start-webcam-btn");
const stopWebcamBtn = document.getElementById("stop-webcam-btn");
const captureWebcamBtn = document.getElementById("capture-webcam-btn");

const previewCard = document.getElementById("preview-card");
const previewImage = document.getElementById("preview-image");
const imageInfoName = document.getElementById("image-info-name");

const docResultIcon = document.getElementById("doc-result-icon");
const docResultTitle = document.getElementById("doc-result-title");

const resultsEmpty = document.getElementById("results-empty");
const resultsLoading = document.getElementById("results-loading");
const resultsLoadingText = document.getElementById("results-loading-text");
const resultsContent = document.getElementById("results-content");

const errorBanner = document.getElementById("error-banner");
const errorMessage = document.getElementById("error-message");

const verdictCard = document.getElementById("verdict-card");
const verdictIcon = document.getElementById("verdict-icon");
const verdictStatusBadge = document.getElementById("verdict-status-badge");
const verdictDesc = document.getElementById("verdict-desc");
const verdictTopScore = document.getElementById("verdict-top-score");

const summaryText = document.getElementById("summary-text");
const fieldName = document.getElementById("field-name");
const fieldIdNumber = document.getElementById("field-id-number");
const fieldDob = document.getElementById("field-dob");

const whyFlaggedSection = document.getElementById("why-flagged-section");
const reasonsList = document.getElementById("reasons-list");
const userDisplayName = document.getElementById("user-display-name");

// Initialization
document.addEventListener("DOMContentLoaded", () => {
    const currentUser = sessionStorage.getItem("currentUser") || "User";
    if (userDisplayName) {
        userDisplayName.textContent = currentUser;
    }

    setupDropZone();
    setupFileInput();
});

// Logout Helper
function logout() {
    sessionStorage.removeItem("isLoggedIn");
    sessionStorage.removeItem("currentUser");
    sessionStorage.removeItem("currentUserEmail");
    window.location.href = "login.html";
}

/**
 * Select Expected Document Type
 */
function selectDocumentType(docTypeId) {
    let normId = docTypeId;
    if (normId === "pancard") normId = "pan";
    if (normId === "voterid") normId = "voter_id";

    currentDocType = normId;

    // Update active tab buttons
    document.querySelectorAll(".doc-btn").forEach(btn => btn.classList.remove("active"));
    const activeBtn = document.getElementById(`doc-${normId}-btn`);
    if (activeBtn) activeBtn.classList.add("active");

    // Update Result Banner Info
    const config = DOC_CONFIGS[normId] || DOC_CONFIGS.aadhaar;
    if (docResultIcon) docResultIcon.className = `fa-solid ${config.icon}`;
    if (docResultTitle) docResultTitle.textContent = config.title;

    clearMismatchAlerts();
    clearError();

    // Re-verify active preview image if present
    if (activeBase64Image && previewCard.style.display !== 'none') {
        classifyActiveImage();
    }
}

/**
 * Tab Switching (Upload vs Webcam)
 */
function switchTab(tabName) {
    document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
    const tabBtn = document.getElementById(`tab-${tabName}-btn`);
    if (tabBtn) tabBtn.classList.add("active");

    document.querySelectorAll(".tab-content").forEach(content => content.classList.remove("active"));
    const contentBox = document.getElementById(`${tabName}-tab`);
    if (contentBox) contentBox.classList.add("active");

    if (tabName !== "webcam" && webcamStream) {
        stopWebcam();
    }
}

/**
 * File Upload & Drag-and-Drop Handlers
 */
function setupDropZone() {
    if (!dropZone) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
    });

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length > 0) {
            handleSelectedFile(dt.files[0]);
        }
    });
}

function setupFileInput() {
    if (!fileInput) return;
    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            handleSelectedFile(e.target.files[0]);
        }
    });
}

/**
 * Client-Side File Validation & Handling
 */
function handleSelectedFile(file) {
    clearMismatchAlerts();
    clearError();

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(file.type.toLowerCase())) {
        showMismatchAlert(`Invalid file format '${file.type || 'unknown'}'. Please upload a JPG, PNG, WEBP, or PDF document.`);
        clearSelectedImage();
        return;
    }

    const sizeInMB = file.size / (1024 * 1024);
    if (sizeInMB > 10.0) {
        showMismatchAlert(`File size (${sizeInMB.toFixed(2)} MB) exceeds maximum limit of 10 MB. Please upload a smaller file.`);
        clearSelectedImage();
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        activeBase64Image = e.target.result;
        previewImage.src = e.target.result;
        imageInfoName.textContent = `${file.name} (${sizeInMB < 1 ? (file.size / 1024).toFixed(1) + ' KB' : sizeInMB.toFixed(2) + ' MB'})`;
        previewCard.style.display = 'block';

        // Auto verify on upload
        classifyActiveImage();
    };
    reader.readAsDataURL(file);
}

function clearSelectedImage() {
    activeBase64Image = null;
    previewImage.src = '';
    if (fileInput) fileInput.value = '';
    previewCard.style.display = 'none';
    resetResultsUI();
}

/**
 * Webcam Controls
 */
async function startWebcam() {
    clearError();
    clearMismatchAlerts();
    try {
        const constraints = { video: { width: { ideal: 640 }, height: { ideal: 480 } } };
        webcamStream = await navigator.mediaDevices.getUserMedia(constraints);
        webcamVideo.srcObject = webcamStream;
        webcamOverlay.style.display = 'none';

        startWebcamBtn.disabled = true;
        stopWebcamBtn.disabled = false;
        captureWebcamBtn.disabled = false;
    } catch (err) {
        showError("Camera access denied or unreadable. Please check browser camera permissions.");
    }
}

function stopWebcam() {
    if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
        webcamStream = null;
    }
    webcamVideo.srcObject = null;
    webcamOverlay.style.display = 'flex';

    startWebcamBtn.disabled = false;
    stopWebcamBtn.disabled = true;
    captureWebcamBtn.disabled = true;
}

function captureWebcamImage() {
    if (!webcamStream) return;
    const canvas = document.getElementById("hidden-canvas");
    const ctx = canvas.getContext("2d");

    canvas.width = webcamVideo.videoWidth || 640;
    canvas.height = webcamVideo.videoHeight || 480;
    ctx.drawImage(webcamVideo, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL("image/jpeg");
    activeBase64Image = dataUrl;
    previewImage.src = dataUrl;
    imageInfoName.textContent = "Webcam Snapshot (" + new Date().toLocaleTimeString() + ")";
    previewCard.style.display = 'block';

    classifyActiveImage();
}

/**
 * Main API Caller for Verification Assessment
 */
async function classifyActiveImage() {
    if (!activeBase64Image) {
        showError("Please upload or capture a document image first.");
        return;
    }

    clearMismatchAlerts();
    clearError();
    showLoading(true, `Verifying document type & checking authenticity for ${DOC_CONFIGS[currentDocType]?.label || currentDocType}...`);

    try {
        const response = await fetch("http://localhost:5001/api/verify-document", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                expected_type: currentDocType,
                image: activeBase64Image
            })
        });

        const data = await response.json();
        showLoading(false);

        // =========================================================================
        // HANDLE HTTP 422: DOCUMENT TYPE MISMATCH REJECTION GATE
        // =========================================================================
        if (response.status === 422 || (data && data.status === "wrong_document")) {
            const mismatchMessage = data.message || "Document type mismatch detected. Please upload the correct file.";

            // Show Toast Alert Banner & Inline Error Message
            showMismatchAlert(mismatchMessage);

            // Clear file input & image preview
            if (fileInput) fileInput.value = '';
            previewImage.src = '';
            activeBase64Image = null;
            previewCard.style.display = 'none';

            // Reset results UI (DO NOT display any score)
            resetResultsUI();
            return;
        }

        // =========================================================================
        // HANDLE HTTP 200: AUTHENTICITY ASSESSMENT SUCCESS
        // =========================================================================
        if (response.ok && data && (data.status === "verified" || data.status === "suspicious" || data.status === "fake")) {
            displayVerificationResults(data);
        } else {
            const errText = data.message || "Unable to complete document verification.";
            showError(errText);
            resetResultsUI();
        }

    } catch (err) {
        showLoading(false);
        console.error("Verification API Network Exception:", err);
        showError("Cannot connect to Document Verification Backend Proxy (http://localhost:5001). Please ensure the backend server is running.");
        resetResultsUI();
    }
}

/**
 * Renders Verification Results
 */
function displayVerificationResults(data) {
    resultsEmpty.style.display = 'none';
    resultsContent.style.display = 'block';

    const status = (data.status || "verified").toLowerCase();
    const score = typeof data.confidence_score === 'number' ? data.confidence_score : 90;
    const reasons = Array.isArray(data.reasons) ? data.reasons : [];
    const fields = data.extracted_fields || {};
    const summary = data.summary || "Document analysis complete.";

    // Render Verdict Card & Badge
    verdictCard.className = "verdict-card";
    if (status === "verified") {
        verdictCard.classList.add("verdict-original");
        verdictIcon.className = "fa-solid fa-circle-check";
        verdictStatusBadge.className = "verdict-status-badge badge-verified";
        verdictStatusBadge.textContent = "VERIFIED";
        verdictDesc.textContent = "Document format and security indicators pass authenticity checks.";
    } else if (status === "suspicious") {
        verdictCard.classList.add("verdict-suspicious");
        verdictIcon.className = "fa-solid fa-triangle-exclamation";
        verdictStatusBadge.className = "verdict-status-badge badge-suspicious";
        verdictStatusBadge.textContent = "SUSPICIOUS";
        verdictDesc.textContent = "Visual or field anomalies detected. Manual review recommended.";
    } else {
        verdictCard.classList.add("verdict-fake");
        verdictIcon.className = "fa-solid fa-circle-xmark";
        verdictStatusBadge.className = "verdict-status-badge badge-fake";
        verdictStatusBadge.textContent = "FAKE / FRAUDULENT";
        verdictDesc.textContent = "High severity visual or structural tamper red flags detected.";
    }

    verdictTopScore.textContent = `${score}%`;
    summaryText.textContent = summary;

    // Render Extracted Fields
    fieldName.textContent = fields.name || "N/A";
    fieldIdNumber.textContent = fields.id_number || "N/A";
    fieldDob.textContent = fields.dob || "N/A";

    // Render "Why was this flagged?" Section (for suspicious/fake or whenever reasons exist)
    if ((status === "suspicious" || status === "fake" || reasons.length > 0) && whyFlaggedSection && reasonsList) {
        whyFlaggedSection.style.display = 'block';
        reasonsList.innerHTML = reasons.map(r => {
            const catLabel = formatCategoryLabel(r.category);
            const severityClass = r.severity === 'high' ? 'severity-high' : (r.severity === 'medium' ? 'severity-medium' : 'severity-low');
            const severityText = (r.severity || 'medium').toUpperCase();

            return `
                <div class="reason-item ${severityClass}">
                    <div class="reason-header">
                        <span class="category-badge"><i class="fa-solid fa-tag"></i> ${catLabel}</span>
                        <span class="severity-pill ${severityClass}">${severityText} SEVERITY</span>
                    </div>
                    <p class="reason-finding">${r.finding || 'Anomalous document feature detected.'}</p>
                </div>
            `;
        }).join('');
    } else if (whyFlaggedSection) {
        whyFlaggedSection.style.display = 'none';
    }
}

function formatCategoryLabel(cat) {
    if (!cat) return "Security Feature";
    const map = {
        font: "Font & Typography",
        layout: "Layout & Format",
        photo: "Photo & Edge Integrity",
        hologram_qr: "Hologram / QR Code",
        number_format: "ID Number Format",
        text_consistency: "Text Consistency",
        image_quality: "Image Quality",
        metadata: "File Metadata"
    };
    return map[cat.toLowerCase()] || cat.replace(/_/g, ' ').toUpperCase();
}

/**
 * UI Alert & Error State Helpers
 */
function showMismatchAlert(msg) {
    if (docMismatchBanner && mismatchBannerText) {
        mismatchBannerText.textContent = msg;
        docMismatchBanner.style.display = 'flex';
    }
    if (uploadInlineError && uploadInlineErrorText) {
        uploadInlineErrorText.textContent = msg;
        uploadInlineError.style.display = 'flex';
    }
}

function clearMismatchAlerts() {
    if (docMismatchBanner) docMismatchBanner.style.display = 'none';
    if (uploadInlineError) uploadInlineError.style.display = 'none';
}

function showLoading(isLoading, text = "Analyzing document features...") {
    if (isLoading) {
        resultsEmpty.style.display = 'none';
        resultsContent.style.display = 'none';
        resultsLoading.style.display = 'block';
        if (resultsLoadingText) resultsLoadingText.textContent = text;
    } else {
        resultsLoading.style.display = 'none';
    }
}

function showError(msg) {
    if (errorMessage && errorBanner) {
        errorMessage.textContent = msg;
        errorBanner.style.display = 'flex';
    }
}

function clearError() {
    if (errorBanner) errorBanner.style.display = 'none';
}

function resetResultsUI() {
    resultsEmpty.style.display = 'block';
    resultsContent.style.display = 'none';
    resultsLoading.style.display = 'none';
    clearError();
}
