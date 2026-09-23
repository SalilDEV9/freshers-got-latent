import type { Metadata } from "next";
import "./style.css";
export const metadata: Metadata = {
  title: "Freshers Got Latent · MindQuest",
  description:
    "The official event dashboard, audience passes and live stage control.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header>
          <a className="brand" href="/">
            MINDQUEST<span>IIIT KOTTAYAM</span>
          </a>
          <div className="edition">
            FRESHERS GOT LATENT <b>2026</b>
          </div>
        </header>
        {children}
        <footer>MindQuest · One stage. Every possibility.</footer>
      </body>
    </html>
  );
}
