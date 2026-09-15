/**
 * Accountability Partner service — thin wrappers around the RPCs in
 * 20260915090004_accountability_partner.sql. Every write goes through one
 * of these; there is no direct insert/update policy on
 * accountability_partnerships for the client to fall back to.
 */
import { supabase } from "@/api/supabaseClient";

export async function requestPartner(partnerEmail) {
  const { data, error } = await supabase.rpc("request_accountability_partner", {
    p_partner_email: partnerEmail,
  });
  if (error) throw error;
  return data;
}

export async function respondToPartnerRequest(partnershipId, accept) {
  const { data, error } = await supabase.rpc("respond_accountability_partner", {
    p_partnership_id: partnershipId,
    p_accept: accept,
  });
  if (error) throw error;
  return data;
}

export async function endPartnership(partnershipId) {
  const { data, error } = await supabase.rpc("end_accountability_partnership", {
    p_partnership_id: partnershipId,
  });
  if (error) throw error;
  return data;
}

export async function getPartnerDashboard() {
  const { data, error } = await supabase.rpc("get_partner_dashboard");
  if (error) throw error;
  return data || [];
}

export async function sendNudge() {
  const { data, error } = await supabase.rpc("send_accountability_nudge");
  if (error) throw error;
  return data;
}
