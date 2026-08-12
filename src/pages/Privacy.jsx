import React from "react";
import LegalPage from "@/components/legal/LegalPage";
import privacyMarkdown from "../../PRIVACY_POLICY.md?raw";

export default function Privacy() {
  return <LegalPage title="Privacy Policy" markdown={privacyMarkdown} />;
}
