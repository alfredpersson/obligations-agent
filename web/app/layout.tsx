import type { Metadata } from "next";
import { JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import styles from "./layout.module.css";
import { NOT_LEGAL_ADVICE } from "./not-legal-advice";

export const metadata: Metadata = {
  title: "Dutymap",
  description:
    "Which parts of the AI Act and the GDPR apply to one AI product, with the articles that define each result quoted.",
};

// The two fonts of the design, which the web app serves itself. globals.css names their variables
// first in --font-text and --font-label.
const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-serif" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

// Every screen: a header with the product name, which links to the start page, the content, and a
// footer with the line on legal advice.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${serif.variable} ${mono.variable}`}>
      <body>
        <header className={styles.header}>
          <Link href="/" className={styles.name}>
            Dutymap
          </Link>
          <span className={styles.tag}>Demo</span>
          <nav className={styles.nav}>
            <Link href="/#how-it-works">How it works</Link>
            <a href="https://github.com/alfredpersson/obligations-agent">Source code</a>
          </nav>
        </header>
        <main className={styles.main}>{children}</main>
        <footer className={styles.footer}>
          <p>Dutymap is a demo. {NOT_LEGAL_ADVICE}</p>
        </footer>
      </body>
    </html>
  );
}
