import entries from "./translations.json";
export const languageNames = {
  "uz-Cyrl": "Ўзбекча",
  "uz-Latn": "O‘zbekcha",
  ru: "Русский",
  en: "English",
  es: "Español",
};
export type Language = keyof typeof languageNames;
const dictionary = entries as Record<string, string[]>;
export function translate(value: string, language: Language): string {
  if (language === "ru") return value;
  const key = value.replace(/\s+/g, " ").trim();
  const row = dictionary[key];
  if (!row) {
    const time = /^(Просрочено: )?(\d+) (день|дня|дней|час|часа|часов)$/.exec(
      key,
    );
    if (time)
      return (
        (time[1] ? translate("Просрочено", language) + ": " : "") +
        time[2] +
        " " +
        translate(time[3], language)
      );
    const money = /^([−\-\d\s,.]+) сум$/.exec(key);
    if (money) return money[1] + " " + translate("сум", language);
    const duration = /^(Через |Просрочка: )(\d+) дн\.$/.exec(key);
    if (duration)
      return (
        translate(duration[1], language) +
        duration[2] +
        " " +
        translate("дн.", language)
      );
    return value;
  }
  const translated =
    row[{ "uz-Latn": 0, "uz-Cyrl": 1, en: 2, es: 3 }[language]];
  return (
    value.slice(0, value.length - value.trimStart().length) +
    translated +
    value.slice(value.trimEnd().length)
  );
}
