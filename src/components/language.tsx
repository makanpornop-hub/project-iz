"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { translate, languageNames, type Language } from "@/lib/i18n";
const Context = createContext<{
  language: Language;
  setLanguage: (v: Language) => void;
}>({ language: "ru", setLanguage: () => {} });
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>("ru");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("project-iz-language");
      if (saved && Object.hasOwn(languageNames, saved))
        setLanguage(saved as Language);
    } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = "Project Iz — " + translate("Визовые дела", language);
  }, [language]);
  const change = (v: Language) => {
    setLanguage(v);
    try {
      localStorage.setItem("project-iz-language", v);
    } catch {}
  };
  return (
    <Context.Provider value={{ language, setLanguage: change }}>
      {children}
    </Context.Provider>
  );
}
export function useT() {
  const { language } = useContext(Context);
  return <T,>(value: T): T =>
    typeof value === "string" ? (translate(value, language) as T) : value;
}
export function LanguageSelector({ floating = false }: { floating?: boolean }) {
  const { language, setLanguage } = useContext(Context);
  return (
    <label
      className={"language-selector" + (floating ? " language-floating" : "")}
      translate="no"
    >
      <span aria-hidden="true">🌐</span>
      <select
        aria-label="Language / Язык"
        value={language}
        onChange={(e) => setLanguage(e.target.value as Language)}
      >
        {Object.entries(languageNames).map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
