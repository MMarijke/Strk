import { supabase } from "@/api/supabaseClient";
// exportFilename lives in utils.js, not here, so it stays testable: this
// module imports supabaseClient, which calls createClient at module scope
// and throws "supabaseUrl is required" without env vars, taking any test
// that imports this file down with it. Same split as partnerNotice.js.
import { exportFilename } from "@/lib/utils";

/**
 * Download the caller's full data export (GDPR/POPIA right of access).
 *
 * The edge function takes no arguments by design -- it resolves the user
 * from their JWT, so there is nothing here that could ask for someone
 * else's data.
 *
 * Throws on failure so the caller can surface it. Silence would be the
 * wrong default: somebody exercising a data-access right needs to know it
 * did not happen.
 */
export async function downloadMyData() {
  const { data, error } = await supabase.functions.invoke("export-my-data");
  if (error) throw error;
  // The function returns `{ error }` with a 500 for an internal failure,
  // which invoke() surfaces as data rather than error on some versions.
  if (data?.error) throw new Error(data.error);
  if (!data?.tables) throw new Error("Export came back empty");

  triggerJsonDownload(data, exportFilename());
  return data;
}

/**
 * Save an object as a .json file.
 *
 * Kept separate so downloadMyData stays testable in principle and so the
 * revoke happens no matter what: an un-revoked object URL holds the whole
 * export in memory for the life of the document.
 */
function triggerJsonDownload(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    // Firefox requires the anchor to be in the document for a
    // programmatic click to count as a user-initiated download.
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Deferred, not immediate: revoking synchronously after click() can
    // cancel the download in Safari before it has read the blob.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
