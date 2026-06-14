# 🎯 SalesCoach AI — Real-Time Sales Enablement Tool

> AI-powered real-time sales coaching dashboard with live speech-to-text transcription, intelligent objection handling, and RAG-based knowledge retrieval.

![Architecture](https://img.shields.io/badge/Architecture-FastAPI%20%2B%20React%20%2B%20WebSocket-blue)
![STT](https://img.shields.io/badge/STT-faster--whisper-green)
![LLM](https://img.shields.io/badge/LLM-Ollama%20%7C%20OpenAI-purple)
![RAG](https://img.shields.io/badge/RAG-ChromaDB-orange)

## 🏗️ Architecture

```
Browser Mic → WebSocket → FastAPI → faster-whisper (STT) → ChromaDB (RAG) → Ollama/OpenAI (LLM) → React Dashboard
```

| Component | Technology | Swappable To |
|:----------|:-----------|:-------------|
| Frontend | React + Vite + Tailwind CSS | - |
| Backend | FastAPI + WebSockets | - |
| STT | faster-whisper (local) | Deepgram, AssemblyAI, Google Cloud STT |
| LLM | Ollama (local, free) | OpenAI GPT-4o (1-line config change) |
| RAG | ChromaDB + sentence-transformers | - |
| Audio | Browser MediaRecorder API | - |

## 🚀 Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+
- Ollama (https://ollama.com)

### 1. Install Ollama & Pull a Model

```bash
# Install Ollama (Linux)
curl -fsSL https://ollama.com/install.sh | sh

# Pull the LLM model
ollama pull llama3.2
```

### 2. Start the Backend

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Linux/Mac
# venv\Scripts\activate   # Windows

# Install dependencies
pip install -r requirements.txt

# Copy env config
cp .env.example .env

# Start the server
python main.py
# or: uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 3. Start the Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

### 4. Open the Dashboard

Visit **http://localhost:5173** in your browser.

## 🎬 Demo Mode

Click **"▶ Demo Mode"** in the dashboard to simulate a complete sales call with:
- A realistic conversation between a sales rep and prospect
- Live AI coaching suggestions for each prospect response
- Objection detection and handling scripts
- Closing opportunity alerts

No microphone required — perfect for showcasing.

## ⚙️ Configuration

All settings are controlled via environment variables. See `.env.example`:

### Switch to OpenAI
```env
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-your-key-here
LLM_MODEL=gpt-4o
```

### Switch to Deepgram STT
```env
STT_PROVIDER=deepgram
DEEPGRAM_API_KEY=your-key-here
```

### Enable Hebrew
```env
STT_LANGUAGE=he
```

## 📚 Adding Your Own Sales Data

Place your sales playbooks, objection scripts, and training documents in `backend/data/`:

- **JSON files**: Automatically parsed and chunked for RAG
- **Text/Markdown files**: Split into chunks and indexed

Then re-ingest:
```bash
cd backend
python ingest.py --clear
```

## 🔑 Key Features

- **Real-time STT**: Live speech-to-text with faster-whisper (supports 100+ languages)
- **AI Coaching**: Streaming coaching suggestions powered by LLM
- **RAG Knowledge Base**: Semantic search over thousands of sales documents
- **Objection Detection**: Automatic detection of customer objections with scripted responses
- **RTL Support**: Full right-to-left layout for Hebrew
- **Demo Mode**: Pre-built sales call simulation for showcasing
- **Pluggable Architecture**: Swap STT/LLM providers with a config change
