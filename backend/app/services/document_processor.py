"""Document validation, text/OCR extraction, and semantic chunking services."""

import io
import logging
import os
import re

from fastapi import HTTPException
import pymupdf as fitz
import pytesseract

logger = logging.getLogger("rag.documents")

SUPPORTED_EXTENSIONS = (".pdf", ".txt", ".md", ".markdown")


def sanitize_filename(filename: str) -> str:
    """Strip path traversal components and normalise filename."""
    # Normalize Windows separators before basename so Linux servers strip C:\path\to\file too.
    base = os.path.basename(filename.replace("\\", "/"))
    return re.sub(r"[^\w\.\-\s]", "_", base).strip()


def validate_upload_bytes(filename: str, contents: bytes) -> str:
    """Validate uploaded filename extension, non-emptiness, and file signature."""
    clean_name = sanitize_filename(filename)
    lower_name = clean_name.lower()

    if not any(lower_name.endswith(ext) for ext in SUPPORTED_EXTENSIONS):
        raise HTTPException(400, "Supported formats: PDF, TXT, and Markdown (.md).")
    if not contents:
        raise HTTPException(400, "The uploaded file is empty.")

    if lower_name.endswith(".pdf"):
        if not contents.lstrip().startswith(b"%PDF-"):
            raise HTTPException(400, "Invalid PDF file: missing %PDF header signature.")
    elif b"\x00" in contents:
        raise HTTPException(400, "Invalid text file: binary content is not supported.")

    return clean_name


def extract_pdf_text(contents: bytes) -> str:
    """Extract text from PDF bytes; falls back to OCR if fewer than 50 chars extracted."""
    doc = fitz.open(stream=contents, filetype="pdf")
    try:
        pages = [page.get_text() or "" for page in doc]
        text = "\n".join(pages).strip()

        if len(text) < 50:
            logger.info("Direct text extraction yielded %d chars - falling back to OCR", len(text))
            ocr_pages = []
            for page in doc:
                pix = page.get_pixmap()
                try:
                    from PIL import Image

                    img = Image.open(io.BytesIO(pix.tobytes("png")))
                    ocr_pages.append(pytesseract.image_to_string(img))
                except Exception as exc:
                    logger.warning("OCR failed on a page: %s", exc)
            ocr_combined = "\n".join(ocr_pages).strip()
            if ocr_combined:
                text = ocr_combined

        return text
    finally:
        doc.close()


def extract_document_text(filename: str, contents: bytes) -> str:
    """Decode plain text/Markdown or extract text from PDF bytes."""
    if filename.lower().endswith((".txt", ".md", ".markdown")):
        try:
            return contents.decode("utf-8").strip()
        except UnicodeDecodeError:
            return contents.decode("utf-8", errors="replace").strip()
    return extract_pdf_text(contents)


def chunk_text(text: str, chunk_size: int = 1800, overlap: int = 300) -> list[str]:
    """Semantic recursive chunking that respects paragraph, sentence, and phrase boundaries."""
    if not text or not text.strip():
        return []

    separators = ["\n\n", "\n", ". ", "; ", ", ", " "]

    def _split(txt: str, sep_idx: int) -> list[str]:
        if sep_idx >= len(separators):
            step = chunk_size - overlap
            return [txt[i : i + chunk_size] for i in range(0, len(txt), step)]

        sep = separators[sep_idx]
        if sep == "":
            step = chunk_size - overlap
            return [txt[i : i + chunk_size] for i in range(0, len(txt), step)]

        splits = txt.split(sep)
        result = []
        for i, segment in enumerate(splits):
            suffix = sep if i < len(splits) - 1 else ""
            s_full = segment + suffix
            if not s_full.strip():
                continue
            if len(s_full) <= chunk_size:
                result.append(s_full)
            else:
                result.extend(_split(s_full, sep_idx + 1))
        return result

    pieces = _split(text, 0)
    chunks = []
    current_docs: list[str] = []
    current_len = 0

    for piece in pieces:
        piece_len = len(piece)
        if current_len + piece_len <= chunk_size:
            current_docs.append(piece)
            current_len += piece_len
        else:
            if current_docs:
                merged = "".join(current_docs).strip()
                if merged:
                    chunks.append(merged)
                overlap_docs: list[str] = []
                overlap_len = 0
                for d in reversed(current_docs):
                    if overlap_len + len(d) <= overlap:
                        overlap_docs.insert(0, d)
                        overlap_len += len(d)
                    else:
                        break
                current_docs = overlap_docs + [piece]
                current_len = sum(len(d) for d in current_docs)
            else:
                chunks.append(piece.strip())
                current_docs = []
                current_len = 0

    if current_docs:
        merged = "".join(current_docs).strip()
        if merged and (not chunks or chunks[-1] != merged):
            chunks.append(merged)

    return chunks
