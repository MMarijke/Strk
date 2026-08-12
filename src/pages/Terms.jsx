import React from "react";
import LegalPage from "@/components/legal/LegalPage";
import termsMarkdown from "../../TERMS_OF_SERVICE.md?raw";

export default function Terms() {
  return <LegalPage title="Terms of Service" markdown={termsMarkdown} />;
}
