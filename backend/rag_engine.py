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
from pathlib import Path
from typing import Optional

import chromadb
from chromadb.config import Settings as ChromaSettings

from config import settings, DATA_DIR, CHROMA_DIR

logger = logging.getLogger(__name__)


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

    def initialize(self):
        """Initialize ChromaDB client and collection."""
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

        logger.info(
            f"RAG Engine initialized. Collection '{settings.RAG_COLLECTION_NAME}' "
            f"has {self.collection.count()} documents."
        )

    def _chunk_text(self, text: str, chunk_size: int = None,
                    overlap: int = None) -> list[str]:
        """Split text into overlapping chunks."""
        chunk_size = chunk_size or settings.RAG_CHUNK_SIZE
        overlap = overlap or settings.RAG_CHUNK_OVERLAP

        if len(text) <= chunk_size:
            return [text]

        chunks = []
        start = 0
        while start < len(text):
            end = start + chunk_size

            # Try to break at sentence boundary
            if end < len(text):
                # Look for sentence-ending punctuation near the end
                for punct in ['. ', '! ', '? ', '\n']:
                    last_punct = text[start:end].rfind(punct)
                    if last_punct > chunk_size * 0.5:
                        end = start + last_punct + len(punct)
                        break

            chunks.append(text[start:end].strip())
            start = end - overlap

        return [c for c in chunks if c]

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
                    _add_fallback_document(text, prefix, 0)

            def _add_fallback_document(text: str, section: str, index: int):
                if len(text) <= 1500:
                    chunks = [text]
                else:
                    chunks = self._chunk_text(text)
                for chunk_idx, chunk in enumerate(chunks):
                    doc_id = self._generate_id(chunk, f"{file_name}_{section}_{index}_{chunk_idx}")
                    documents.append(chunk)
                    metadatas.append({
                        "source": file_name,
                        "source_type": source_type,
                        "section": section,
                        "chunk_index": chunk_idx,
                        "language": language,
                    })
                    ids.append(doc_id)

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
        """Ingest all JSON and text files from the data directory."""
        if not DATA_DIR.exists():
            logger.warning(f"Data directory not found: {DATA_DIR}")
            return

        json_files = list(DATA_DIR.glob("*.json"))
        text_files = list(DATA_DIR.glob("*.txt")) + list(DATA_DIR.glob("*.md"))

        for f in json_files:
            if "demo_transcript" in f.stem:
                continue
            source_type = "playbook" if "playbook" in f.stem else \
                          "objection" if "objection" in f.stem else "knowledge"
            language = "he" if f.stem.endswith("_he") else "en"
            self.ingest_json_file(f, source_type=source_type, language=language)

        for f in text_files:
            language = "he" if f.stem.endswith("_he") else "en"
            self.ingest_text_file(f, source_type="document", language=language)

        logger.info(
            f"Total documents in collection: {self.collection.count()}"
        )

    def search(self, query: str, top_k: int = None,
               source_type: str | None = None, language: str = "en") -> list[dict]:
        """
        Search for relevant documents given a query.

        Args:
            query: The search query (typically recent transcript text)
            top_k: Number of results to return
            source_type: Optional filter by source type
            language: Filter by language ('en' or 'he')

        Returns:
            List of dicts with 'text', 'metadata', and 'distance' keys
        """
        top_k = top_k or settings.RAG_TOP_K

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

        try:
            results = self.collection.query(
                query_texts=[query],
                n_results=top_k,
                where=where_filter,
            )
        except Exception as e:
            logger.error(f"RAG search error: {e}")
            return []

        documents = []
        if results and results["documents"]:
            for i, doc in enumerate(results["documents"][0]):
                documents.append({
                    "text": doc,
                    "metadata": results["metadatas"][0][i] if results["metadatas"] else {},
                    "distance": results["distances"][0][i] if results["distances"] else 0,
                })

        return documents

    def get_stats(self) -> dict:
        """Get collection statistics."""
        return {
            "total_documents": self.collection.count() if self.collection else 0,
            "collection_name": settings.RAG_COLLECTION_NAME,
        }

    def clear(self):
        """Clear all documents from the collection."""
        if self.client and self.collection:
            self.client.delete_collection(settings.RAG_COLLECTION_NAME)
            self.collection = self.client.get_or_create_collection(
                name=settings.RAG_COLLECTION_NAME,
                metadata={"hnsw:space": "cosine"},
            )
            logger.info("RAG collection cleared")
