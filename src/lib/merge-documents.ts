import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { db, tx } from "./db";
import { AppError, requireCase, type Actor } from "./access";
import { lockWorkflow, workflowData } from "./workflow";
import { readObject, saveFile } from "./storage";
export async function mergeGroup(a: Actor, raw: unknown) {
  const d = z
    .object({ case_id: z.string().uuid(), group_id: z.string().uuid() })
    .parse(raw);
  await requireCase(a, d.case_id, "can_download_documents");
  const group = await tx(async (c) => {
    await lockWorkflow(c, a, d.case_id);
    const full = await workflowData(d.case_id, c);
    const g = full.groups.find((x: any) => x.id === d.group_id);
    if (!g) throw new AppError(404, "Группа не найдена");
    return g;
  });
  const fields = group.fields
    .filter((f: any) => f.merge_order)
    .sort((a: any, b: any) => a.merge_order - b.merge_order);
  if (!fields.length)
    throw new AppError(400, "Для этой группы объединение не задано");
  const output = await PDFDocument.create();
  let total = 0;
  for (const field of fields) {
    if (!field.latest || field.latest.scan_status !== "clean")
      throw new AppError(409, "Загрузите и дождитесь проверки: " + field.name);
    const v = (
      await db.query("SELECT * FROM document_versions WHERE id=$1", [
        field.latest.id,
      ])
    ).rows[0];
    total += Number(v.size);
    if (total > 80 * 1024 * 1024)
      throw new AppError(
        413,
        "Суммарный размер исходных файлов должен быть не более 80 МБ",
      );
    const bytes = await readObject(v.storage_key);
    try {
      if (v.mime === "application/pdf") {
        const pdf = await PDFDocument.load(bytes);
        if (output.getPageCount() + pdf.getPageCount() > 1000)
          throw new AppError(413, "В пакете не должно быть более 1000 страниц");
        for (const page of await output.copyPages(pdf, pdf.getPageIndices()))
          output.addPage(page);
      } else if (["image/png", "image/jpeg"].includes(v.mime)) {
        const image =
          v.mime === "image/png"
            ? await output.embedPng(bytes)
            : await output.embedJpg(bytes);
        const page = output.addPage([595.28, 841.89]);
        const scale = Math.min(555.28 / image.width, 801.89 / image.height);
        page.drawImage(image, {
          x: (595.28 - image.width * scale) / 2,
          y: (841.89 - image.height * scale) / 2,
          width: image.width * scale,
          height: image.height * scale,
        });
      } else
        throw new AppError(
          400,
          "Для объединения подходят PDF, JPG и PNG: " + field.name,
        );
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(
        400,
        "Не удалось прочитать файл «" +
          field.name +
          "». Проверьте формат и отсутствие пароля на PDF",
      );
    }
  }
  if (!output.getPageCount())
    throw new AppError(400, "В исходных файлах нет страниц");
  return saveFile(a, {
    caseId: d.case_id,
    documentId: group.output.id,
    name: "Объединённый файл",
    type: "Other",
    filename: group.name.replace(/[\\/:*?"<>|]/g, "-") + " — объединённый.pdf",
    bytes: Buffer.from(await output.save()),
    source: "website",
    generatedSources: fields.map((f: any) => f.latest.id),
  });
}
