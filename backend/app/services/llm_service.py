import os
import io
from typing import List, Dict, Any, Optional
import google.generativeai as genai
from app.config import settings

class LLMService:
    def __init__(self):
        self.api_key = settings.GEMINI_API_KEY
        if self.api_key:
            genai.configure(api_key=self.api_key)
        self.embedding_models = [
            "models/gemini-embedding-001",
            "models/gemini-embedding-2",
            "models/gemini-embedding-2-preview"
        ]
        # Primary and fallback chat models in order of quota availability and speed
        self.chat_models = [
            "models/gemini-3.6-flash",
            "models/gemini-3.1-flash-lite",
            "models/gemini-3.8-flash",
            "models/gemini-flash-latest",
            "models/gemini-3.5-flash"
        ]

    def get_embedding(self, text: str, is_query: bool = False) -> List[float]:
        """
        Generates 768-dimensional embedding using Google Gemini models with fallback.
        """
        if not self.api_key or not text.strip():
            return [0.0] * 768
        
        task_type = "retrieval_query" if is_query else "retrieval_document"
        for emb_model in self.embedding_models:
            try:
                result = genai.embed_content(
                    model=emb_model,
                    content=text,
                    task_type=task_type,
                    output_dimensionality=768
                )
                emb = result.get("embedding", [])
                if emb and len(emb) == 768:
                    return emb
            except Exception:
                continue
        return [0.0] * 768

    def get_batch_embeddings(self, texts: List[str]) -> List[List[float]]:
        """
        Generates embeddings for a batch of text chunks using high-performance native batching.
        """
        if not self.api_key or not texts:
            return [[0.0] * 768 for _ in texts]
        
        # Guard against empty strings causing API errors
        sanitized = [t if (t and t.strip()) else " " for t in texts]
        
        batch_size = 50
        all_embeddings = []
        
        for i in range(0, len(sanitized), batch_size):
            batch = sanitized[i:i + batch_size]
            batch_success = False
            
            for emb_model in self.embedding_models:
                try:
                    result = genai.embed_content(
                        model=emb_model,
                        content=batch,
                        task_type="retrieval_document",
                        output_dimensionality=768
                    )
                    embs = result.get("embedding", [])
                    if embs and len(embs) == len(batch):
                        all_embeddings.extend(embs)
                        batch_success = True
                        break
                except Exception as e:
                    print(f"Batch embed failed with {emb_model}: {e}")
                    continue
            
            if not batch_success:
                # Threaded fallback if batch call fails
                from concurrent.futures import ThreadPoolExecutor
                with ThreadPoolExecutor(max_workers=5) as executor:
                    batch_embs = list(executor.map(lambda t: self.get_embedding(t, is_query=False), batch))
                all_embeddings.extend(batch_embs)
                
        return all_embeddings

    async def summarize_diagram_image(
        self,
        image_bytes: bytes,
        mime_type: str = "image/png",
        context_text: str = ""
    ) -> Optional[str]:
        """
        Uses Gemini Vision to generate a concise technical summary paragraph of a diagram,
        circuit schematic, flowchart, or architecture image extracted from a document.
        """
        if not self.api_key or not image_bytes:
            return None

        prompt = (
            "You are an expert technical document analyst. Analyze this diagram, figure, or architecture image. "
            f"{f'Context near this image in the document: {context_text}' if context_text else ''}\n"
            "Provide a concise, highly informative summary paragraph (3 to 5 sentences) explaining:\n"
            "1. What this diagram or figure illustrates (e.g. circuit schematic, system architecture, block diagram, timing chart).\n"
            "2. The primary components, ICs, blocks, labels, inputs, and outputs visible.\n"
            "3. How signals, data, or processes connect and flow between components and its overall purpose in the system."
        )

        for model_name in self.chat_models:
            try:
                model = genai.GenerativeModel(model_name=model_name)
                response = model.generate_content([
                    prompt,
                    {"mime_type": mime_type, "data": image_bytes}
                ])
                if response and response.text:
                    return response.text.strip()
            except Exception as e:
                # If rate-limited (429) or model unavailable, try next model or return None
                print(f"Vision summary failed with {model_name}: {e}")
                continue

        return None

    async def generate_rag_response(
        self,
        question: str,
        retrieved_contexts: List[Dict[str, Any]],
        conversation_history: Optional[List[Dict[str, str]]] = None,
        preferred_model: Optional[str] = None,
        context_type: Optional[str] = "legal"
    ) -> Dict[str, Any]:
        """
        Generates a grounded answer from retrieved chunks with citations.
        Tailors the system prompt and analytical persona to the selected advisory context:
        - legal: As a Legal Consultant
        - healthcare: As a Certified Health Professional
        - government: As a Government Sector Consultant
        """
        if not self.api_key:
            return {
                "answer": "⚠️ Gemini API key is missing. Please add your `GEMINI_API_KEY` to `backend/.env` to enable AI chat responses.",
                "citations": []
            }

        if not retrieved_contexts:
            return {
                "answer": (
                    "I could not locate specific content or diagrams matching your query in the document. "
                    "Please verify that your document is loaded, or try asking about specific sections, headings, figures, or tables from the outline."
                ),
                "citations": []
            }

        # Format context with citations
        context_blocks = []
        citations = []
        for idx, item in enumerate(retrieved_contexts):
            page = item.get("page_number", 1)
            chunk_type = item.get("chunk_type", "text")
            heading = item.get("heading_context", "")
            content = item.get("content", "")
            
            citation_label = f"Page {page} ({chunk_type.capitalize()})"
            if heading:
                citation_label += f" - {heading}"

            citations.append({
                "id": idx + 1,
                "label": citation_label,
                "page": page,
                "type": chunk_type,
                "heading": heading,
                "content_snippet": content[:200] + "..." if len(content) > 200 else content
            })

            context_blocks.append(
                f"[Source {idx + 1} | Page {page} | Type: {chunk_type} | Section: {heading}]\n{content}\n"
            )

        context_str = "\n\n".join(context_blocks)

        # Build context-specific system prompt based on user option selection
        normalized_context = (context_type or "legal").lower().strip()

        if "health" in normalized_context:
            persona_block = (
                "You are acting As a Certified Health Professional and clinical documentation expert.\n\n"
                "HEALTHCARE CONSULTATION DIRECTIVES:\n"
                "1. Adopt the clinical precision, ethical diligence, and patient-safety mindset of a Certified Health Professional.\n"
                "2. Interpret clinical data, medical terms, diagnostic thresholds, dosage protocols, patient safety standards, and health guidelines based strictly on the provided document context.\n"
                "3. Prioritize patient safety, clinical efficacy, and evidence-based standards in every response.\n"
                "4. When explaining procedures, lab ranges, or contraindications, cite exact page numbers and protocol sections.\n"
                "5. Render tabular lab results, vital signs, or study data in clean, readable Markdown tables."
            )
        elif "gov" in normalized_context:
            persona_block = (
                "You are acting As a Government Sector Consultant and public administration advisor.\n\n"
                "GOVERNMENT SECTOR CONSULTATION DIRECTIVES:\n"
                "1. Adopt the strategic, regulatory, and public-interest mindset of a senior Government Sector Consultant.\n"
                "2. Analyze statutory compliance, public accountability, administrative procedures, regulatory frameworks, procurement protocols, and civic impacts.\n"
                "3. Provide structured policy takeaways, legislative/directive references, and clear breakdowns of agency workflows and public responsibilities.\n"
                "4. When referencing governmental mandates, directives, or policy codes, cite exact page numbers and section headers.\n"
                "5. Present organizational hierarchies, public budgets, or regulatory checklists in structured Markdown tables."
            )
        else: # Default: legal
            persona_block = (
                "You are acting As a Legal Consultant and legal documentation analyst.\n\n"
                "LEGAL CONSULTATION DIRECTIVES:\n"
                "1. Adopt the rigorous analytical scrutiny, objective tone, and formal precision of a senior Legal Consultant.\n"
                "2. Thoroughly examine contractual terms, statutory covenants, legal obligations, rights, liabilities, indemnities, warranties, and dispute procedures.\n"
                "3. Identify potential legal ambiguities, compliance risks, or contractual exposures based strictly on the provided context.\n"
                "4. Reference precise page numbers and sections/clauses (e.g. `[Page 4, Clause 2.1]`) for every legal finding.\n"
                "5. Structure responses with formal legal clarity, well-defined headings, and structured analysis."
            )

        system_instruction = (
            f"{persona_block}\n\n"
            "GENERAL GROUNDING & CITATION RULES:\n"
            "1. Ground all answers strictly in the provided document context blocks.\n"
            "2. Whenever citing information, tables, or diagrams, reference the page number and section (e.g. `[Page 2]` or `[Page 12, Figure 5.1]`).\n"
            "3. If tabular data is in the context, render clean Markdown tables for clarity.\n"
            "4. DIAGRAMS, FIGURES & ARCHITECTURES:\n"
            "   When the user asks about diagrams, figures, circuits, block diagrams, or architectures:\n"
            "   - Provide a comprehensive, well-structured summarized paragraph for each relevant diagram/figure.\n"
            "   - Clearly state the figure title/caption and page citation.\n"
            "   - Detail what the diagram depicts, its role/purpose, key components, inputs, outputs, and system interactions.\n"
            "5. If information is partially mentioned, explain what is available in the document clearly and constructively.\n"
            "6. For overview or summary questions, synthesize the provided context thoroughly.\n"
            "7. When people, students, authors, or contributors appear in the context, identify every distinct individual supported by the document.\n"
            "8. Maintain a helpful, professional, structured tone with bold key terms and bullet points where appropriate."
        )

        prompt = f"""DOCUMENT CONTEXT:
{context_str}

---
USER QUESTION: {question}

Please provide a detailed, well-structured answer with source citations (e.g., [Page X]):"""

        last_error = None

        # Map legacy/deprecated model names to currently supported models
        LEGACY_MAP = {
            "gemini-1.5-pro": "models/gemini-3.6-flash",
            "gemini-1.5-flash": "models/gemini-3.6-flash",
            "gemini-2.0-flash": "models/gemini-3.6-flash",
            "gemini-2.0-flash-lite": "models/gemini-3.1-flash-lite",
            "gemini-2.5-flash": "models/gemini-3.6-flash",
            "gemini-2.5-pro": "models/gemini-3.6-flash",
            "models/gemini-1.5-pro": "models/gemini-3.6-flash",
            "models/gemini-1.5-flash": "models/gemini-3.6-flash",
            "models/gemini-2.0-flash": "models/gemini-3.6-flash",
            "models/gemini-2.0-flash-lite": "models/gemini-3.1-flash-lite",
            "models/gemini-2.5-flash": "models/gemini-3.6-flash",
            "models/gemini-2.5-pro": "models/gemini-3.6-flash",
        }

        # Build fallback model chain prioritizing user's preference
        model_chain = list(self.chat_models)
        if preferred_model:
            target = LEGACY_MAP.get(preferred_model)
            if not target:
                target = preferred_model if preferred_model.startswith("models/") else f"models/{preferred_model}"
            if target in model_chain:
                model_chain.remove(target)
            model_chain.insert(0, target)

        for model_name in model_chain:
            try:
                model = genai.GenerativeModel(
                    model_name=model_name,
                    system_instruction=system_instruction
                )
                response = await model.generate_content_async(prompt)
                if response:
                    text = None
                    try:
                        text = response.text
                    except Exception:
                        if hasattr(response, "candidates") and response.candidates:
                            candidate = response.candidates[0]
                            if hasattr(candidate, "content") and candidate.content and candidate.content.parts:
                                text = "".join([
                                    p.text for p in candidate.content.parts
                                    if hasattr(p, "text") and p.text
                                ])
                    if text and text.strip():
                        return {
                            "answer": text.strip(),
                            "citations": citations,
                            "model": model_name
                        }
            except Exception as e:
                last_error = e
                print(f"Chat generation failed with {model_name}: {e}. Trying fallback...")
                continue

        err_msg = str(last_error) if last_error else "Unknown error"
        if "429" in err_msg or "quota" in err_msg.lower():
            friendly_err = "⚠️ Gemini API rate limit reached on the free tier. Please wait a few seconds and try again."
        elif "404" in err_msg:
            friendly_err = f"⚠️ The requested Gemini model is not accessible. (API Notice: {err_msg})"
        else:
            friendly_err = f"Unable to generate response. (API Notice: {err_msg})"

        return {
            "answer": friendly_err,
            "citations": citations
        }

    async def summarize_topic(self, query: str) -> Optional[str]:
        """
        Generates a smart, concise, and meaningful 3 to 4 word session title from a user query.
        """
        if not self.api_key or not query.strip():
            return None

        prompt = (
            "Summarize the main topic of the following user question into a concise 3 to 4 word title.\n"
            "Rules:\n"
            "- Strictly 3 to 4 words.\n"
            "- Capture the core subject, legal/technical concepts, or purpose (e.g., 'Illegal Issues in Project', 'Public Safety Risk Analysis', 'Transformer Architecture Comparison').\n"
            "- Do not include greetings, question words (e.g. 'Can you', 'What is', 'Any'), or punctuation.\n"
            "- Capitalize Each Word.\n"
            "- Output ONLY the title text, nothing else.\n\n"
            f"Question: {query.strip()}\n"
            "Title:"
        )

        for model_name in self.chat_models:
            try:
                model = genai.GenerativeModel(model_name=model_name)
                response = await model.generate_content_async(prompt)
                if response and response.text:
                    cleaned = response.text.strip().replace('"', '').replace("'", "").replace(".", "")
                    words = cleaned.split()
                    if 2 <= len(words) <= 5:
                        return " ".join(words[:4])
            except Exception as e:
                continue

        return None

llm_service = LLMService()

