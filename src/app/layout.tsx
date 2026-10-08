import { LanguageProvider } from "@/components/language";
import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Project Iz — Визовые дела",
  description: "Рабочее пространство визовой компании",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
