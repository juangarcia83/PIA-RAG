"""Documentos adjuntos: conversión (TXT, DOCX, PDF), rechazos, recuperación en documentos largos y uso en el prompt."""
import io
import zipfile

import pytest

import dogvrag as dr
from dogvrag import attachments as A
from dogvrag import prompts

from .conftest import ScriptedLLM

W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def make_docx(body: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", f'<?xml version="1.0"?><w:document {W}><w:body>{body}</w:body></w:document>')
    return buf.getvalue()


def para(text: str, style: str = "", numbered: bool = False) -> str:
    ppr = (f'<w:pStyle w:val="{style}"/>' if style else "") + ("<w:numPr/>" if numbered else "")
    return f"<w:p>{f'<w:pPr>{ppr}</w:pPr>' if ppr else ''}<w:r><w:t>{text}</w:t></w:r></w:p>"


def make_pdf(pages: list[str]) -> bytes:
    import pymupdf

    doc = pymupdf.open()
    for text in pages:
        doc.new_page().insert_text((72, 72), text, fontsize=11)
    return doc.tobytes()


def test_short_text_goes_whole_into_the_prompt():
    att = A.Attachment.from_bytes("nota.txt", "Sol·licitud de subvenció per a la Falla del barri.".encode())
    assert att.kind == "txt" and att.mode == "full" and att.pages is None
    blocks = A.attachment_blocks([att], "qualsevol pregunta")
    assert [b["ref"] for b in blocks] == ["D1"] and "Falla" in blocks[0]["text"]


def test_cp1252_text_is_read():
    att = A.Attachment.from_bytes("vell.txt", "Resolució de l'Ajuntament d'Alaquàs".encode("cp1252"))
    assert "Alaquàs" in att.chunks[0]["text"]


def test_docx_headings_lists_and_tables_become_markdown():
    body = (para("Bases de la convocatòria", "Heading1") + para("Requisits", "Ttulo2")
            + para("Ser major d'edat", numbered=True) + para("Text normal del document.")
            + "<w:tbl><w:tr><w:tc>" + para("Plaça") + "</w:tc><w:tc>" + para("Grup") + "</w:tc></w:tr>"
            + "<w:tr><w:tc>" + para("Lampista") + "</w:tc><w:tc>" + para("C2") + "</w:tc></w:tr></w:tbl>")
    text = A.Attachment.from_bytes("bases.docx", make_docx(body)).chunks[0]["text"]
    assert "# Bases de la convocatòria" in text and "## Requisits" in text
    assert "- Ser major d'edat" in text and "| Lampista | C2 |" in text


def test_pdf_keeps_page_numbers():
    att = A.Attachment.from_bytes("doc.pdf", make_pdf(["Primera pagina sobre el sondeig de Figueroles.",
                                                       "Segona pagina amb la profunditat de 80 metres."]))
    assert att.kind == "pdf" and att.pages == 2 and att.mode == "full"
    assert [c["page"] for c in att.chunks] == [1, 2]
    block = A.attachment_blocks([att], "profunditat")[1]
    assert "80 metres" in block["text"] and block["page"] == 2


@pytest.mark.parametrize("name, data", [
    ("foto.png", b"\x89PNG..."),                      # formato no admitido
    ("falso.pdf", b"no soc un pdf"),                  # la extensión no coincide con el contenido
    ("falso.docx", b"%PDF-1.4"),
    ("buit.txt", b"   "),                             # sin texto
])
def test_rejected_documents(name, data):
    with pytest.raises(A.AttachmentError):
        A.Attachment.from_bytes(name, data)


def test_too_big_document_is_rejected(monkeypatch):
    monkeypatch.setattr(A, "MAX_BYTES", 10)
    with pytest.raises(A.AttachmentError):
        A.Attachment.from_bytes("gran.txt", b"x" * 11)


def test_long_document_is_indexed_and_only_relevant_chunks_are_selected():
    filler = "Text de farciment sense relació amb res concret del procediment administratiu. " * 40
    sections = [f"## Apartat {i}\n\n{filler}" for i in range(12)]
    sections[7] = "## Apartat 7\n\nLa piscina municipal de Bocairent obri el 15 de juny. " + filler
    att = A.Attachment.from_bytes("llarg.txt", "\n\n".join(sections).encode(), dr.HashingEmbedder())
    assert att.mode == "index" and len(att.chunks) > A.TOP_K
    chosen = att.select("Quan obri la piscina municipal de Bocairent?", dr.HashingEmbedder())
    assert len(chosen) == A.TOP_K and any("Bocairent" in c["text"] for c in chosen)


def test_prompt_cites_attachments_with_d_refs():
    blocks = [{"ref": "D1", "name": "bases.pdf", "page": 3, "text": "Termini de 10 dies."}]
    user = prompts.build_messages("Quin termini hi ha?", [], "va", blocks)[1]["content"]
    assert "[D1] bases.pdf, pàg. 3" in user and prompts.NO_FRAGMENTS["va"] in user


def test_pipeline_answers_from_the_attachment_when_the_dogv_has_nothing(index):
    llm = ScriptedLLM(["**Resposta:** el termini és de 10 dies [D1]."])
    pipe = dr.AdvancedRAG(index, llm, reranker=None)
    pipe.attachments = [{"ref": "D1", "name": "bases.pdf", "page": None, "text": "Termini de 10 dies."}]
    result = pipe.answer("Quin termini hi ha?", dr.Filters(code="0000_00000"))   # el filtre no deixa cap fragment
    assert not result.contexts and "[D1]" in result.answer
    assert "Termini de 10 dies." in llm.calls[0][1]["content"]
