import io
import re
from typing import List, Dict, Any
import fitz  # PyMuPDF
import pdfplumber

class PDFValidationError(Exception):
    pass

MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB

class PDFParser:
    @staticmethod
    def validate_pdf(file_bytes: bytes, filename: str) -> None:
        """
        Comprehensive PDF validation:
        1. Extension check (.pdf only)
        2. File size check (max 10 MB)
        3. Magic-bytes check (%PDF header)
        4. Deep structure validation via PyMuPDF (detects truncated/corrupted files)
        5. Password-protected / encrypted file detection
        """
        # 1. Extension
        if not filename.lower().endswith(".pdf"):
            raise PDFValidationError(
                f"Invalid file type: '{filename}'. Only PDF files (.pdf) are accepted."
            )

        # 2. Size limit
        size_mb = len(file_bytes) / (1024 * 1024)
        if len(file_bytes) > MAX_FILE_SIZE_BYTES:
            raise PDFValidationError(
                f"File too large: '{filename}' is {size_mb:.1f} MB. "
                f"Maximum allowed size is 10 MB. Please compress or split the PDF."
            )

        if len(file_bytes) < 5:
            raise PDFValidationError(
                f"File '{filename}' is empty or too small to be a valid PDF."
            )

        # 3. PDF magic-bytes (%PDF header)
        if not file_bytes[:4].startswith(b"%PDF"):
            raise PDFValidationError(
                f"File '{filename}' is not a valid PDF. "
                "It may be corrupted, renamed, or a different file type in disguise."
            )

        # 4. Deep structure validation via PyMuPDF
        try:
            test_doc = fitz.open(stream=file_bytes, filetype="pdf")
        except Exception as e:
            raise PDFValidationError(
                f"The PDF '{filename}' could not be opened — it appears to be corrupted "
                f"or structurally invalid. ({e})"
            )

        # 5. Encrypted / password-protected check
        if test_doc.is_encrypted:
            test_doc.close()
            raise PDFValidationError(
                f"The PDF '{filename}' is password-protected or encrypted. "
                "Please remove the password before uploading."
            )

        page_count = len(test_doc)
        test_doc.close()

        if page_count == 0:
            raise PDFValidationError(
                f"The PDF '{filename}' contains no readable pages."
            )

    @staticmethod
    def sanitize_content(text: str) -> str:
        """
        Redacts known patterns of private / confidential data from extracted text
        before it is stored in the vector database or sent to the LLM.

        Patterns redacted:
        - Credit / debit card numbers (Visa, Mastercard, Amex, etc.)
        - Social Security Numbers (SSN) — US format XXX-XX-XXXX
        - Explicit credential lines (api_key, password, secret, token, bearer)
        - PEM private keys
        - IBAN bank account numbers (basic pattern)
        """
        # 1. Credit / debit card numbers (13–19 digit, optional spaces/dashes)
        text = re.sub(
            r'\b(?:\d{4}[-\s]?){3}\d{1,4}\b',
            '[REDACTED:CARD_NUMBER]',
            text
        )

        # 2. US Social Security Numbers  XXX-XX-XXXX
        text = re.sub(
            r'\b\d{3}-\d{2}-\d{4}\b',
            '[REDACTED:SSN]',
            text
        )

        # 3. Credential / secret lines (api_key = ..., password: ..., bearer token, etc.)
        text = re.sub(
            r'(?im)^([ \t]*)(api[_-]?key|secret[_-]?key|access[_-]?token|bearer'
            r'|private[_-]?key|client[_-]?secret|passwd|password'
            r'|auth[_-]?token|authorization)\s*[:=]\s*\S+',
            r'\1\2: [REDACTED:CREDENTIAL]',
            text
        )

        # 4. PEM private keys (RSA, EC, general)
        text = re.sub(
            r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]+?'
            r'-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
            '[REDACTED:PRIVATE_KEY]',
            text
        )

        # 5. Basic IBAN bank account numbers  (e.g. GB29 NWBK 6016 1331 9268 19)
        text = re.sub(
            r'\b[A-Z]{2}\d{2}(?:[ ]?\w{4}){2,7}\b',
            '[REDACTED:IBAN]',
            text
        )

        return text

    @classmethod
    def parse_pdf(cls, file_bytes: bytes, filename: str) -> Dict[str, Any]:
        """
        Comprehensively parses a PDF document:
        - Extracts hierarchical headings (H1, H2, H3) via font size + bold analysis
        - Extracts all body text, sub-headings, and bullet points as text chunks
        - Detects and converts tables into Markdown format via pdfplumber
        - Extracts embedded images/diagrams with metadata
        """
        cls.validate_pdf(file_bytes, filename)

        fitz_doc = fitz.open(stream=file_bytes, filetype="pdf")
        total_pages = len(fitz_doc)
        plumber_doc = pdfplumber.open(io.BytesIO(file_bytes))

        # ─── Step 1: Collect all font sizes across ALL pages to build a robust baseline ───
        all_font_sizes: List[float] = []
        for page_idx in range(total_pages):
            page = fitz_doc[page_idx]
            blocks = page.get_text("rawdict").get("blocks", [])
            for block in blocks:
                if block.get("type") != 0:
                    continue
                for line in block.get("lines", []):
                    for span in line.get("spans", []):
                        txt = span.get("text", "").strip()
                        if len(txt) > 1:
                            all_font_sizes.append(round(span.get("size", 11.0), 1))

        if not all_font_sizes:
            all_font_sizes = [11.0]

        # Body font = most common font size in the document
        from collections import Counter
        size_counts = Counter(all_font_sizes)
        body_font_size = size_counts.most_common(1)[0][0]

        # A span is a "heading" only if its font size is clearly LARGER than body
        # We use 1.25x as the minimum heading multiplier to avoid false positives
        heading_min_size = body_font_size * 1.25

        chunks: List[Dict[str, Any]] = []
        outline: List[Dict[str, Any]] = []
        current_heading = ""
        total_headings = 0
        total_tables = 0
        total_diagrams = 0

        for page_idx in range(total_pages):
            page_num = page_idx + 1
            fitz_page = fitz_doc[page_idx]
            plumber_page = plumber_doc.pages[page_idx] if page_idx < len(plumber_doc.pages) else None

            # ─── Step 2: Get bounding boxes of table regions to skip them in text extraction ───
            table_rects = []
            if plumber_page:
                try:
                    for table in plumber_page.find_tables():
                        bbox = table.bbox  # (x0, y0, x1, y1)
                        table_rects.append(fitz.Rect(bbox[0], bbox[1], bbox[2], bbox[3]))
                except Exception:
                    pass

            # ─── Step 3: Table Extraction via pdfplumber ───
            if plumber_page:
                try:
                    tables = plumber_page.extract_tables()
                    for table_idx, table in enumerate(tables):
                        if not table or len(table) < 2:
                            continue
                        cleaned_rows = []
                        for row in table:
                            cleaned_row = [
                                str(cell).strip().replace("\n", " ") if cell is not None else ""
                                for cell in row
                            ]
                            if any(cleaned_row):
                                cleaned_rows.append(cleaned_row)
                        if len(cleaned_rows) < 2:
                            continue
                        header = cleaned_rows[0]
                        col_count = len(header)
                        md_lines = [
                            "| " + " | ".join(header) + " |",
                            "| " + " | ".join(["---"] * col_count) + " |",
                        ]
                        for r in cleaned_rows[1:]:
                            r_padded = (r + [""] * col_count)[:col_count]
                            md_lines.append("| " + " | ".join(r_padded) + " |")
                        md_table = "\n".join(md_lines)
                        safe_table = cls.sanitize_content(md_table)
                        total_tables += 1
                        chunks.append({
                            "chunk_type": "table",
                            "content": (
                                f"### Table on Page {page_num}"
                                + (f" (Section: {current_heading})" if current_heading else "")
                                + f":\n\n{safe_table}"
                            ),
                            "page_number": page_num,
                            "heading_context": current_heading,
                            "chunk_metadata": {
                                "table_index": table_idx + 1,
                                "columns": header,
                                "row_count": len(cleaned_rows) - 1,
                                "type": "table"
                            }
                        })
                except Exception:
                    pass

            # ─── Step 4: Extract text using rawdict for per-span font metadata ───
            raw_page = fitz_page.get_text("rawdict")
            all_blocks = raw_page.get("blocks", [])

            # We will process line-by-line to correctly handle mixed heading+body blocks
            # Build a list of (line_text, max_size, is_bold, block_bbox) tuples
            lines_info: List[Dict] = []

            for block in all_blocks:
                if block.get("type") != 0:
                    continue

                # Skip lines that fall inside a table region
                block_rect = fitz.Rect(block["bbox"])
                if any(block_rect.intersects(tr) for tr in table_rects):
                    continue

                for line in block.get("lines", []):
                    line_text_parts = []
                    line_max_size = 0.0
                    line_is_bold = False
                    line_has_color = False

                    for span in line.get("spans", []):
                        raw_chars = span.get("chars", [])
                        span_text = "".join(c.get("c", "") for c in raw_chars) if raw_chars else span.get("text", "")
                        if not span_text.strip():
                            continue
                        line_text_parts.append(span_text)
                        sz = span.get("size", 0.0)
                        if sz > line_max_size:
                            line_max_size = sz
                        flags = span.get("flags", 0)
                        font = span.get("font", "").lower()
                        if flags & 2 or "bold" in font or "heavy" in font or "black" in font:
                            line_is_bold = True
                        color = span.get("color", 0)
                        if color != 0:
                            line_has_color = True

                    line_text = "".join(line_text_parts).strip()
                    if not line_text or len(line_text) < 2:
                        continue

                    lines_info.append({
                        "text": line_text,
                        "size": line_max_size,
                        "bold": line_is_bold,
                        "colored": line_has_color,
                        "bbox": line.get("bbox", (0, 0, 0, 0))
                    })

            # ─── Step 5: Classify each line as Heading or Body/Bullet ───
            pending_text_lines: List[str] = []

            def flush_pending():
                """Group pending body text lines into a text chunk, with PII sanitization."""
                nonlocal pending_text_lines
                if not pending_text_lines:
                    return
                combined = "\n".join(pending_text_lines).strip()
                if combined:
                    safe_combined = cls.sanitize_content(combined)
                    chunks.append({
                        "chunk_type": "text",
                        "content": (
                            f"Page {page_num}"
                            + (f" [{current_heading}]" if current_heading else "")
                            + f":\n{safe_combined}"
                        ),
                        "page_number": page_num,
                        "heading_context": current_heading,
                        "chunk_metadata": {
                            "type": "text",
                            "char_count": len(safe_combined),
                            "line_count": len(pending_text_lines)
                        }
                    })
                pending_text_lines = []

            for info in lines_info:
                line_text = info["text"]
                line_size = info["size"]
                line_bold = info["bold"]
                text_len = len(line_text)

                # ── Bullet/list detection: always body text regardless of font ──
                stripped = line_text.lstrip()
                is_bullet = (
                    stripped.startswith(("•", "-", "–", "—", "*", "·", "◦", "▪", "✓", "➤", "→"))
                    or (len(stripped) >= 2 and stripped[0].isdigit() and stripped[1] in ".)")
                    or (len(stripped) >= 3 and stripped[0].isdigit() and stripped[1].isdigit() and stripped[2] in ".)")
                )

                # ── Heading classification ──
                # A line is a heading if ALL of these are true:
                #   1. Font size >= heading_min_size (clearly larger than body), OR it's bold and colored
                #   2. Text is SHORT (headings are titles, not paragraphs)
                #   3. It does NOT start with bullet markers
                #   4. Doesn't look like a sentence (doesn't end with common punctuation mid-sentence)
                is_size_heading = line_size >= heading_min_size
                is_bold_title = (
                    line_bold
                    and line_size >= body_font_size * 1.05  # at least slightly larger
                    and text_len < 100
                    and not is_bullet
                )
                looks_like_heading = (is_size_heading or is_bold_title) and text_len < 150 and not is_bullet

                if looks_like_heading:
                    # Flush buffered body text first
                    flush_pending()

                    # Determine heading level
                    if line_size >= body_font_size * 1.6:
                        level = 1
                    elif line_size >= body_font_size * 1.3:
                        level = 2
                    else:
                        level = 3

                    current_heading = line_text
                    total_headings += 1
                    outline.append({
                        "title": line_text,
                        "page": page_num,
                        "level": level
                    })
                    safe_heading = cls.sanitize_content(line_text)
                    chunks.append({
                        "chunk_type": "heading",
                        "content": f"{'#' * level} {safe_heading} (Page {page_num})",
                        "page_number": page_num,
                        "heading_context": safe_heading,
                        "chunk_metadata": {
                            "level": level,
                            "font_size": round(line_size, 1),
                            "type": "heading"
                        }
                    })
                else:
                    # Body text, sub-heading that's too short to be top-level, or bullet
                    pending_text_lines.append(line_text)
                    # Flush at 800 chars to keep chunks manageable
                    combined_len = sum(len(l) for l in pending_text_lines)
                    if combined_len >= 800:
                        flush_pending()

            # Flush any remaining body text for this page
            flush_pending()

            # ─── Step 6: Diagram / Image Extraction ───
            image_list = fitz_page.get_images(full=True)
            if image_list:
                # Extract page text, figure captions, and contextual lines
                page_full_text = fitz_page.get_text("text")
                caption_pattern = re.compile(
                    r'(?i)^\s*(?:Figure|Fig\.?|Diagram|Chart|Scheme|Illustration)\s*[\d\.\-_:]*\s*[:.\-—]?\s*.+',
                    re.MULTILINE
                )
                page_captions = [c.strip() for c in caption_pattern.findall(page_full_text) if len(c.strip()) > 3]

                # Extract substantive explanatory lines on this page (excluding pure headings)
                page_lines = [l.strip() for l in page_full_text.splitlines() if len(l.strip()) > 20]
                substantive_lines = [
                    l for l in page_lines
                    if not l.startswith(("#", "Chapter", "Contents", "List of", "Page "))
                    and not caption_pattern.match(l)
                ]
                page_summary_context = " ".join(substantive_lines[:4])
                if len(page_summary_context) > 400:
                    page_summary_context = page_summary_context[:400] + "..."

                for img_idx, img in enumerate(image_list):
                    xref = img[0]
                    try:
                        base_image = fitz_doc.extract_image(xref)
                        if base_image:
                            width = base_image.get("width", 0)
                            height = base_image.get("height", 0)
                            if width >= 100 and height >= 100:
                                total_diagrams += 1
                                ext = base_image.get("ext", "png")
                                figure_num = total_diagrams

                                # Select matched caption for this image if available
                                detected_caption = ""
                                if img_idx < len(page_captions):
                                    detected_caption = page_captions[img_idx]
                                elif page_captions:
                                    detected_caption = page_captions[0]

                                caption_header = f"Caption: {detected_caption}\n" if detected_caption else f"Figure {figure_num} on Page {page_num}\n"

                                rich_content = (
                                    f"[Diagram / Figure / Architecture | Page {page_num}]\n"
                                    f"{caption_header}"
                                    f"Section: '{current_heading}'\n"
                                    f"Technical Dimensions: {width}x{height}px ({ext.upper()} graphic)\n"
                                    f"Contextual Summary from Page {page_num}:\n"
                                    f"{page_summary_context if page_summary_context else f'Illustrates the {current_heading} architecture, hardware connections, or circuit schematic.'}\n"
                                    f"Purpose & Role: This figure illustrates the architecture, circuit schematic, pinouts, "
                                    f"or block diagram for '{detected_caption or current_heading or 'the system'}'. "
                                    f"It visually represents the components, connections, signal routing, and operational flow described in this section."
                                )

                                chunks.append({
                                    "chunk_type": "diagram",
                                    "content": rich_content,
                                    "image_bytes": base_image.get("image"),
                                    "image_mime_type": f"image/{ext}",
                                    "page_number": page_num,
                                    "heading_context": current_heading,
                                    "chunk_metadata": {
                                        "figure_number": figure_num,
                                        "caption": detected_caption,
                                        "image_index": img_idx + 1,
                                        "width": width,
                                        "height": height,
                                        "format": ext,
                                        "type": "diagram"
                                    }
                                })
                    except Exception:
                        pass


        fitz_doc.close()
        plumber_doc.close()

        return {
            "filename": filename,
            "total_pages": total_pages,
            "total_headings": total_headings,
            "total_tables": total_tables,
            "total_diagrams": total_diagrams,
            "outline": outline,
            "chunks": chunks
        }
