import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Let Content — gerador de carrossel",
  description: "Ferramenta local para gerar artes de carrossel a partir de copy.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-offwhite text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
