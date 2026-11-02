"""Las arquitecturas recuperan la disposición correcta y respetan su contrato (search / retrieve / answer)."""
import dogvrag as dr
from dogvrag import prompts
from dogvrag.generation import NullGenerator


def top_code(pipe, question, filters=None):
    hits, _ = pipe.search(question, filters)
    return pipe.index.chunks.iloc[hits[0].chunk_id]["code"]


def test_naive_finds_the_right_document(naive_index):
    pipe = dr.NaiveRAG(naive_index, NullGenerator())
    assert top_code(pipe, "centres oncològics de referència i radioteràpia") == "2026_00003"


def test_hybrid_finds_the_right_document(index):
    pipe = dr.AdvancedRAG(index, NullGenerator(), reranker=None, name="hybrid")
    assert top_code(pipe, "nomenament personal funcionari mestres") == "2026_00002"


def test_metadata_filter_restricts_results(index):
    pipe = dr.AdvancedRAG(index, NullGenerator(), reranker=None)
    hits, _ = pipe.search("convocatòria", dr.Filters(organismo="sanitat"))
    assert hits
    assert all(index.chunks.iloc[h.chunk_id]["organismo"] == "Conselleria de Sanitat" for h in hits)


def test_answer_without_llm_returns_contexts(index):
    pipe = dr.AdvancedRAG(index, NullGenerator(), reranker=None, answer_lang="es")
    result = pipe.answer("subvencions ajuntaments plans d'emergència")
    assert result.answer == prompts.NO_LLM["es"]
    assert result.contexts and result.contexts[0].code == "2026_00001"
    assert result.contexts[0].citation().startswith("DOGV núm. 10460")


def test_prompt_numbers_the_contexts(index):
    pipe = dr.AdvancedRAG(index, NullGenerator(), reranker=None)
    contexts, _ = pipe.retrieve("planta fotovoltaica Xàtiva")
    messages = prompts.build_messages("Pregunta?", contexts, "va")
    assert messages[0]["role"] == "system"
    assert "[1]" in messages[1]["content"]
