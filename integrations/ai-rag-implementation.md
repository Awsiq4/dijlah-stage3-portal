# AI / RAG integration plan (not implemented)

1. Upload approved PDF to R2 with version and checksum; validate PDF type/size/content.
2. Extract and QA text and page boundaries; route poor scans for OCR/review.
3. Chunk by subject/lecture/page; index embeddings with ACL-appropriate metadata.
4. Retrieve only scoped lecture chunks; provide source name and page when reliable.
5. Format Arabic explanation and English scientific terms, formulas in LaTeX.
6. Missing relevant evidence => explicit uncertainty, NEVER fabricate an answer.
7. Limit requests per user, token budget, abuse filtering, logs, ability to disable AI.
8. Reindex on file replacement; delete stale chunks safely.
9. Set privacy notice and retention controls.

The UI at `/ai-assistant` intentionally DISABLES input submission until a trusted backend exists.
