"use client";

import { useEffect } from "react";
type Context = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      annotations: object;
      execute: (input: unknown) => Promise<unknown>;
    },
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};
export default function AgentTools() {
  useEffect(() => {
    const context = (document as Document & { modelContext?: Context })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const read = async (path: string) => {
      const r = await fetch("/api/data/" + path, { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Недостаточно прав");
      return data;
    };
    const tools = [
      {
        name: "search_visa_cases",
        title: "Найти визовые дела",
        description:
          "Прочитать доступные текущему сотруднику визовые дела по имени или номеру. Не изменяет данные.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string", maxLength: 250 } },
          required: ["query"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        async execute(input: unknown) {
          const d = input as { query?: unknown };
          if (typeof d?.query !== "string" || d.query.length > 250)
            throw new Error("Укажите поисковую строку до 250 символов");
          const rows = await read("cases?q=" + encodeURIComponent(d.query));
          return rows.map((r: Record<string, unknown>) => ({
            id: r.id,
            name: r.name,
            number: r.number,
            country: r.country,
            visa: r.visa_type,
            status: r.status,
          }));
        },
      },
      {
        name: "read_visa_case",
        title: "Прочитать визовое дело",
        description:
          "Прочитать сведения, задачи и метаданные документов доступного дела. Файлы не скачиваются.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string", format: "uuid" } },
          required: ["id"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        async execute(input: unknown) {
          const d = input as { id?: unknown };
          if (
            typeof d?.id !== "string" ||
            !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(d.id)
          )
            throw new Error("Неверный идентификатор дела");
          return read("case?id=" + encodeURIComponent(d.id));
        },
      },
    ];
    for (const tool of tools)
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    return () => lifecycle.abort();
  }, []);
  return null;
}
