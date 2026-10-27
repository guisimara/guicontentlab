import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CONTENT LAB | Gui Simara",
  description: "Ferramenta local para gerar artes de carrossel e estáticos a partir de copy.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-offwhite text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
