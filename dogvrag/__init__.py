"""dogvrag: piezas intercambiables para construir y comparar arquitecturas RAG sobre el corpus DOGV."""
from .attachments import Attachment, AttachmentError, attachment_blocks
from .chunking import FixedChunker, StructureChunker
from .corpus import CorpusConfig, load_documents
from .embeddings import HashingEmbedder, SentenceTransformerEmbedder, resolve_device
from .evaluation import evaluate_retrieval, synthetic_questions, title_queries
from .generation import NullGenerator, OpenAICompatGenerator, connect_generator
from .index import ChunkIndex, build_index
from .pipelines import AdvancedRAG, AgenticRAG, CorrectiveRAG, NaiveRAG
from .rerank import CrossEncoderReranker
from .retrieval import DenseRetriever, Filters, HybridRetriever, SparseRetriever
from .sparse import BM25Index, Tokenizer
from .vectorstore import NumpyVectorStore

__all__ = [
    "AdvancedRAG", "AgenticRAG", "Attachment", "AttachmentError", "BM25Index", "ChunkIndex", "CorpusConfig", "CorrectiveRAG", "CrossEncoderReranker",
    "DenseRetriever", "Filters", "FixedChunker", "HashingEmbedder", "HybridRetriever", "NaiveRAG", "NullGenerator",
    "NumpyVectorStore", "OpenAICompatGenerator", "SentenceTransformerEmbedder", "SparseRetriever", "StructureChunker",
    "Tokenizer", "attachment_blocks", "build_index", "connect_generator", "evaluate_retrieval", "load_documents", "resolve_device",
    "synthetic_questions", "title_queries",
]
