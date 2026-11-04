"""Servidor: configuración, clave del LLM, instrumentación, conversación y vista incrustable."""
import os
from types import SimpleNamespace

import dogvrag as dr
from app import config, embed_bundle
from app.engine import Engine
from app.instrumentation import Recorder, instrument, overrides
from dogvrag.generation import NullGenerator

from .conftest import ScriptedLLM


def test_settings_env_override_and_relative_paths(monkeypatch, tmp_path):
    monkeypatch.setenv("RAGLAB_TOP_K", "7")
    monkeypatch.setenv("RAGLAB_LANGS", '["va", "es"]')
    s = config.load_settings(tmp_path / "no-existe.json")
    assert s.top_k == 7
    assert s.langs == ["va", "es"]
    assert os.path.isabs(s.corpus_root) and os.path.isabs(s.cache_dir)


def test_api_key_from_dotenv(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "PROJECT_DIR", tmp_path)
    monkeypatch.delenv("RAGLAB_TEST_KEY", raising=False)
    (tmp_path / ".env").write_text("# comentario\nRAGLAB_TEST_KEY='sk-test'\n", encoding="utf-8")
    config.load_api_key("RAGLAB_TEST_KEY")
    assert os.environ.pop("RAGLAB_TEST_KEY") == "sk-test"


class FakeEngine:
    def chunk_meta(self, index, cid):
        return {"code": index.chunks.iloc[int(cid)]["code"]}


def test_instrumentation_emits_each_stage_and_restores_methods(index):
    pipe = dr.AdvancedRAG(index, NullGenerator(), reranker=None)
    events = []
    with instrument(pipe, Recorder(FakeEngine(), pipe, events.append)):
        pipe.retrieve("subvencions ajuntaments")
    kinds = [e["type"] for e in events]
    for stage in ("embed", "dense", "bm25", "fusion", "candidates"):
        assert stage in kinds
    assert all("chunks" in e and "t" in e for e in events)
    # al salir, los métodos envueltos se restauran (no queda ningún atributo en la instancia)
    assert "_candidates" not in vars(pipe)
    assert "retrieve_multi" not in vars(pipe.retriever)


def test_embed_bundle_is_self_contained():
    js = embed_bundle.bundle()
    assert "__m[" in js and "\nimport {" not in js
    html = embed_bundle.page({"id": "abc", "events": [{"type": "x", "text": "</script>"}]}, "http://lab")
    assert "/static/css/styles.css" not in html and "<style>" in html          # CSS local, inlineado
    assert "/static/js/" not in html                                           # JS inlineado, sin peticiones
    assert html.count("</script>") == html.count("<script")     # el «</script>» de los datos va escapado
    assert '<base href="http://lab/"' in html


def test_answer_language_is_not_tunable(index):
    pipe = dr.AdvancedRAG(index, NullGenerator(), reranker=None)
    with overrides(pipe, {"answer_lang": "es", "top_k": 3}):
        assert pipe.answer_lang == "va" and pipe.top_k == 3


def test_follow_up_is_rewritten_with_the_conversation():
    llm = ScriptedLLM(["«Quin termini hi ha per a la plaça de lampista d'Alaquàs?»\n"])
    eng = SimpleNamespace(generator=llm, s=config.Settings())
    history = [{"question": "Quina plaça convoca Alaquàs?", "answer": "Una plaça d'oficial de lampista [1]."}]
    out = Engine.standalone_question(eng, "I quin termini hi ha?", history)
    assert out == "Quin termini hi ha per a la plaça de lampista d'Alaquàs?"
    prompt = llm.calls[0][0]["content"]
    assert "Usuari: Quina plaça convoca Alaquàs?" in prompt and "Última pregunta: I quin termini hi ha?" in prompt


def test_without_history_or_llm_the_question_is_kept():
    eng = SimpleNamespace(generator=NullGenerator(), s=config.Settings())
    assert Engine.standalone_question(eng, "I quin termini?", [{"question": "a", "answer": "b"}]) == "I quin termini?"
    llm = ScriptedLLM([])
    assert Engine.standalone_question(SimpleNamespace(generator=llm, s=config.Settings()), "Pregunta", []) == "Pregunta"
    assert not llm.calls
