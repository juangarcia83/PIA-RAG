"""Fixtures comunes: un corpus mínimo indexado con HashingEmbedder (sin descargar modelos)."""
import pytest

import dogvrag as dr
from dogvrag.types import Document

TEXTS = [
    ("2026_00001", "Resolució de convocatòria de subvencions per a ajuntaments per a plans d'emergència municipals",
     "Agència Valenciana de Seguretat", "Les ajudes es destinen als ajuntaments. El termini de presentació de "
     "sol·licituds finalitza el 13 d'octubre de 2026. L'import màxim és de 30.000 euros per ajuntament."),
    ("2026_00002", "Nomenament de personal funcionari de carrera del cos de mestres",
     "Conselleria d'Educació", "Es nomena personal funcionari de carrera les persones aspirants seleccionades "
     "en el procediment selectiu del cos de mestres. La presa de possessió serà l'1 de setembre."),
    ("2026_00003", "Criteris dels centres oncològics de referència de la Comunitat Valenciana",
     "Conselleria de Sanitat", "S'establixen els criteris per a la designació de centres oncològics de "
     "referència, amb unitats de radioteràpia i comités de tumors multidisciplinaris."),
    ("2026_00004", "Declaració d'interés comunitari per a una planta fotovoltaica a Xàtiva",
     "Conselleria de Medi Ambient", "Se sotmet a informació pública la declaració d'interés comunitari d'una "
     "planta solar fotovoltaica en sòl no urbanitzable del terme municipal de Xàtiva."),
]


def make_docs() -> list[Document]:
    docs = []
    for i, (code, title, org, body) in enumerate(TEXTS):
        text = f"# {title}\n\n" + "\n\n".join([body] * 3)
        docs.append(Document(doc_id=f"{code}:va", code=code, lang="va", date=f"2026-10-0{i + 1}", dogv_num=10460 + i,
                             text=text, title=title, title_alt=title, organismo=org, seccion="Disposicions generals",
                             url=f"https://dogv.gva.es/datos/{code}.pdf"))
    return docs


@pytest.fixture(scope="session")
def docs():
    return make_docs()


@pytest.fixture(scope="session")
def index(docs, tmp_path_factory):
    return dr.build_index("advanced", docs, dr.StructureChunker(target=400, max=700, min=100), dr.HashingEmbedder(),
                          tmp_path_factory.mktemp("indexes"), contextual=True, with_bm25=True, verbose=False)


@pytest.fixture(scope="session")
def naive_index(docs, tmp_path_factory):
    return dr.build_index("naive", docs, dr.FixedChunker(size=300, overlap=40), dr.HashingEmbedder(),
                          tmp_path_factory.mktemp("indexes"), contextual=False, with_bm25=False, verbose=False)


class ScriptedLLM:
    """LLM falso: devuelve las respuestas indicadas, en orden, y guarda los mensajes que recibe."""

    name = "scripted"
    available = True

    def __init__(self, replies: list[str]):
        self.replies = list(replies)
        self.calls: list[list[dict]] = []

    def generate(self, messages, max_tokens=700, temperature=0.1):
        self.calls.append(messages)
        return self.replies.pop(0) if self.replies else "**Resposta:** d'acord [1]"
