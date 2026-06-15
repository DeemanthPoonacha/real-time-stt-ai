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
import hashlib
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
import httpx

from config import settings, DATA_DIR
from stt_engine import STTEngine
from rag_engine import RAGEngine
from ai_coach import AICoach
from data.prompts import PROSPECT_SYSTEM_PROMPT

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger(__name__)


# --- Application Lifespan ---

rag_engine = RAGEngine()
stt_engine: STTEngine | None = None


async def pre_cache_demo_transcripts():
    """Pre-cache TTS audio files for static demo transcripts to eliminate startup latency."""
    import edge_tts

    logger.info("🎙️ Starting background demo transcript pre-caching...")
    langs_to_cache = ["en", "he"]
    for lang in langs_to_cache:
        file_name = "demo_transcript_he.json" if lang == "he" else "demo_transcript.json"
        demo_path = DATA_DIR / file_name
        if not demo_path.exists():
            continue
        try:
            with open(demo_path, "r", encoding="utf-8") as f:
                demo_data = json.load(f)
            segments = demo_data.get("segments", [])
            for index, segment in enumerate(segments):
                text = segment.get("text", "").strip()
                speaker = segment.get("speaker", "unknown")
                if not text:
                    continue

                # Check cache first
                cache_str = f"{lang}:{speaker}:{text}"
                cache_key = hashlib.md5(cache_str.encode("utf-8")).hexdigest()
                cache_file = TTS_CACHE_DIR / f"{lang}_{index}_{text[:10].replace(' ', '_')}_{cache_key}.mp3"
                if cache_file.exists() and cache_file.stat().st_size > 0:
                    continue

                # Determine voice
                if lang == "he":
                    voice = "he-IL-AvriNeural" if speaker == "rep" else "he-IL-HilaNeural"
                else:
                    voice = "en-US-GuyNeural" if speaker == "rep" else "en-US-AvaNeural"

                try:
                    logger.info(f"Pre-caching static TTS: lang={lang}, speaker={speaker}, text='{text[:20]}...'")
                    communicate = edge_tts.Communicate(text, voice)
                    await communicate.save(str(cache_file))
                except Exception as e:
                    logger.warning(f"Failed to pre-cache segment for {lang}: {e}")
        except Exception as e:
            logger.error(f"Error loading demo transcript for pre-caching ({lang}): {e}")

    logger.info("✅ Background demo transcript pre-caching complete!")


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

    # Pre-cache static demo transcripts in background
    # asyncio.create_task(pre_cache_demo_transcripts())

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
async def get_playbook(language: str = "en"):
    """Get the sales playbook data."""
    file_name = "sales_playbook_he.json" if language == "he" else "sales_playbook.json"
    playbook_path = DATA_DIR / file_name
    if not playbook_path.exists():
        raise HTTPException(status_code=404, detail="Playbook not found")
    with open(playbook_path, "r", encoding="utf-8") as f:
        return json.load(f)


@app.get("/api/objections")
async def get_objections(language: str = "en"):
    """Get the objection handling scripts."""
    file_name = "objection_scripts_he.json" if language == "he" else "objection_scripts.json"
    objections_path = DATA_DIR / file_name
    if not objections_path.exists():
        raise HTTPException(status_code=404, detail="Objection scripts not found")
    with open(objections_path, "r", encoding="utf-8") as f:
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


@app.get("/api/demo-transcript")
async def get_demo_transcript(language: str = "en"):
    """Get the demo transcript for frontend-driven TTS playback."""
    file_name = "demo_transcript_he.json" if language == "he" else "demo_transcript.json"
    demo_path = DATA_DIR / file_name
    if not demo_path.exists():
        raise HTTPException(status_code=404, detail="Demo transcript not found")
    with open(demo_path, "r", encoding="utf-8") as f:
        return json.load(f)


TTS_CACHE_DIR = DATA_DIR / "tts_cache" / "dynamic"
TTS_CACHE_DIR.mkdir(parents=True, exist_ok=True)


