import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "FormAgent", description: "AI form automation agent" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        {/* Apply OS dark mode before paint (user toggle can override via localStorage "theme") */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
