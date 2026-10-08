import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
export const contractTokens = [
  "CLIENT_NAME",
  "DATE",
  "TOTAL_AMOUNT",
  "INITIAL_PAYMENT",
  "CURRENCY",
] as const;
export type ContractValues = Record<(typeof contractTokens)[number], string>;
const xmlPart = /^word\/(document|header\d*|footer\d*)\.xml$/;
function unpack(bytes: Uint8Array) {
  const b = Buffer.from(bytes);
  if (b.length < 22 || b.length > 5 * 1024 * 1024)
    throw Error("Шаблон DOCX должен быть не больше 5 МБ");
  let e = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--)
    if (b.readUInt32LE(i) === 0x06054b50) {
      e = i;
      break;
    }
  if (e < 0 || b.readUInt16LE(e + 4) || b.readUInt16LE(e + 6))
    throw Error("Некорректный DOCX");
  const count = b.readUInt16LE(e + 10),
    offset = b.readUInt32LE(e + 16);
  if (!count || count > 500 || offset >= e) throw Error("Некорректный DOCX");
  let p = offset,
    total = 0;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (
      p + 46 > e ||
      b.readUInt32LE(p) !== 0x02014b50 ||
      b.readUInt16LE(p + 8) & 1
    )
      throw Error("Некорректный DOCX");
    total += b.readUInt32LE(p + 24);
    const length = b.readUInt16LE(p + 28),
      name = b.subarray(p + 46, p + 46 + length).toString("utf8");
    if (
      total > 20 * 1024 * 1024 ||
      names.has(name) ||
      name.includes("..") ||
      name.startsWith("/") ||
      /vbaProject|word\/embeddings/i.test(name)
    )
      throw Error("Шаблон содержит неподдерживаемые вложения");
    names.add(name);
    p += 46 + length + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
    if (p > e) throw Error("Некорректный DOCX");
  }
  const files = unzipSync(bytes);
  if (!files["[Content_Types].xml"] || !files["word/document.xml"])
    throw Error("Загрузите документ в формате DOCX");
  return files;
}
function decode(v: string) {
  return v.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (_, e: string) => {
      const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
      };
      if (e[0] === "#") {
        const n = parseInt(
          e.slice(e[1].toLowerCase() === "x" ? 2 : 1),
          e[1].toLowerCase() === "x" ? 16 : 10,
        );
        return String.fromCodePoint(n);
      }
      return named[e.toLowerCase()];
    },
  );
}
function encode(v: string) {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function transform(
  xml: string,
  values?: ContractValues,
  seen = new Set<string>(),
) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error("Некорректный XML шаблона");
  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragraph) => {
    const nodes = [...paragraph.matchAll(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g)];
    let offset = 0;
    const runs = nodes.map((n) => {
      const text = decode(n[2]);
      const r = { start: offset, end: offset + text.length, text };
      offset = r.end;
      return r;
    });
    const joined = runs.map((r) => r.text).join("");
    const matches = [...joined.matchAll(/\{\{([A-Z_]+)\}\}/g)];
    for (const m of matches) seen.add(m[1]);
    if (!values) return paragraph;
    for (const m of matches.reverse()) {
      if (!(m[1] in values)) throw Error("Неизвестная метка договора: " + m[1]);
      const from = m.index!,
        to = from + m[0].length,
        first = runs.findIndex((r) => r.start <= from && r.end > from),
        last = runs.findIndex((r) => r.start < to && r.end >= to);
      if (first < 0 || last < 0) throw Error("Некорректная метка");
      const replacement = values[m[1] as keyof ContractValues];
      if (first === last)
        runs[first].text =
          runs[first].text.slice(0, from - runs[first].start) +
          replacement +
          runs[first].text.slice(to - runs[first].start);
      else {
        runs[first].text =
          runs[first].text.slice(0, from - runs[first].start) + replacement;
        for (let k = first + 1; k < last; k++) runs[k].text = "";
        runs[last].text = runs[last].text.slice(to - runs[last].start);
      }
    }
    let n = 0;
    return paragraph.replace(
      /<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g,
      (_, attrs: string) =>
        "<w:t" +
        (attrs.includes("xml:space")
          ? attrs
          : attrs + ' xml:space="preserve"') +
        ">" +
        encode(runs[n++].text) +
        "</w:t>",
    );
  });
}
export function validateContractTemplate(bytes: Uint8Array) {
  const files = unpack(bytes),
    seen = new Set<string>();
  for (const [name, part] of Object.entries(files))
    if (xmlPart.test(name)) transform(strFromU8(part), undefined, seen);
  const missing = contractTokens.filter((t) => !seen.has(t));
  if (missing.length)
    throw Error(
      "В шаблоне отсутствуют метки: " +
        missing.map((t) => "{{" + t + "}}").join(", "),
    );
  const unknown = [...seen].filter((t) => !contractTokens.includes(t as any));
  if (unknown.length) throw Error("Неизвестные метки: " + unknown.join(", "));
  return [...seen];
}
export function fillContractTemplate(
  bytes: Uint8Array,
  values: ContractValues,
) {
  validateContractTemplate(bytes);
  const files = unpack(bytes);
  for (const [name, part] of Object.entries(files))
    if (xmlPart.test(name))
      files[name] = strToU8(transform(strFromU8(part), values));
  return Buffer.from(zipSync(files, { level: 6 }));
}
