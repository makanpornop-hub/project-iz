export const optionalCaseFields = {
  phone: "Телефон",
  email: "Email",
  country: "Страна",
  visa_type: "Тип визы",
  deadline: "Срок",
  escalation_id: "Сотрудник для эскалации",
  initial_payment: "Первичный взнос",
  payment_deadline: "Дедлайн оплаты остатка",
} as const;
export type CaseField = keyof typeof optionalCaseFields;
export type CaseFormPolicy = { revision: number; required: CaseField[] };
export const defaultCasePolicy: CaseFormPolicy = {
  revision: 0,
  required: ["country", "visa_type"],
};
