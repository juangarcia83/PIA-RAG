"""AgenticRAG: protocolo JSON, selección de evidencias, abstención y modo sin LLM."""
import json

import dogvrag as dr
from dogvrag.generation import NullGenerator
from dogvrag.pipelines import _parse_action

from .conftest import ScriptedLLM


def act(**kw):
    return json.dumps(kw, ensure_ascii=False)


def test_parse_action_tolerates_code_fences():
    raw = '```json\n{"thought": "x", "action": "search", "query": "ajudes"}\n```'
    assert _parse_action(raw)["query"] == "ajudes"
    assert _parse_action("no és JSON") is None
    assert _parse_action('{"action": "dance"}') is None


def test_agent_searches_then_selects_evidence(index):
    llm = ScriptedLLM([act(thought="busque", action="search", query="subvencions ajuntaments emergència"),
                       act(thought="prou", action="finish", evidence=["E1"])])
    pipe = dr.AgenticRAG(index, llm, reranker=None, max_steps=4)
    result = pipe.answer("Quines ajudes hi ha per als ajuntaments?")
    trace = result.trace
    assert trace["stop"] == "finish"
    assert trace["selected"] == ["E1"]
    assert [s["action"] for s in trace["steps"]] == ["search", "finish"]
    assert result.contexts[0].code == "2026_00001"
    assert len(llm.calls) == 3          # dos decisiones del agente + la respuesta final


def test_agent_abstains_when_it_selects_nothing(index):
    llm = ScriptedLLM([act(action="search", query="vols espacials a Mart"), act(action="finish", evidence=[])])
    pipe = dr.AgenticRAG(index, llm, reranker=None)
    result = pipe.answer("Quan ix el pròxim vol a Mart?")
    assert result.trace.get("abstain")
    assert not result.contexts


def test_invalid_output_and_step_limit_fall_back(index):
    llm = ScriptedLLM(["no sé què fer", act(action="search", query="mestres")])
    pipe = dr.AgenticRAG(index, llm, reranker=None, max_steps=2)
    result = pipe.answer("nomenaments de mestres")
    steps = result.trace["steps"]
    assert steps[0]["fallback"]                                   # salida no válida -> búsqueda con la pregunta
    assert steps[-1]["action"] == "finish" and steps[-1]["fallback"]   # último paso -> se fuerza el final
    assert result.contexts                                        # sin lista del agente, entran las de mejor score


def test_without_llm_it_behaves_like_a_single_search(index):
    pipe = dr.AgenticRAG(index, NullGenerator(), reranker=None)
    hits, trace = pipe.search("planta fotovoltaica")
    assert trace["stop"] == "no_llm"
    assert index.chunks.iloc[hits[0].chunk_id]["code"] == "2026_00004"


def test_user_filters_take_precedence_over_agent_filters():
    merged = dr.AgenticRAG._merge_filters(dr.Filters(organismo="Sanitat"), {"organismo": "Educació", "dogv_num": "10461"})
    assert merged.organismo == "Sanitat"
    assert merged.dogv_num == 10461
