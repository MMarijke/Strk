import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Deliberately minimal, hand-styled via react-markdown's components prop
// rather than a typography plugin -- this is a legal document page, not
// part of the app's design system, so it only needs to be legible in both
// themes, not polished. No auth assumptions anywhere in this component:
// it must render correctly for a fully logged-out visitor (e.g. an app
// store reviewer landing on /terms directly with no prior session).
const markdownComponents = {
  h1: ({ children }) => (
    <h1 className="text-2xl font-bold text-foreground tracking-tight mt-8 mb-3 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-lg font-bold text-foreground mt-8 mb-2">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-base font-semibold text-foreground mt-6 mb-2">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="text-sm text-foreground/90 leading-relaxed mb-4">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-5 space-y-1.5 text-sm text-foreground/90 mb-4">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 space-y-1.5 text-sm text-foreground/90 mb-4">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ href, children }) => (
    <a href={href} className="text-primary underline underline-offset-2 hover:no-underline" target={href?.startsWith("http") ? "_blank" : undefined} rel={href?.startsWith("http") ? "noreferrer" : undefined}>
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  hr: () => <hr className="my-8 border-border" />,
  table: ({ children }) => (
    <div className="overflow-x-auto mb-4 rounded-lg border border-border">
      <table className="w-full text-sm text-left border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
  th: ({ children }) => (
    <th className="px-3 py-2 font-semibold text-foreground border-b border-border align-top">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 text-foreground/90 border-b border-border align-top">{children}</td>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-primary/40 pl-4 italic text-muted-foreground mb-4">{children}</blockquote>
  ),
};

export default function LegalPage({ title, markdown }) {
  useEffect(() => {
    const previous = document.title;
    document.title = `Strk: ${title}`;
    return () => { document.title = previous; };
  }, [title]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Strk
        </Link>
        <article>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {markdown}
          </ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
