/**
 * Summarizes the user's initial question into a concise, meaningful 3–4 word session title.
 * Focuses on semantic concepts (e.g., "Illegal Issues in Project", "Public Safety Assessment")
 * instead of mechanical prefix extraction or raw stopword remnants.
 */
export function summarizeQueryToTitle(query) {
  if (!query || typeof query !== "string") return "New Chat";

  // Clean special characters
  const clean = query.trim().replace(/[?!.,;:"'()[\]{}#*\\/_]/g, " ");

  // Conversational prefixes & meta inquiry phrases to strip
  const prefixRegex =
    /^(can you please|could you please|please tell me(?: about)?|please summarize|please explain|tell me(?: about)?|what (?:is|are) the|what (?:is|are)|can you (?:explain|tell me|provide|give me)|how (?:does|do) the|how (?:does|do)|give me(?: the)?|i want to know(?: about)?|summarize(?: the)?|explain(?: the)?|describe(?: the)?|list(?: all)?|overview of|details of|are there any|is there any|do we have any|can we find any|any)\s+/i;

  let core = clean.replace(prefixRegex, "").trim();
  if (!core) core = clean;

  const rawTokens = core.split(/\s+/).filter(Boolean);

  // Strong stopwords that should never anchor or dominate a title
  const STOP = new Set([
    "a","an","the","and","or","but","nor","so","yet","for","in","on","at","to",
    "of","with","by","from","as","is","are","was","were","be","been","being",
    "have","has","had","do","does","did","will","would","could","should","may",
    "might","shall","can","this","that","these","those","my","your","its","their",
    "our","all","any","some","me","you","him","her","us","them","it","i",
    "we","they","he","she","what","which","who","whom","whose","when","where",
    "why","how","not","no","yes","just","also","very","too","than","then",
    "there","here","about","into","onto","over","under","between","through",
    "during","document","pdf","file","text","page","pages"
  ]);

  // High-value domain / subject keywords
  const DOMAIN_BONUS = new Set([
    "illegal","crime","fraud","compliance","violation","risk","liability","legal","safety","hazard",
    "public","harm","damage","threat","security","privacy","regulation","regulatory","statute","law",
    "algorithm","model","network","architecture","layer","transformer","encoder",
    "decoder","attention","embedding","training","inference","dataset","accuracy",
    "loss","gradient","learning","neural","deep","classification","regression",
    "detection","recognition","generation","segmentation","retrieval","pipeline",
    "summary","analysis","comparison","difference","advantage","disadvantage",
    "result","conclusion","method","approach","technique","system","process",
    "performance","evaluation","metric","benchmark","experiment","implementation",
    "issue","issues","project","policy","audit","validation","assessment"
  ]);

  // Score tokens
  const scored = rawTokens.map((word, idx) => {
    const lower = word.toLowerCase();
    const isStop = STOP.has(lower);

    let score = isStop ? -5 : 2;

    if (DOMAIN_BONUS.has(lower)) score += 5;
    if (lower.length >= 6) score += 2;
    else if (lower.length >= 4) score += 1;

    // Slight position bias for main topics mentioned early
    if (!isStop) {
      score += Math.max(0, 2 - idx * 0.3);
    }

    return { word, lower, score, idx, isStop };
  });

  // Filter out negative/stop words first
  let candidates = scored.filter((t) => t.score > 0);

  // If filtered too aggressively, fallback to non-stopwords
  if (candidates.length < 2) {
    candidates = scored.filter((t) => !t.isStop);
  }

  // If still empty, use raw
  if (candidates.length === 0) {
    candidates = scored;
  }

  // Pick highest scored
  candidates.sort((a, b) => b.score - a.score);
  let chosen = candidates.slice(0, 4);

  // Re-order by appearance in query
  chosen.sort((a, b) => a.idx - b.idx);

  // Grammatically connect or format if pattern matches "<concept> ... <project>"
  let words = chosen.map((c) => c.word);

  // If we have something like ["Illegal", "Issues", "Project"] or ["Public", "Harm", "Project"]
  // Insert a natural connecting preposition like "in" if appropriate
  let formattedWords = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1]?.toLowerCase();
    formattedWords.push(w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    if (i === words.length - 2 && (next === "project" || next === "system") && !words.some(x => x.toLowerCase() === "in" || x.toLowerCase() === "of")) {
      formattedWords.push("in");
    }
  }

  if (formattedWords.length > 4) {
    formattedWords = formattedWords.slice(0, 4);
  }

  return formattedWords.join(" ") || "New Chat";
}
