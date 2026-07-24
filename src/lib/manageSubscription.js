import { supabase } from "@/api/supabaseClient";

async function callManageSubscription(action, extra = {}) {
  const { data, error } = await supabase.functions.invoke("manage-subscription", {
    body: { action, ...extra },
  });

  if (error) {
    // FunctionsHttpError exposes the raw Response via error.context when the
    // function returned a non-2xx status with a JSON error payload.
    const message = await error.context?.json?.().then((b) => b?.error).catch(() => null);
    throw new Error(message || error.message || "Failed to manage subscription");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export const getSubscriptionDetails = () => callManageSubscription("get");
export const switchSubscriptionPlan = (priceId) => callManageSubscription("switch_plan", { priceId });
export const cancelSubscription = () => callManageSubscription("cancel");
export const resumeSubscription = () => callManageSubscription("resume");
