export type FieldTemplate = {
  name: string;
  merge_order?: number;
  required?: boolean;
};
export type GroupTemplate = {
  name: string;
  kind?: string;
  fields: FieldTemplate[];
};
const legal = (original: string): FieldTemplate[] => [
  { name: original },
  { name: "Апостель", merge_order: 4 },
  { name: "Легализация через посольства", merge_order: 3 },
  { name: "Jurado перевод", merge_order: 2 },
  { name: "Пояснительное письмо", merge_order: 1 },
];
export const criminalFields = () => legal("Оригинал справки о несудимости");
export const spainGroups: GroupTemplate[] = [
  { name: "диплом", fields: legal("Диплом") },
  { name: "ЯТТ / ИП", kind: "business", fields: legal("Сертификат ИП") },
  { name: "Справка о несудимости", kind: "criminal", fields: criminalFields() },
  { name: "Деклорация RETA", fields: [{ name: "Деклорация RETA" }] },
  {
    name: "Контракт",
    fields: [
      { name: "Контракт без перевода" },
      { name: "Контракт с переводом" },
    ],
  },
  {
    name: "Банковская выписка",
    fields: [
      "Пояснительное письмо",
      "Перевод на испанские транзакции",
      "Транзакции последних 3х месяцев",
      "Инвойсы трёх транзакции поступления",
    ].map((name, i) => ({ name, merge_order: i + 1 })),
  },
  {
    name: "Фирма контрактник",
    kind: "company",
    fields: [{ name: "Апостель" }, { name: "Jurado перевод" }],
  },
  {
    name: "Декларация о несудимости",
    fields: [{ name: "Декларация о несудимости" }],
  },
  {
    name: "Разрешение на работу от работодателя",
    fields: [{ name: "Разрешение на работу от работодателя" }],
  },
  { name: "Декларация о дипломе", fields: [{ name: "Декларация о дипломе" }] },
  {
    name: "Анкета МИТ6",
    fields: [{ name: "Оплата пошлины" }, { name: "Анкета" }],
  },
  { name: "Доверенность", fields: [{ name: "Доверенность" }] },
  { name: "CV", fields: [{ name: "CV" }] },
  {
    name: "Паспорт",
    fields: [
      { name: "Сканер главных страниц паспорта/ID" },
      { name: "Сканер всех страниц заграничного паспорта" },
      { name: "Сканер всех ВНЖ или паспортов если имеется", required: false },
    ],
  },
  {
    name: "Declaration De Entrada",
    fields: [{ name: "Declaration De Entrada" }],
  },
];
