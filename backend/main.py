"""
Real-Time Sales Coaching Backend — FastAPI Application

Endpoints:
  - GET  /health            — Health check
  - GET  /api/playbook      — Get sales playbook
  - GET  /api/objections    — Get objection scripts
  - GET  /api/rag/stats     — RAG collection stats
  - POST /api/rag/ingest    — Trigger document ingestion
  - POST /api/rag/search    — Search RAG knowledge base
  - WS   /ws/coaching       — Main real-time coaching pipeline
  - WS   /ws/demo           — Demo mode with simulated call
"""

import json
import asyncio
import logging
import time
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import settings, DATA_DIR
from stt_engine import STTEngine
from rag_engine import RAGEngine
from ai_coach import AICoach

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger(__name__)


# --- Application Lifespan ---

rag_engine = RAGEngine()
stt_engine: STTEngine | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize services on startup, cleanup on shutdown."""
    global stt_engine

    logger.info("🚀 Starting Real-Time Sales Coaching Backend...")

    # Initialize RAG engine and ingest data
    rag_engine.initialize()
    if rag_engine.get_stats()["total_documents"] == 0:
        logger.info("📚 No documents in RAG. Running initial ingestion...")
        rag_engine.ingest_all_data()

    # Initialize STT engine
    stt_engine = STTEngine()
    await stt_engine.initialize()

    logger.info("✅ All systems ready!")
    logger.info(f"   STT Provider: {settings.STT_PROVIDER}")
    logger.info(f"   LLM: {settings.LLM_MODEL} @ {settings.LLM_BASE_URL}")
    logger.info(f"   RAG Docs: {rag_engine.get_stats()['total_documents']}")

    yield

    # Cleanup
    if stt_engine:
        await stt_engine.cleanup()
    logger.info("👋 Backend shutdown complete")


# --- FastAPI App ---

app = FastAPI(
    title="Real-Time Sales Coaching API",
    description="AI-powered real-time sales coaching with STT and RAG",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- REST Endpoints ---

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "stt_provider": settings.STT_PROVIDER,
        "llm_model": settings.LLM_MODEL,
        "rag_documents": rag_engine.get_stats()["total_documents"],
    }


@app.get("/api/playbook")
async def get_playbook():
    """Get the sales playbook data."""
    playbook_path = DATA_DIR / "sales_playbook.json"
    if not playbook_path.exists():
        raise HTTPException(status_code=404, detail="Playbook not found")
    with open(playbook_path, "r") as f:
        return json.load(f)


@app.get("/api/objections")
async def get_objections():
    """Get the objection handling scripts."""
    objections_path = DATA_DIR / "objection_scripts.json"
    if not objections_path.exists():
        raise HTTPException(status_code=404, detail="Objection scripts not found")
    with open(objections_path, "r") as f:
        return json.load(f)


@app.get("/api/rag/stats")
async def get_rag_stats():
    """Get RAG collection statistics."""
    return rag_engine.get_stats()


class SearchRequest(BaseModel):
    query: str
    top_k: int = 5
    source_type: str | None = None


@app.post("/api/rag/search")
async def search_rag(request: SearchRequest):
    """Search the RAG knowledge base."""
    results = rag_engine.search(
        query=request.query,
        top_k=request.top_k,
        source_type=request.source_type,
    )
    return {"results": results, "count": len(results)}


@app.post("/api/rag/ingest")
async def ingest_documents():
    """Trigger document re-ingestion."""
    rag_engine.clear()
    rag_engine.ingest_all_data()
    return {
        "status": "success",
        "documents_ingested": rag_engine.get_stats()["total_documents"],
    }


# --- WebSocket: Main Coaching Pipeline ---

@app.websocket("/ws/coaching")
async def coaching_websocket(websocket: WebSocket):
    """
    Main real-time coaching WebSocket.

    Protocol:
      Client → Server:
        {"type": "audio", "data": "<base64 PCM audio>"}
        {"type": "config", "language": "en"}
        {"type": "reset"}

      Server → Client:
        {"type": "transcript", "text": "...", "timestamp": 1234}
        {"type": "coaching", "data": {...}, "streaming": false}
        {"type": "coaching_stream", "chunk": "...", "done": false}
        {"type": "status", "state": "listening|processing|ready"}
        {"type": "error", "message": "..."}
    """
    await websocket.accept()
    logger.info("🔌 Coaching WebSocket connected")

    ai_coach = AICoach(rag_engine)
    language = settings.STT_LANGUAGE
    coaching_task: asyncio.Task | None = None

    async def send_json(data: dict):
        try:
            await websocket.send_json(data)
        except Exception:
            pass

    await send_json({"type": "status", "state": "ready"})

    try:
        while True:
            raw = await websocket.receive_text()
            message = json.loads(raw)
            msg_type = message.get("type")

            if msg_type == "config":
                language = message.get("language", language)
                ai_coach.reset()
                stt_engine.reset_buffer()
                await send_json({"type": "status", "state": "ready"})
                logger.info(f"Config updated: language={language}")

            elif msg_type == "reset":
                ai_coach.reset()
                stt_engine.reset_buffer()
                await send_json({"type": "status", "state": "ready"})
                logger.info("Session reset")

            elif msg_type == "audio":
                audio_data = message.get("data", "")
                if not audio_data:
                    continue

                await send_json({"type": "status", "state": "processing"})

                # Transcribe
                segments = await stt_engine.process_audio_chunk(
                    audio_data, language=language
                )

                if segments:
                    for segment in segments:
                        transcript_text = segment.text

                        # Send transcript to client
                        await send_json({
                            "type": "transcript",
                            "text": transcript_text,
                            "timestamp": segment.timestamp,
                            "language": segment.language,
                        })

                        # Cancel any pending coaching task
                        if coaching_task and not coaching_task.done():
                            coaching_task.cancel()

                        # Get AI coaching (streaming)
                        async def stream_coaching(text: str):
                            try:
                                full_response = ""
                                async for chunk in ai_coach.get_coaching(text):
                                    full_response += chunk
                                    await send_json({
                                        "type": "coaching_stream",
                                        "chunk": chunk,
                                        "done": False,
                                    })

                                # Parse the full response and send as structured data
                                try:
                                    json_str = full_response
                                    if "```json" in json_str:
                                        json_str = json_str.split("```json")[1].split("```")[0]
                                    elif "```" in json_str:
                                        json_str = json_str.split("```")[1].split("```")[0]
                                    parsed = json.loads(json_str.strip())
                                except (json.JSONDecodeError, IndexError):
                                    parsed = {
                                        "type": "tip",
                                        "priority": "medium",
                                        "title": "Coaching Tip",
                                        "suggestion": full_response[:300],
                                        "script": "",
                                    }

                                await send_json({
                                    "type": "coaching",
                                    "data": parsed,
                                    "streaming": False,
                                })
                                await send_json({
                                    "type": "coaching_stream",
                                    "chunk": "",
                                    "done": True,
                                })
                            except asyncio.CancelledError:
                                pass
                            except Exception as e:
                                logger.error(f"Coaching error: {e}")
                                await send_json({
                                    "type": "error",
                                    "message": str(e)[:200],
                                })

                        coaching_task = asyncio.create_task(
                            stream_coaching(transcript_text)
                        )

                await send_json({"type": "status", "state": "listening"})

    except WebSocketDisconnect:
        logger.info("🔌 Coaching WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        await send_json({"type": "error", "message": str(e)[:200]})


# --- WebSocket: Demo Mode ---

@app.websocket("/ws/demo")
async def demo_websocket(websocket: WebSocket):
    """
    Demo mode WebSocket — simulates a sales call using pre-recorded transcript.
    Plays back the demo transcript with realistic timing and generates
    AI coaching suggestions for each segment.
    """
    await websocket.accept()
    logger.info("🎬 Demo WebSocket connected")

    ai_coach = AICoach(rag_engine)

    # Load demo transcript
    demo_path = DATA_DIR / "demo_transcript.json"
    if not demo_path.exists():
        await websocket.send_json({
            "type": "error",
            "message": "Demo transcript not found",
        })
        await websocket.close()
        return

    with open(demo_path, "r") as f:
        demo_data = json.load(f)

    segments = demo_data.get("segments", [])
    speed = settings.DEMO_SPEED

    async def send_json(data: dict):
        try:
            await websocket.send_json(data)
        except Exception:
            pass

    await send_json({
        "type": "status",
        "state": "ready",
        "demo": True,
        "total_segments": len(segments),
    })

    try:
        # Wait for start signal
        raw = await websocket.receive_text()
        start_msg = json.loads(raw)

        if start_msg.get("type") == "start":
            speed = start_msg.get("speed", speed)
            await send_json({"type": "status", "state": "playing"})

            for i, segment in enumerate(segments):
                # Wait for realistic timing
                delay = segment.get("delay_ms", 2000) / 1000.0 / speed
                await asyncio.sleep(delay)

                # Send transcript
                await send_json({
                    "type": "transcript",
                    "text": segment["text"],
                    "speaker": segment.get("speaker", "unknown"),
                    "timestamp": segment.get("timestamp", time.time()),
                    "segment_index": i,
                    "total_segments": len(segments),
                })

                # Generate AI coaching for prospect's speech
                if segment.get("speaker") == "prospect":
                    try:
                        full_response = ""
                        async for chunk in ai_coach.get_coaching(segment["text"]):
                            full_response += chunk
                            await send_json({
                                "type": "coaching_stream",
                                "chunk": chunk,
                                "done": False,
                            })

                        # Parse coaching response
                        try:
                            json_str = full_response
                            if "```json" in json_str:
                                json_str = json_str.split("```json")[1].split("```")[0]
                            elif "```" in json_str:
                                json_str = json_str.split("```")[1].split("```")[0]
                            parsed = json.loads(json_str.strip())
                        except (json.JSONDecodeError, IndexError):
                            parsed = {
                                "type": "tip",
                                "priority": "medium",
                                "title": "Coaching Tip",
                                "suggestion": full_response[:300],
                                "script": "",
                            }

                        await send_json({
                            "type": "coaching",
                            "data": parsed,
                            "streaming": False,
                        })
                        await send_json({
                            "type": "coaching_stream",
                            "chunk": "",
                            "done": True,
                        })
                    except Exception as e:
                        logger.error(f"Demo coaching error: {e}")

            # Demo complete
            await send_json({
                "type": "status",
                "state": "completed",
                "message": "Demo call simulation complete",
            })

    except WebSocketDisconnect:
        logger.info("🎬 Demo WebSocket disconnected")
    except Exception as e:
        logger.error(f"Demo WebSocket error: {e}")


# --- Entry Point ---

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=True,
        log_level="info",
    )
