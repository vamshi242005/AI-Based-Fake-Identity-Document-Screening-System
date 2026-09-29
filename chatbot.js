/**
 * Multimodal AI Security Chatbot Assistant (Powered by Google Gemini via Backend Proxy)
 * Activated ONLY when a document is classified as "FAKE"
 */

const BACKEND_API_URL = "http://localhost:5001/api/explain-fake";

// Chat State
let activeDocType = "Identity Document";
let activeConfidenceScore = "90%";
let chatHistory = [];
let isWaitingForAI = false;

// DOM Elements
const chatbotPanel = document.getElementById("chatbot-panel");
const chatMessagesContainer = document.getElementById("chat-messages");
const chatUserInput = document.getElementById("chat-user-input");
const chatSendBtn = document.getElementById("chat-send-btn");
const explainTriggerBtn = document.getElementById("explain-trigger-btn");

/**
 * Mask sensitive ID numbers in client UI
 */
function maskSensitiveIdNumbers(text) {
    if (!text || typeof text !== 'string') return text;
    // Mask 12-digit Aadhaar numbers: 1234 5678 9012 -> XXXX-XXXX-9012
    let masked = text.replace(/\b\d{4}\s?\d{4}\s?(\d{4})\b/g, 'XXXX-XXXX-$1');
    // Mask 10-char PAN numbers: ABCDE1234F -> XXXXX1234F
    masked = masked.replace(/\b[A-Z]{5}(\d{4}[A-Z])\b/g, 'XXXXX$1');
    return masked;
}

/**
 * Called by script.js when a classification result is produced.
 * Shows panel if FAKE, hides if ORIGINAL.
 */
function handleChatbotVisibility(verdictClass, docTypeLabel, confidencePercent) {
    if (verdictClass === "FAKE") {
        activeDocType = docTypeLabel || "Identity Document";
        activeConfidenceScore = confidencePercent || "90%";
        showChatbotPanel();
    } else {
        hideChatbotPanel();
    }
}

function showChatbotPanel() {
    if (!chatbotPanel) return;
    
    chatHistory = [];
    chatMessagesContainer.innerHTML = `
        <div class="chat-bubble bot-bubble hint-bubble" id="chat-hint">
            <i class="fa-solid fa-circle-info"></i> Click <strong>"Why was this flagged as fake?"</strong> above to generate an AI visual inspection report grounded in your uploaded document image.
            <div style="font-size: 0.78rem; color: #94a3b8; margin-top: 6px;">
                <i class="fa-solid fa-user-shield"></i> <em>Privacy notice: Your document image is processed in-memory by Google's Gemini Vision API for analysis.</em>
            </div>
        </div>
    `;
    
    if (explainTriggerBtn) {
        explainTriggerBtn.disabled = false;
        explainTriggerBtn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Why was this flagged as fake?`;
    }

    chatbotPanel.style.display = "block";
    chatbotPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hideChatbotPanel() {
    if (chatbotPanel) {
        chatbotPanel.style.display = "none";
    }
    chatHistory = [];
}

/**
 * Trigger initial AI multimodal explanation call
 */
async function requestFakeExplanation() {
    if (isWaitingForAI) return;
    
    const hintEl = document.getElementById("chat-hint");
    if (hintEl) hintEl.remove();

    if (explainTriggerBtn) {
        explainTriggerBtn.disabled = true;
        explainTriggerBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Inspecting Image Features...`;
    }

    const loadingId = appendLoadingBubble();
    isWaitingForAI = true;

    // Get current resized image payload
    const imgData = typeof getCurrentImageData === "function" ? getCurrentImageData() : null;

    try {
        const response = await fetch(BACKEND_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                docType: activeDocType,
                confidenceScore: activeConfidenceScore,
                image: imgData,
                chatHistory: []
            })
        });

        const data = await response.json();
        removeLoadingBubble(loadingId);

        if (response.ok && data.success) {
            const aiText = data.explanation;
            appendMessage("bot", aiText);
            
            chatHistory.push({ sender: "bot", text: aiText });

            if (explainTriggerBtn) {
                explainTriggerBtn.innerHTML = `<i class="fa-solid fa-circle-check"></i> Image Inspection Complete`;
            }
        } else {
            const errMsg = data.message || "Unable to retrieve explanation from Gemini Vision API.";
            appendErrorMessage(errMsg);
            if (explainTriggerBtn) explainTriggerBtn.disabled = false;
        }
    } catch (err) {
        console.error("Chatbot Fetch Error:", err);
        removeLoadingBubble(loadingId);
        appendErrorMessage(
            `Unable to connect to backend server at <code>${BACKEND_API_URL}</code>. Ensure server is running: <code>cd server && npm start</code>`
        );
        if (explainTriggerBtn) explainTriggerBtn.disabled = false;
    } finally {
        isWaitingForAI = false;
    }
}