@app.get("/api/tts")
async def get_tts(text: str, lang: str = "he", speaker: str = "rep"):
    """
    Generate TTS using Microsoft Edge TTS for natural, distinguished neural voices.
    Uses filesystem caching to serve repeat requests instantaneously.
    """
    import edge_tts

    cleaned_text = text.strip()
    if not cleaned_text:
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    # Generate cache key using MD5 hash of the parameters
    cache_str = f"{lang}:{speaker}:{cleaned_text}"
    cache_key = hashlib.md5(cache_str.encode("utf-8")).hexdigest()
    cache_file = TTS_CACHE_DIR / f"{cache_key}.mp3"

    # Serve from cache if available
    if cache_file.exists() and cache_file.stat().st_size > 0:
        return FileResponse(cache_file, media_type="audio/mpeg")

    # Choose voice based on language and speaker
    if lang == "he":
        voice = "he-IL-AvriNeural" if speaker == "rep" else "he-IL-HilaNeural"
    else:  # en or other
        voice = "en-US-GuyNeural" if speaker == "rep" else "en-US-AvaNeural"

    logger.info(f"Generating TTS: voice={voice}, speaker={speaker}, text='{cleaned_text[:30]}...'")

    try:
        communicate = edge_tts.Communicate(cleaned_text, voice)
        # Save to cache file
        await communicate.save(str(cache_file))
        return FileResponse(cache_file, media_type="audio/mpeg")
    except Exception as e:
        logger.error(f"Failed to generate TTS: {e}")
        # Clean up any partial files
        if cache_file.exists():
            try:
                cache_file.unlink()
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=f"TTS error: {str(e)}")


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

                        coaching_task = asyncio.create_task(
                            _stream_coaching(ai_coach, send_json, transcript_text, language=language)
                        )

                await send_json({"type": "status", "state": "listening"})

            elif msg_type == "demo_text":
                # Demo mode: frontend sends transcript text directly (spoken via TTS)
                transcript_text = message.get("text", "")
                speaker = message.get("speaker", "unknown")
                if not transcript_text:
                    continue

                # Synchronize history so both speakers are part of the LLM context
                ai_coach.add_transcript(transcript_text, speaker)

                await send_json({"type": "status", "state": "processing"})

                # Only generate coaching for prospect's speech
                if speaker == "prospect":
                    if coaching_task and not coaching_task.done():
                        coaching_task.cancel()

                    coaching_task = asyncio.create_task(
                        _stream_coaching(ai_coach, send_json, transcript_text, language=language)
                    )
                elif speaker == "rep":
                    # Generate dynamic prospect response based on rep's input
                    async def generate_prospect():
                        try:
                            lang_name = "Hebrew" if language == "he" else "English"
                            system_prompt = PROSPECT_SYSTEM_PROMPT.format(language_name=lang_name)
                            
                            messages = [{"role": "system", "content": system_prompt}]
                            
                            # Append recent context
                            for entry in ai_coach.conversation_history[-8:]:
                                role = "assistant" if entry["speaker"] == "prospect" else "user"
                                messages.append({"role": role, "content": entry["text"]})
                                
                            response = await ai_coach.client.chat.completions.create(
                                model=ai_coach.model,
                                messages=messages,
                                max_tokens=150,
                                temperature=0.7,
                            )
                            prospect_text = response.choices[0].message.content.strip()
                            
                            # Clean dynamic response markup/quotes
                            if prospect_text.startswith('"') and prospect_text.endswith('"'):
                                prospect_text = prospect_text[1:-1]
                            elif prospect_text.startswith('“') and prospect_text.endswith('”'):
                                prospect_text = prospect_text[1:-1]
                                
                            if prospect_text.lower().startswith("sarah:"):
                                prospect_text = prospect_text[len("sarah:"):].strip()
                            prospect_text = prospect_text.strip('"“’\'')
                            
                            await send_json({
                                "type": "prospect_response",
                                "text": prospect_text,
                            })
                        except Exception as e:
                            logger.error(f"Error generating prospect response: {e}")
                            fallback = "אני מבינה. תוכל להסביר עוד?" if language == "he" else "I see. Can you explain more?"
                            await send_json({
                                "type": "prospect_response",
                                "text": fallback,
                            })
                            
                    asyncio.create_task(generate_prospect())

                await send_json({"type": "status", "state": "listening"})

    except WebSocketDisconnect:
        logger.info("🔌 Coaching WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        await send_json({"type": "error", "message": str(e)[:200]})


async def _stream_coaching(ai_coach: AICoach, send_json, transcript_text: str, language: str = "en"):
    """Shared helper: stream coaching from AI coach and send structured result."""
    try:
        full_response = ""
        async for chunk in ai_coach.get_coaching(transcript_text, language=language):
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
                "title": "Coaching Tip" if language != "he" else "טיפ אימון",
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
    language = "en"
    speed = settings.DEMO_SPEED

    async def send_json(data: dict):
        try:
            await websocket.send_json(data)
        except Exception:
            pass

    try:
        # Wait for start signal
        raw = await websocket.receive_text()
        start_msg = json.loads(raw)

        if start_msg.get("type") == "start":
            speed = start_msg.get("speed", speed)
            language = start_msg.get("language", language)

            # Load demo transcript based on language
            file_name = "demo_transcript_he.json" if language == "he" else "demo_transcript.json"
            demo_path = DATA_DIR / file_name
            if not demo_path.exists():
                await websocket.send_json({
                    "type": "error",
                    "message": f"Demo transcript not found for language {language}",
                })
                await websocket.close()
                return

            with open(demo_path, "r", encoding="utf-8") as f:
                demo_data = json.load(f)

            segments = demo_data.get("segments", [])

            await send_json({
                "type": "status",
                "state": "ready",
                "demo": True,
                "total_segments": len(segments),
            })

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
                        async for chunk in ai_coach.get_coaching(segment["text"], language=language):
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
                                "title": "Coaching Tip" if language != "he" else "טיפ אימון",
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
