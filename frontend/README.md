# Multimodal Retrieval-Augmented Generation (RAG) PDF Intelligence Engine

This system implements an end-to-end, evidence-grounded Retrieval-Augmented Generation (RAG) architecture engineered to parse, extract, index, and query complex unstructured documents containing mixed textual, tabular, hierarchical, and diagrammatic data. The pipeline is designed around a multi-stage workflow: ingestion validation, multimodal extraction, native batch embedding generation, persistent vector indexing, hybrid retrieval, dynamic domain-context conditioning, and citation-backed synthesis.

---

### 1. Ingestion Protocol & Binary Validation
When a user attaches a PDF through the query interface, the file stream undergoes pre-flight binary and structural validation before entering computational processing:
- **Magic-Byte Signature Inspection**: Rather than relying on file extensions or declared MIME types, the engine inspects the initial four bytes of the byte buffer (`%PDF` / `0x25 0x50 0x44 0x46`) to verify binary integrity and block disguised or truncated payloads.
- **Deep Document Tree Verification**: The PDF cross-reference table (XRef) and page tree are validated to ensure absence of structural corruption, linearized defects, and encryption/password restrictions.
- **File Guardrails**: File size thresholds (10 MB cap) and zero-byte boundaries are strictly checked at ingestion to guard downstream memory buffers.

---

### 2. Multimodal Extraction, Structural Decomposition & Diagram Analysis
Documents are decomposed into distinct semantic modalities rather than flat text blocks:
- **Typographic Hierarchy & Heading Detection**: The engine analyzes font metrics, point sizes, span flags, and vertical spacing to build a document outline tree (`H1`, `H2`, `H3`), associating every subsequent paragraph with its parent section context.
- **Tabular Extraction & Serialization**: Tabular regions are detected via vertical and horizontal ruling intersections as well as cell alignment matrices. Cells are parsed, normalized, and serialized into explicit GitHub Flavored Markdown tables to preserve relational column-row dependencies for downstream model reasoning.
- **Isolated Diagram & Visual Understanding**: Figures, schematics, charts, and architectural blocks are extracted as isolated visual bounding boxes. Extracted images are processed in parallel with an enforced asynchronous execution timeout to generate structured visual descriptions detailing inputs, outputs, labels, and module connectivity without blocking the ingestion thread.
- **Context-Preserving Chunking**: Text is segmented along structural and semantic boundaries rather than arbitrary character splits. Each chunk retains rich metadata: page number, heading lineage, chunk category (text, table, diagram), and unique chunk identifiers.

---

### 3. Native Batch Embedding Computation
To convert textual and structured representations into dense numerical vectors:
- **Batch Vector Transformation**: Text chunks are grouped into optimized batches and mapped into continuous 768-dimensional vector spaces using a single native vectorization request, eliminating round-trip latency overhead.
- **Task-Type Differentiation**: Embeddings are parameterized with specific task objectives: document chunks are embedded under document retrieval task constraints (`retrieval_document`), ensuring vector clustering models the semantic density of reference literature rather than conversational queries.

---

### 4. Vector Storage & Relational Indexing
Extracted chunks, metadata, and corresponding vector representations are indexed in a relational database extended with dense vector indexing capabilities:
- **High-Dimensional Persistence**: The 768-dimensional float arrays are mapped directly to vector columns alongside relational foreign keys linking them to parent document records.
- **Cos-Distance Indexing**: Vectors are indexed to support Cosine Distance operations (`<=>`), computing directional similarity between vector angles rather than raw magnitude, ensuring consistency across varying chunk lengths.
- **Multi-Document & Session Isolation**: Chunks remain queryable either globally or scoped strictly to single documents or session-level subsets.

---

### 5. Query Vectorization & Hybrid Semantic Retrieval
When a user submits a prompt, the system initiates a multi-stage retrieval strategy:
- **Asymmetrical Query Embedding**: The incoming question is vectorized under a dedicated query task type (`retrieval_query`), which maps questions to the complementary vector space of target answer documents.
- **Vector Cosine Similarity Ranking**: The query vector is compared against all indexed document vectors using cosine distance to retrieve the top nearest neighbors.
- **Query Intent Classification & Typed Boosting**: The query is analyzed for structural keywords:
  - *Overview & Summary Queries*: Trigger document-wide overview retrieval, sampling introductory, concluding, and heading-dense chunks across all pages.
  - *Table-Specific Queries*: Trigger explicit relational table retrieval, fetching structured table chunks regardless of semantic distance.
  - *Diagram & Architecture Queries*: Trigger diagram chunks alongside companion explanatory text residing on the identical physical page.
- **Deduplication & Context Assembly**: Semantic and typed chunks are deduplicated by unique chunk IDs and consolidated into a unified context window preserving original page order.

---

### 6. Dynamic Advisory Context Selection (Domain System Prompts)
To ensure the LLM analyzes findings through the appropriate professional lens, the system applies a dynamic context selector that completely reconfigures the underlying system instructions and reasoning behavior:
- **Legal Help Context (`legal`)**:
  - *System Instruction Persona*: `"As a Legal Consultant and legal documentation analyst"`
  - *Analytical Behavior*: Evaluates contractual clauses, statutory obligations, indemnities, liabilities, warranties, covenants, and dispute procedures. Focuses on legal ambiguities, compliance risks, and exposure while enforcing precise section and clause citations (`[Page X, Clause Y]`).
- **Healthcare Context (`healthcare`)**:
  - *System Instruction Persona*: `"As a Certified Health Professional and clinical documentation expert"`
  - *Analytical Behavior*: Interprets findings through an evidence-based clinical and health-sciences framework. Evaluates clinical parameters, diagnostic criteria, dosage ranges, contraindications, and patient safety standards, presenting numerical metrics in clean structured tables.
- **Government Sector Help Context (`government`)**:
  - *System Instruction Persona*: `"As a Government Sector Consultant and public administration advisor"`
  - *Analytical Behavior*: Focuses on statutory governance, regulatory compliance, public policy directives, administrative procedures, public accountability, and inter-agency workflows with policy-level summaries and hierarchical breakdowns.

---

### 7. Evidence Grounding, Citation Linking & Synthesis
The assembled document context, conversation history, and persona-tailored system prompt are passed to the generation model:
- **Strict Evidence Grounding**: The model is bound by negative constraints forbidding fabrication or extrapolation beyond the explicit document context.
- **Verifiable In-Text Citations**: Every factual assertion, diagram description, or data extraction is annotated with an exact bracketed page citation (e.g. `[Page 3]`, `[Page 12, Table 2]`).
- **Citation Metadata Payloads**: The API response pairs the synthesized markdown answer with structured citation payloads containing page numbers, snippet text, and source types, enabling interactive client-side source verification.

---

### 8. Algorithmic Session Title Summarization
To maintain clean session management without expensive secondary LLM calls:
- **NLP Query Distillation**: Upon receiving the first prompt in a new session, conversational prefixes (`"What are the"`, `"Can you explain"`, `"Summarize the"`, `"Tell me about"`) and linguistic stopwords are pruned.
- **3-to-4 Word Title Formation**: The highest-entropy content tokens are selected, constrained to strictly **3 to 4 words**, and formatted in Title Case (e.g., *"What are the key compliance requirements in this contract?"* ➔ *"Key Compliance Requirements Contract"*).
- **Synchronized UI State**: The generated 3-to-4 word title simultaneously updates the active top header bar and the persistent sidebar session list across local storage.
