export const LANGUAGES: { code: string; label: string }[] = [
  { code: "auto", label: "Match the visitor (auto)" },
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "hi", label: "Hindi" },
  { code: "ur", label: "Urdu" },
  { code: "ar", label: "Arabic" },
  { code: "tr", label: "Turkish" },
  { code: "ja", label: "Japanese" },
];

export const languageLabel = (code: string) => LANGUAGES.find((l) => l.code === code)?.label.replace(/ \(auto\)$/, "") ?? code;

/** Deepgram language for STT: "multi" lets nova-3 follow the visitor when the agent is on auto. */
export const sttLanguage = (code: string) => (code === "auto" ? "multi" : code);
