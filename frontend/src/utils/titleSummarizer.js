/**
 * Summarizes the user's initial question or query into a concise 3 to 4 word session title.
 * Removes common conversational prefixes and filler stopwords to retain the most meaningful context.
 */
export function summarizeQueryToTitle(query) {
  if (!query || typeof query !== "string") return "New Chat";

  // Clean punctuation
  const clean = query.trim().replace(/[?!.,;:"'()[\]{}#*\\/_]/g, " ");

  // Common conversational prefixes to strip out
  const prefixRegex = /^(can you please|could you please|please tell me about|please summarize|please explain|tell me about|what is the|what are the|can you explain|can you tell me|can you provide|can you give me|how does the|how do the|give me the|i want to know about|summarize the|explain the|overview of|details of|list all|what is|what are|explain|describe|summarize)\s+/i;

  let stripped = clean.replace(prefixRegex, "").trim();
  if (!stripped) stripped = clean;

  const stopWords = new Set([
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", 
    "of", "with", "by", "from", "as", "is", "are", "was", "were", "be", 
    "been", "being", "have", "has", "had", "do", "does", "did", "this", 
    "that", "these", "those", "my", "your", "its", "their", "our", "all", 
    "any", "some", "me", "you", "him", "her", "us", "them"
  ]);

  const rawWords = stripped.split(/\s+/).filter(Boolean);
  const contentWords = rawWords.filter((w) => !stopWords.has(w.toLowerCase()));

  let chosenWords = [];
  if (contentWords.length >= 3) {
    chosenWords = contentWords.slice(0, 4);
  } else if (rawWords.length >= 3) {
    chosenWords = rawWords.slice(0, 4);
  } else if (contentWords.length > 0) {
    chosenWords = contentWords;
  } else {
    chosenWords = rawWords;
  }

  // Guarantee 3 to 4 words when original query has enough words
  if (chosenWords.length < 3 && rawWords.length >= 3) {
    chosenWords = rawWords.slice(0, Math.min(4, Math.max(3, rawWords.length)));
  }

  if (chosenWords.length === 0) return "New Chat";

  // Title-case capitalization
  return chosenWords
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