/**
 * Handle user sending follow-up message in chat
 */
async function sendUserChatMessage() {
    if (isWaitingForAI) return;

    const messageText = chatUserInput.value.trim();
    if (!messageText) return;

    chatUserInput.value = "";

    appendMessage("user", messageText);
    chatHistory.push({ sender: "user", text: messageText });

    const loadingId = appendLoadingBubble();
    isWaitingForAI = true;

    const imgData = typeof getCurrentImageData === "function" ? getCurrentImageData() : null;

    try {
        const response = await fetch("http://localhost:5001/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                docType: activeDocType,
                confidenceScore: activeConfidenceScore,
                image: imgData,
                chatHistory: chatHistory,
                userMessage: messageText
            })
        });

        const data = await response.json();
        removeLoadingBubble(loadingId);

        if (response.ok && data.success) {
            const aiText = data.explanation;
            appendMessage("bot", aiText);
            chatHistory.push({ sender: "bot", text: aiText });
        } else {
            appendErrorMessage(data.message || "Failed to process follow-up query.");
        }
    } catch (err) {
        console.error("Chatbot Fetch Error:", err);
        removeLoadingBubble(loadingId);
        appendErrorMessage("Network error connecting to AI server. Check backend connection.");
    } finally {
        isWaitingForAI = false;
    }
}

function handleChatKeyPress(e) {
    if (e.key === "Enter") {
        sendUserChatMessage();
    }
}

/* ==========================================================================
   Chat Bubble DOM Helpers
   ========================================================================== */
function appendMessage(sender, text) {
    const bubbleWrapper = document.createElement("div");
    bubbleWrapper.className = `chat-bubble ${sender}-bubble`;

    const avatar = document.createElement("div");
    avatar.className = "chat-avatar";
    avatar.innerHTML = sender === "bot" 
        ? `<i class="fa-solid fa-robot"></i>`
        : `<i class="fa-solid fa-user"></i>`;

    const content = document.createElement("div");
    content.className = "chat-text";
    content.innerHTML = formatMarkdownResponse(maskSensitiveIdNumbers(text));

    bubbleWrapper.appendChild(avatar);
    bubbleWrapper.appendChild(content);

    chatMessagesContainer.appendChild(bubbleWrapper);
    scrollToBottom();
}

function appendLoadingBubble() {
    const id = "loading-" + Date.now();
    const bubbleWrapper = document.createElement("div");
    bubbleWrapper.className = "chat-bubble bot-bubble loading-bubble";
    bubbleWrapper.id = id;

    bubbleWrapper.innerHTML = `
        <div class="chat-avatar"><i class="fa-solid fa-robot"></i></div>
        <div class="chat-text">
            <div class="chat-typing-dots">
                <span></span><span></span><span></span>
            </div>
        </div>
    `;

    chatMessagesContainer.appendChild(bubbleWrapper);
    scrollToBottom();
    return id;
}

function removeLoadingBubble(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

function appendErrorMessage(msg) {
    const bubbleWrapper = document.createElement("div");
    bubbleWrapper.className = "chat-bubble bot-bubble error-bubble";

    bubbleWrapper.innerHTML = `
        <div class="chat-avatar"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <div class="chat-text">${msg}</div>
    `;

    chatMessagesContainer.appendChild(bubbleWrapper);
    scrollToBottom();
}

function scrollToBottom() {
    if (chatMessagesContainer) {
        chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    }
}

/**
 * Markdown formatting helper for AI text responses
 */
function formatMarkdownResponse(text) {
    if (!text) return "";
    let html = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // Bold headings & subheadings
    html = html.replace(/^### (.*$)/gim, '<strong>$1</strong>');
    html = html.replace(/^## (.*$)/gim, '<strong>$1</strong>');
    
    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Bullet lists
    html = html.replace(/^\s*[\-\*•]\s+(.*$)/gim, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/gim, '<ul>$1</ul>');
    html = html.replace(/<\/ul>\s*<ul>/g, '');

    // Paragraph linebreaks
    html = html.replace(/\n\n/g, '<br><br>');
    html = html.replace(/\n/g, '<br>');

    return html;
}
