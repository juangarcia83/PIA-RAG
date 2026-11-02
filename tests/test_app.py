"""Servidor: configuración, clave del LLM, instrumentación y vista incrustable."""
import os

import dogvrag as dr
from app import config, embed_bundle
from app.instrumentation import Recorder, instrument
from dogvrag.generation import NullGenerator


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
    html = embed_bundle.page({"id": "abc", "events": [{"type": "x", "text": "</script>"}]}, "va", "http://lab")
    assert "/static/css/styles.css" not in html and "<style>" in html          # CSS local, inlineado
    assert "/static/js/" not in html                                           # JS inlineado, sin peticiones
    assert html.count("</script>") == html.count("<script")     # el «</script>» de los datos va escapado
    assert '<base href="http://lab/"' in html
