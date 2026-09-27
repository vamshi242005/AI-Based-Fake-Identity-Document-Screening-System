# AI-Based Fake Identity Document Screening System

A modern, privacy-focused, real-time web application for screening and detecting fake identity documents (such as **Aadhaar Cards** and **PAN Cards**) using computer vision and machine learning models powered by **TensorFlow.js** and **Teachable Machine**.

---

## 🌟 Key Features

- 📄 **Multi-Document Verification Engine**:
  - Support for **Aadhaar Card** verification model (`/model-aadhaar`).
  - Support for **PAN Card** verification model (`/model-pancard`).
  - Modular architecture making it easy to add future document types.

- ⚡ **Real-Time Client-Side Inference**:
  - Zero server-side image processing — models run directly in the browser via WebGL/TensorFlow.js for maximum performance and privacy.
  - Model caching in memory so switching document types incurs no reload latency.

- 📸 **Flexible Input Modes**:
  - **Drag & Drop / File Browser**: Supports JPG, PNG, WEBP.
  - **Live Webcam Integration**: Start camera, capture instant snapshots, or run real-time live classification loops.

- 🔐 **Authentication & Session Protection**:
  - Modern, responsive **Login & Registration UI** (`login.html`).
  - Local authentication & session guard (`sessionStorage` & `localStorage`).
  - Pre-seeded demo credentials for instant testing (`admin@example.com` / `password123`).
  - Clear backend API integration placeholders for production deployment.

- 🎨 **Modern Glassmorphic UI/UX**:
  - Color-coded verdict badges: **ORIGINAL** (emerald green glow) vs **FAKE** (rose red glow).
  - Confidence percentage progress bars for every predicted class.
  - Performance badge showing inference latency in milliseconds.

---

## 📁 Repository Structure

```
├── model-aadhaar/             # Teachable Machine model for Aadhaar Card classification
│   ├── model.json
│   ├── weights.bin
│   └── metadata.json
├── model-pancard/             # Teachable Machine model for PAN Card classification
│   ├── model.json
│   ├── weights.bin
│   └── metadata.json
├── index.html                 # Main verification portal dashboard
├── script.js                  # Model loading, prediction pipeline & webcam handlers
├── style.css                  # Shared glassmorphic responsive stylesheet
├── login.html                 # Authentication entry point
├── login.js                   # Authentication logic & session guards
└── README.md                  # Project documentation
```

---

## 🚀 Quick Start Guide

Because local models are loaded via relative fetch requests (`./model-aadhaar/model.json`), serve the repository using a local HTTP server:

### Option 1: Python (Built-in)
```bash
python -m http.server 5000
```
Open **[http://localhost:5000/login.html](http://localhost:5000/login.html)** in your browser.

### Option 2: Node.js / npx
```bash
npx serve .
```

---

## 🔑 Demo Credentials

- **Email**: `admin@example.com`
- **Password**: `password123`

*(You can also click the **Register** tab on `login.html` to create a new local account).*

---

## 🛠️ Built With

- **HTML5 / CSS3 / JavaScript (ES6+)**
- **[TensorFlow.js](https://www.tensorflow.org/js)** (CDN)
- **[@teachablemachine/image](https://github.com/googlecreativelab/teachablemachine-community)** (CDN)
- **FontAwesome 6** & **Inter Font**
