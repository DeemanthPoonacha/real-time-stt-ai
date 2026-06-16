"""
RAG Engine - Retrieval-Augmented Generation using ChromaDB.

Handles:
  - Document ingestion (sales playbooks, objection scripts, product docs)
  - Chunking and embedding
  - Semantic search for relevant context during live calls

Designed to handle thousands of documents per product.
"""

import json
import logging
import hashlib
import pickle
import re
import math
from pathlib import Path
from typing import Optional
from collections import Counter

import chromadb
from chromadb.config import Settings as ChromaSettings

from config import settings, DATA_DIR, CHROMA_DIR, BASE_DIR

logger = logging.getLogger(__name__)


# Simple tokenization for BM25
TOKEN_RE = re.compile(r'\w+')

def tokenize(text: str) -> list[str]:
    return TOKEN_RE.findall(text.lower())


class BM25Scorer:
    """Lightweight self-contained BM25 scorer."""
    def __init__(self, k1=1.5, b=0.75):
        self.k1 = k1
        self.b = b
        self.corpus_size = 0
        self.avgdl = 0
        self.doc_freqs = {}      # doc_id -> Counter(tokens)
        self.idf = {}            # token -> idf
        self.doc_lengths = {}    # doc_id -> int

    def fit(self, doc_ids: list[str], documents: list[str]):
        self.corpus_size = len(documents)
        tokenized_docs = [tokenize(doc) for doc in documents]
        total_len = sum(len(d) for d in tokenized_docs)
        self.avgdl = total_len / self.corpus_size if self.corpus_size > 0 else 0
        
        self.doc_lengths = {doc_id: len(toks) for doc_id, toks in zip(doc_ids, tokenized_docs)}
        self.doc_freqs = {doc_id: Counter(toks) for doc_id, toks in zip(doc_ids, tokenized_docs)}
        
        nd = {}
        for toks in tokenized_docs:
            for term in set(toks):
                nd[term] = nd.get(term, 0) + 1
                
        self.idf = {}
        for term, count in nd.items():
            self.idf[term] = math.log((self.corpus_size - count + 0.5) / (count + 0.5) + 1.0)

    def get_score_for_doc(self, query_tokens: list[str], doc_id: str) -> float:
        if doc_id not in self.doc_freqs:
            return 0.0
        score = 0.0
        doc_len = self.doc_lengths[doc_id]
        freqs = self.doc_freqs[doc_id]
        for token in query_tokens:
            if token not in self.idf:
                continue
            f = freqs.get(token, 0)
            num = self.idf[token] * f * (self.k1 + 1)
            den = f + self.k1 * (1.0 - self.b + self.b * doc_len / self.avgdl)
            score += num / den
        return score


