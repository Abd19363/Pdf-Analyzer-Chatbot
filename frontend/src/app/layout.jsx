import { Instrument_Serif, Source_Sans_3, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-serif",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata = {
  title: "DocuPulse | Multimodal AI PDF Analyzer",
  description: "Extract headings, tables, and diagrams from PDFs with vector search powered by PostgreSQL pgvector and Gemini.",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${sourceSans.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}
    >
      <body className={`${sourceSans.className} bg-paper text-ink antialiased`}>
        {children}
      </body>
    </html>
  );
}
