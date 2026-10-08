import { AppError } from "./access";
export async function boundedBody(req: Request, max: number) {
  const reader = req.body?.getReader();
  if (!reader) throw new AppError(400, "Пустой запрос");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    size += r.value.length;
    if (size > max) {
      await reader.cancel();
      throw new AppError(413, "Запрос слишком большой");
    }
    chunks.push(r.value);
  }
  return Buffer.concat(chunks);
}