class RAGEngine:
    """
    RAG engine backed by ChromaDB for semantic search over sales knowledge.

    Usage:
        rag = RAGEngine()
        rag.initialize()
        rag.ingest_documents()  # one-time setup
        results = rag.search("customer says it's too expensive", top_k=5)
    """

    def __init__(self):
        self.client = None
        self.collection = None
        self.bm25_scorer = None
        self._reranker = None

    def initialize(self):
        """Initialize ChromaDB client, collection, and local indices."""
        CHROMA_DIR.mkdir(parents=True, exist_ok=True)

        self.client = chromadb.PersistentClient(
            path=str(CHROMA_DIR),
        )

        # Get or create the collection with default embedding function
        # ChromaDB uses all-MiniLM-L6-v2 by default (384-dim, fast, good quality)
        self.collection = self.client.get_or_create_collection(
            name=settings.RAG_COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )

        # Load or rebuild BM25 Scorer
        pkl_path = CHROMA_DIR / "bm25_data.pkl"
        if pkl_path.exists():
            try:
                with open(pkl_path, "rb") as f:
                    self.bm25_scorer = pickle.load(f)
                logger.info("BM25 scorer loaded from disk.")
            except Exception as e:
                logger.warning(f"Failed to load BM25 scorer: {e}. Rebuilding...")
                self.rebuild_bm25_scorer()
        else:
            self.rebuild_bm25_scorer()

        logger.info(
            f"RAG Engine initialized. Collection '{settings.RAG_COLLECTION_NAME}' "
            f"has {self.collection.count()} documents."
        )

    def _chunk_text(self, text: str, chunk_size: int = None,
                    overlap: int = None) -> list[str]:
        """Split text into overlapping chunks, prioritizing paragraph boundaries."""
        chunk_size = chunk_size or settings.RAG_CHUNK_SIZE
        overlap = overlap or settings.RAG_CHUNK_OVERLAP

        if len(text) <= chunk_size:
            return [text]

        # Split into structural blocks (paragraphs)
        paragraphs = text.split("\n\n")
        chunks = []
        current_chunk = []
        current_length = 0

        for para in paragraphs:
            para = para.strip()
            if not para:
                continue
            
            # If a single paragraph is too large on its own, chunk it by characters/sentences
            if len(para) > chunk_size:
                # Flush existing chunk
                if current_chunk:
                    chunks.append("\n\n".join(current_chunk))
                    current_chunk = []
                    current_length = 0
                
                # Chunk this large paragraph using sentence-based splits
                para_chunks = self._chunk_large_text(para, chunk_size, overlap)
                chunks.extend(para_chunks)
                continue
                
            # If adding this paragraph exceeds the chunk size, flush the current chunk
            if current_length + len(para) + (2 if current_chunk else 0) > chunk_size:
                if current_chunk:
                    chunks.append("\n\n".join(current_chunk))
                # To handle overlap, keep last paragraph if it fits within overlap limit
                overlap_chunk = []
                overlap_len = 0
                for prev_para in reversed(current_chunk):
                    if overlap_len + len(prev_para) + (2 if overlap_chunk else 0) <= overlap:
                        overlap_chunk.insert(0, prev_para)
                        overlap_len += len(prev_para) + 2
                    else:
                        break
                current_chunk = overlap_chunk
                current_length = overlap_len
                
            current_chunk.append(para)
            current_length += len(para) + (2 if len(current_chunk) > 1 else 0)

        if current_chunk:
            chunks.append("\n\n".join(current_chunk))

        return [c for c in chunks if c]

    def _chunk_large_text(self, text: str, chunk_size: int, overlap: int) -> list[str]:
        """Fallback for paragraphs larger than RAG_CHUNK_SIZE, splitting by sentence boundaries."""
        chunks = []
        start = 0
        while start < len(text):
            end = start + chunk_size

            # Try to break at sentence boundary
            if end < len(text):
                for punct in ['. ', '! ', '? ', '\n']:
                    last_punct = text[start:end].rfind(punct)
                    if last_punct > chunk_size * 0.5:
                        end = start + last_punct + len(punct)
                        break

            chunks.append(text[start:end].strip())
            start = end - overlap
        return chunks

    def _clean_query(self, query: str) -> str:
        """Strip filler words and punctuation to normalize search query."""
        if not settings.RAG_CLEAN_QUERY:
            return query
        
        # Clean punctuation
        cleaned = re.sub(r'[^\w\s]', ' ', query)
        words = cleaned.lower().split()
        
        # Common English and Hebrew filler words
        filler_words = {
            # English
            "uh", "um", "ah", "like", "so", "basically", "actually", "literally",
            "you", "know", "i", "mean", "sort", "of", "kind", "well", "right", "okay",
            # Hebrew
            "אז", "כאילו", "כזה", "טוב", "אה", "אמ", "בסיסי", "ממש", "לגמרי"
        }
        
        cleaned_words = [w for w in words if w not in filler_words]
        cleaned_query = " ".join(cleaned_words)
        return cleaned_query if cleaned_query else query

    def _chunk_markdown_text(self, text: str, chunk_size: int = None) -> list[str]:
        """
        Split markdown/text into paragraph-based chunks.
        Groups paragraphs together up to chunk_size characters.
        """
        chunk_size = chunk_size or settings.RAG_CHUNK_SIZE
        # Split text by double newlines to isolate paragraphs, headers, lists, etc.
        paragraphs = text.split("\n\n")
        chunks = []
        current_chunk = []
        current_length = 0

        for p in paragraphs:
            p = p.strip()
            if not p:
                continue

            # If a single paragraph is extremely long, split it by sentence boundaries
            # using the default _chunk_text helper to prevent overly large chunks.
            if len(p) > chunk_size * 1.5:
                # If we have accumulated text, yield it first
                if current_chunk:
                    chunks.append("\n\n".join(current_chunk))
                    current_chunk = []
                    current_length = 0

                # Split this large paragraph by sentences or character chunks
                sub_chunks = self._chunk_text(p, chunk_size=chunk_size, overlap=50)
                chunks.extend(sub_chunks)
            else:
                # If adding this paragraph exceeds chunk_size, yield current_chunk first
                if current_length + len(p) + 2 > chunk_size and current_chunk:
                    chunks.append("\n\n".join(current_chunk))
                    current_chunk = []
                    current_length = 0

                current_chunk.append(p)
                current_length += len(p) + 2

        if current_chunk:
            chunks.append("\n\n".join(current_chunk))

        return chunks

    def _generate_id(self, text: str, source: str) -> str:
        """Generate a deterministic ID for a document chunk."""
        content = f"{source}:{text}"
        return hashlib.md5(content.encode()).hexdigest()

    def ingest_json_file(self, file_path: Path, source_type: str = "playbook", language: str = "en"):
        """
        Ingest a JSON file into the vector store.
        """
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        documents = []
        metadatas = []
        ids = []

        file_name = file_path.stem

        def _add_document(text: str, section: str, index: int):
            """Add a document chunk without sub-splitting it (keep it whole as an atomic chunk)."""
            doc_id = self._generate_id(text, f"{file_name}_{section}_{index}")
            documents.append(text)
            metadatas.append({
                "source": file_name,
                "source_type": source_type,
                "section": section,
                "chunk_index": 0,
                "language": language,
            })
            ids.append(doc_id)

        # Parse file based on known formats for sales copilot
        if file_name.startswith("objection_scripts"):
            # Objection scripts format
            categories = data.get("objection_categories", [])
            for i, cat in enumerate(categories):
                cat_name = cat.get("category", "")
                objections = cat.get("objections", [])
                for j, obj in enumerate(objections):
                    text_parts = [
                        f"category: {cat_name}",
                        f"objection: {obj.get('objection', '')}",
                        f"trigger_phrases: {', '.join(obj.get('trigger_phrases', []))}",
                        f"response_strategy: {obj.get('response_strategy', '')}",
                        f"primary_script: {obj.get('primary_script', '')}"
                    ]
                    alt = obj.get("alternative_scripts", [])
                    if alt:
                        text_parts.append(f"alternative_scripts: {', '.join(alt)}")
                    tactics = obj.get("key_tactics", [])
                    if tactics:
                        text_parts.append(f"key_tactics: {', '.join(tactics)}")
                    
                    text = "\n".join(text_parts)
                    _add_document(text, f"objections_{cat_name.lower().replace(' ', '_').replace('&', 'and')}", j)

        elif file_name.startswith("sales_playbook"):
            # Sales playbook format
            # 1. Product
            prod = data.get("product", {})
            if prod:
                text = "\n".join([
                    f"category: Product Metadata",
                    f"name: {prod.get('name', '')}",
                    f"tagline: {prod.get('tagline', '')}",
                    f"product_category: {prod.get('category', '')}",
                    f"website: {prod.get('website', '')}"
                ])
                _add_document(text, "product", 0)

            # 2. Pricing
            pricing = data.get("pricing", {})
            for name, plan in pricing.items():
                text = "\n".join([
                    f"category: Pricing Plans",
                    f"name: {name}",
                    f"price: plan.get('price', '')" if isinstance(plan, str) else f"price: {plan.get('price', '')}",
                    f"features: {', '.join(plan.get('features', []))}" if isinstance(plan, dict) else f"features: ",
                    f"best_for: {plan.get('best_for', '')}" if isinstance(plan, dict) else f"best_for: "
                ])
                _add_document(text, "pricing", len(documents))

            # 3. Opening Scripts
            openings = data.get("opening_scripts", [])
            for i, op in enumerate(openings):
                text = "\n".join([
                    f"category: Opening Scripts",
                    f"scenario: {op.get('scenario', '')}",
                    f"script: {op.get('script', '')}",
                    f"key_points: {', '.join(op.get('key_points', []))}"
                ])
                _add_document(text, "opening_scripts", i)

            # 4. Qualification Questions
            questions = data.get("qualification_questions", [])
            for i, cat in enumerate(questions):
                q_cat = cat.get("category", "")
                qs = cat.get("questions", [])
                text = "\n".join([
                    f"category: Qualification Questions",
                    f"name: {q_cat}",
                    f"questions: {', '.join(qs)}"
                ])
                _add_document(text, "qualification_questions", i)

            # 5. Value Propositions
            value_props = data.get("value_propositions", [])
            for i, vp in enumerate(value_props):
                text = "\n".join([
                    f"category: Value Propositions",
                    f"headline: {vp.get('headline', '')}",
                    f"detail: {vp.get('detail', '')}",
                    f"proof_point: {vp.get('proof_point', '')}",
                    f"when_to_use: {vp.get('when_to_use', '')}"
                ])
                _add_document(text, "value_propositions", i)

            # 6. Closing Techniques
            closings = data.get("closing_techniques", [])
            for i, cl in enumerate(closings):
                text = "\n".join([
                    f"category: Closing Techniques",
                    f"name: {cl.get('name', '')}",
                    f"script: {cl.get('script', '')}",
                    f"when_to_use: {cl.get('when_to_use', '')}",
                    f"follow_up: {cl.get('follow_up', '')}"
                ])
                _add_document(text, "closing_techniques", i)

            # 7. Competitor Comparisons
            comps = data.get("competitor_comparisons", [])
            for i, cp in enumerate(comps):
                text = "\n".join([
                    f"category: Competitor Comparisons",
                    f"competitor: {cp.get('competitor', '')}",
                    f"our_advantages: {', '.join(cp.get('our_advantages', []))}",
                    f"their_advantages: {', '.join(cp.get('their_advantages', []))}",
                    f"talk_track: {cp.get('talk_track', '')}"
                ])
                _add_document(text, "competitor_comparisons", i)

        else:
            # Fallback to general flatten if we ingest a new format json
            def _flatten_fallback(obj, prefix=""):
                if isinstance(obj, dict):
                    for key, value in obj.items():
                        new_prefix = f"{prefix} > {key}" if prefix else key
                        _flatten_fallback(value, new_prefix)
                elif isinstance(obj, list):
                    for i, item in enumerate(obj):
                        if isinstance(item, dict):
                            text_parts = []
                            for k, v in item.items():
                                if isinstance(v, (str, int, float, bool)):
                                    text_parts.append(f"{k}: {v}")
                                elif isinstance(v, list):
                                    text_parts.append(f"{k}: {', '.join(str(x) for x in v)}")
                                else:
                                    text_parts.append(f"{k}: {json.dumps(v)}")
                            text = f"[{prefix}]\n" + "\n".join(text_parts)
                            _add_fallback_document(text, prefix, i)
                        elif isinstance(item, str):
                            text = f"[{prefix}]\n{item}"
                            _add_fallback_document(text, prefix, i)
                        else:
                            _flatten_fallback(item, f"{prefix}[{i}]")
                elif isinstance(obj, str) and len(obj) > 20:
                    text = f"[{prefix}]\n{obj}"
                    _add_document(text, prefix, 0)

            _flatten_fallback(data)

        if documents:
            # Upsert in batches (ChromaDB has batch limits)
            batch_size = 100
            for i in range(0, len(documents), batch_size):
                batch_end = min(i + batch_size, len(documents))
                self.collection.upsert(
                    documents=documents[i:batch_end],
                    metadatas=metadatas[i:batch_end],
                    ids=ids[i:batch_end],
                )

            logger.info(
                f"Ingested {len(documents)} chunks from {file_path.name} "
                f"(type={source_type}, language={language})"
            )
        else:
            logger.warning(f"No documents extracted from {file_path.name}")

    def ingest_text_file(self, file_path: Path, source_type: str = "document", language: str = "en"):
        """Ingest a plain text or markdown file into the vector store."""
        with open(file_path, "r", encoding="utf-8") as f:
            text = f.read()

        chunks = self._chunk_markdown_text(text)
        file_name = file_path.stem

        documents = []
        metadatas = []
        ids = []

        for i, chunk in enumerate(chunks):
            doc_id = self._generate_id(chunk, f"{file_name}_{i}")
            documents.append(chunk)
            metadatas.append({
                "source": file_name,
                "source_type": source_type,
                "chunk_index": i,
                "language": language,
            })
            ids.append(doc_id)

        if documents:
            self.collection.upsert(
                documents=documents,
                metadatas=metadatas,
                ids=ids,
            )
            logger.info(
                f"Ingested {len(documents)} chunks from {file_path.name} (language={language})"
            )

    def ingest_all_data(self):
        """Ingest all JSON and text files from the data directory with delta detection."""
        if not DATA_DIR.exists():
            logger.warning(f"Data directory not found: {DATA_DIR}")
            return

        manifest_path = CHROMA_DIR / "ingestion_manifest.json"
        manifest = {"files": {}}
        if manifest_path.exists():
            try:
                with open(manifest_path, "r", encoding="utf-8") as f:
                    manifest = json.load(f)
            except Exception as e:
                logger.warning(f"Failed to load ingestion manifest: {e}")

        json_files = list(DATA_DIR.glob("*.json"))
        text_files = list(DATA_DIR.glob("*.txt")) + list(DATA_DIR.glob("*.md"))
        all_files = json_files + text_files

        new_manifest_files = {}
        files_to_ingest = []
        any_changes = False

        for f in all_files:
            if "demo_transcript" in f.stem:
                continue
            
            # Calculate file hash and modification time
            mtime = f.stat().st_mtime
            h = hashlib.md5()
            try:
                with open(f, "rb") as file_bin:
                    while chunk := file_bin.read(8192):
                        h.update(chunk)
                file_hash = h.hexdigest()
            except Exception as e:
                logger.error(f"Failed to compute hash for {f.name}: {e}")
                continue

            rel_path = str(f.relative_to(BASE_DIR))
            new_manifest_files[rel_path] = {
                "hash": file_hash,
                "mtime": mtime
            }

            cached = manifest.get("files", {}).get(rel_path)
            if not cached or cached.get("hash") != file_hash or cached.get("mtime") != mtime:
                files_to_ingest.append(f)
                any_changes = True
            else:
                new_manifest_files[rel_path] = cached

        if not any_changes and self.collection.count() > 0:
            logger.info("ℹ️ No source file changes detected. RAG ingestion skipped.")
            return

        # Ingest updated files
        for f in files_to_ingest:
            source_type = "playbook" if "playbook" in f.stem else \
                          "objection" if "objection" in f.stem else "knowledge"
            language = "he" if f.stem.endswith("_he") else "en"
            
            # Remove old chunks for this file
            file_name = f.stem
            try:
                self.collection.delete(where={"source": file_name})
            except Exception as e:
                logger.warning(f"Failed to delete old chunks for {file_name}: {e}")

            if f in json_files:
                self.ingest_json_file(f, source_type=source_type, language=language)
            else:
                self.ingest_text_file(f, source_type="document", language=language)

        # Save new manifest
        manifest["files"] = new_manifest_files
        try:
            with open(manifest_path, "w", encoding="utf-8") as f:
                json.dump(manifest, f, indent=2)
        except Exception as e:
            logger.warning(f"Failed to save ingestion manifest: {e}")

        # Rebuild BM25 Scorer
        self.rebuild_bm25_scorer()

    def rebuild_bm25_scorer(self):
        """Fetch all documents in Chroma and fit a new BM25 scorer."""
        if not self.collection or self.collection.count() == 0:
            self.bm25_scorer = None
            pkl_path = CHROMA_DIR / "bm25_data.pkl"
            if pkl_path.exists():
                try:
                    pkl_path.unlink()
                except Exception:
                    pass
            return

        logger.info("Rebuilding BM25 scorer from collection...")
        try:
            data = self.collection.get(include=["documents", "metadatas"])
            ids = data.get("ids", [])
            docs = data.get("documents", [])
            
            if ids and docs:
                self.bm25_scorer = BM25Scorer()
                self.bm25_scorer.fit(ids, docs)
                
                pkl_path = CHROMA_DIR / "bm25_data.pkl"
                with open(pkl_path, "wb") as f:
                    pickle.dump(self.bm25_scorer, f)
                logger.info(f"BM25 scorer built and saved with {len(ids)} documents.")
            else:
                self.bm25_scorer = None
        except Exception as e:
            logger.error(f"Error rebuilding BM25 scorer: {e}")
            self.bm25_scorer = None

    def _get_reranker(self):
        """Lazily load the Cross-Encoder model."""
        if self._reranker is None:
            logger.info(f"Loading Cross-Encoder model: {settings.RAG_RERANKER_MODEL} ...")
            try:
                from sentence_transformers import CrossEncoder
                self._reranker = CrossEncoder(settings.RAG_RERANKER_MODEL)
                logger.info("Cross-Encoder reranker loaded successfully.")
            except Exception as e:
                logger.error(f"Failed to load reranker model: {e}")
                raise e
        return self._reranker

    def search(self, query: str, top_k: int = None,
               source_type: str | None = None, language: str = "en") -> list[dict]:
        """
        Search for relevant documents given a query with optional hybrid/rerank routing.

        Args:
            query: The search query (typically recent transcript text)
            top_k: Number of results to return
            source_type: Optional filter by source type
            language: Filter by language ('en' or 'he')

        Returns:
            List of dicts with 'text', 'metadata', and 'distance' keys
        """
        top_k = top_k or settings.RAG_TOP_K
        
        # 1. Clean query
        cleaned_query = self._clean_query(query)
        logger.debug(f"Search query: '{query}' -> Cleaned: '{cleaned_query}'")

        where_filter = None
        filters = []
        if source_type:
            filters.append({"source_type": source_type})
        if language:
            filters.append({"language": language})

        if len(filters) == 1:
            where_filter = filters[0]
        elif len(filters) > 1:
            where_filter = {"$and": filters}

        enable_hybrid = settings.RAG_ENABLE_HYBRID and self.bm25_scorer is not None
        enable_reranker = settings.RAG_ENABLE_RERANKER

        # Retrieve a larger candidate pool if we are doing secondary scoring or reranking
        retrieve_k = top_k
        if enable_hybrid or enable_reranker:
            retrieve_k = max(30, top_k * 4)

        try:
            results = self.collection.query(
                query_texts=[cleaned_query],
                n_results=retrieve_k,
                where=where_filter,
            )
        except Exception as e:
            logger.error(f"RAG search error: {e}")
            return []

        documents = []
        if results and results["documents"]:
            for i, doc in enumerate(results["documents"][0]):
                documents.append({
                    "id": results["ids"][0][i],
                    "text": doc,
                    "metadata": results["metadatas"][0][i] if results["metadatas"] else {},
                    "distance": results["distances"][0][i] if results["distances"] else 1.0,
                })

        if not documents:
            return []

        # 2. Hybrid Dense + Sparse BM25 scoring
        if enable_hybrid:
            query_tokens = tokenize(cleaned_query)
            bm25_scores = {}
            for doc in documents:
                bm25_scores[doc["id"]] = self.bm25_scorer.get_score_for_doc(query_tokens, doc["id"])

            similarities = [1.0 - doc["distance"] for doc in documents]
            min_sim, max_sim = min(similarities), max(similarities)
            sim_range = max_sim - min_sim if max_sim != min_sim else 1.0

            scores_bm25 = list(bm25_scores.values())
            min_bm25, max_bm25 = min(scores_bm25), max(scores_bm25)
            bm25_range = max_bm25 - min_bm25 if max_bm25 != min_bm25 else 1.0

            for doc in documents:
                doc_id = doc["id"]
                norm_sim = (1.0 - doc["distance"] - min_sim) / sim_range
                norm_bm25 = (bm25_scores[doc_id] - min_bm25) / bm25_range
                doc["hybrid_score"] = (settings.RAG_HYBRID_ALPHA * norm_sim) + \
                                      ((1.0 - settings.RAG_HYBRID_ALPHA) * norm_bm25)
                # Lower distance -> closer
                doc["distance"] = 1.0 - doc["hybrid_score"]

            documents.sort(key=lambda x: x["distance"])

        # 3. Neural Reranking
        if enable_reranker:
            try:
                # Re-rank only the top 10 hybrid/vector candidates to preserve low latency
                rerank_candidates = documents[:10]
                remaining_candidates = documents[10:]
                
                reranker = self._get_reranker()
                pairs = [[cleaned_query, doc["text"]] for doc in rerank_candidates]
                rerank_scores = reranker.predict(pairs)
                
                for doc, score in zip(rerank_candidates, rerank_scores):
                    doc["rerank_score"] = float(score)
                    prob = 1.0 / (1.0 + math.exp(-score))
                    doc["distance"] = 1.0 - prob
                    
                rerank_candidates.sort(key=lambda x: x["distance"])
                documents = rerank_candidates + remaining_candidates
            except Exception as e:
                logger.error(f"Reranking error: {e}. Falling back to hybrid/vector ordering.")

        final_docs = []
        for doc in documents[:top_k]:
            final_docs.append({
                "text": doc["text"],
                "metadata": doc["metadata"],
                "distance": doc["distance"],
            })

        return final_docs

    def get_stats(self) -> dict:
        """Get collection statistics."""
        return {
            "total_documents": self.collection.count() if self.collection else 0,
            "collection_name": settings.RAG_COLLECTION_NAME,
        }

    def clear(self):
        """Clear all documents from the collection, manifest, and local indices."""
        if self.client and self.collection:
            self.client.delete_collection(settings.RAG_COLLECTION_NAME)
            self.collection = self.client.get_or_create_collection(
                name=settings.RAG_COLLECTION_NAME,
                metadata={"hnsw:space": "cosine"},
            )
            
            manifest_path = CHROMA_DIR / "ingestion_manifest.json"
            if manifest_path.exists():
                try:
                    manifest_path.unlink()
                except Exception:
                    pass
            
            pkl_path = CHROMA_DIR / "bm25_data.pkl"
            if pkl_path.exists():
                try:
                    pkl_path.unlink()
                except Exception:
                    pass
            
            self.bm25_scorer = None
            logger.info("RAG collection, manifest, and BM25 scorer cleared")
