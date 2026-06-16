# Reliable & Scalable RAG Implementation Plan

This plan details the optimizations to make the RAG system more reliable, accurate, and scalable for huge datasets, while retaining the lightweight local environment.

## User Review Required

> [!IMPORTANT]
> The improvements are implemented in pure Python within the existing backend, meaning no new external database services (like Qdrant or Redis) need to be configured, preserving the ease of local execution.
>
> An optional BM25/lexical index is created and cached locally alongside ChromaDB.

## Proposed Changes

We will modify two core files in the backend: `config.py` and `rag_engine.py`.

---

### Central Configuration

#### [MODIFY] [config.py](file:///home/deemanth/repos/rough/real-time-stt-ai/backend/config.py)

Add configuration settings for Hybrid Search, Query Cleaning, and Manifest tracking.

```python
    # --- RAG ---
    RAG_COLLECTION_NAME: str = "sales_knowledge"
    RAG_CHUNK_SIZE: int = 500  # characters per chunk
    RAG_CHUNK_OVERLAP: int = 50
    RAG_TOP_K: int = 5  # number of relevant chunks to retrieve
    
    # RAG Optimization Settings
    RAG_ENABLE_HYBRID: bool = True
    RAG_HYBRID_ALPHA: float = 0.5  # Weight: alpha * vector + (1 - alpha) * BM25
    RAG_CLEAN_QUERY: bool = True
```

---

### RAG Engine Optimization

#### [MODIFY] [rag_engine.py](file:///home/deemanth/repos/rough/real-time-stt-ai/backend/rag_engine.py)

We will introduce several upgrades to `RAGEngine`:

1. **Lightweight BM25 Scorer:** Implement a self-contained, optimized BM25 class.
2. **Persistence of the Lexical Index:** Store/load the tokenized corpus list and BM25 metadata in `CHROMA_DIR/bm25_data.pkl` to sync with the Chroma database.
3. **Structured & Q&A Chunking:**
   - Modify JSON ingestion to parse objection blocks as single atomic semantic chunks rather than recursively flattening them to arbitrary text fragments.
   - For Markdown/Text files, split by paragraphs (`\n\n`) and group paragraphs up to `chunk_size` characters, ensuring headers and lists are kept together.
4. **Hybrid Search Combiner:**
   - Retrieve a larger candidate pool from Chroma vector search (e.g., top 30-50).
   - Score these candidate documents using BM25.
   - Normalize scores (0 to 1 range) and compute the hybrid score:
     $$\text{Hybrid Score} = \alpha \times \text{Vector Similarity} + (1 - \alpha) \times \text{BM25 Score}$$
   - Return the top $K$ chunks sorted by this hybrid score.
5. **Noisy Query Pre-processing:** Strip filler words (e.g., *uh, um, like, so, basically, you know, sort of*) and punctuation before executing searches.
6. **Delta Ingestion (Manifest Tracking):**
   - Save file paths, modification times, and MD5 checksums to `CHROMA_DIR/ingestion_manifest.json`.
   - Skip re-embedding unchanged files to save CPU and disk write cycles.

---

## Verification Plan

### Automated Tests
We will execute `ingest.py` to verify:
1. **Ingestion speed:** Test if delta-ingestion skips already ingested files.
2. **Search relevance:** Run test queries (e.g., "competitor dropbox") and verify that objection handling scripts and specific product matrices rank highest under Hybrid Search.

```bash
# Run ingestion (this should build both Chroma and the BM25 index)
python ingest.py

# Run ingestion again (should be near-instant due to delta-ingestion check)
python ingest.py
```

### Manual Verification
1. Run the coaching demo and verify that suggestions stream correctly and the retrieval results list is populated with highly relevant context documents.
