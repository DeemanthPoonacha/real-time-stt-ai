"""
Document Ingestion Script — Ingest sales data into RAG vector store.

Usage:
    python ingest.py           # Ingest all files from data/
    python ingest.py --clear   # Clear and re-ingest
"""

import sys
import logging
from rag_engine import RAGEngine

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(message)s")
logger = logging.getLogger(__name__)


def main():
    rag = RAGEngine()
    rag.initialize()

    if "--clear" in sys.argv:
        logger.info("Clearing existing documents...")
        rag.clear()

    logger.info("Ingesting documents from data/ directory...")
    rag.ingest_all_data()

    stats = rag.get_stats()
    logger.info(f"✅ Ingestion complete. Total documents: {stats['total_documents']}")

    # Test search
    logger.info("\n--- Testing RAG Search ---")
    test_queries = [
        "customer says it's too expensive",
        "they already use Dropbox",
        "need to talk to my manager",
        "what about security and compliance",
        "closing the deal",
    ]

    for query in test_queries:
        results = rag.search(query, top_k=3)
        logger.info(f"\nQuery: '{query}'")
        for i, r in enumerate(results, 1):
            logger.info(f"  [{i}] ({r['metadata'].get('source_type', '?')}) "
                       f"{r['text'][:100]}...")


if __name__ == "__main__":
    main()
