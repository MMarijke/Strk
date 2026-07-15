import { UserProfile } from "@/api/entities";

/**
 * Returns the best display name for a given email.
 * Looks up profiles array for a UserProfile where created_by === email.
 * Falls back to the part before @ in the email (never a raw ID).
 */
export function getDisplayName(email, profiles = []) {
  if (!email) return "Unknown";
  const profile = profiles.find((p) => p.created_by === email);
  if (profile?.display_name) return profile.display_name;
  // Always fall back to email prefix — never expose raw IDs
  return email.includes("@") ? email.split("@")[0] : email;
}

/**
 * Fetch the current user's own UserProfile record, scoped by their user ID.
 * Uses created_by filter to ensure strict per-user isolation.
 */
export async function getMyProfile(userEmail) {
  if (!userEmail) return null;
  const results = await UserProfile.filter({ created_by: userEmail });
  return results?.[0] || null;
}

/**
 * Save/update the display name for the current user, strictly scoped to their account.
 */
export async function saveMyDisplayName(userEmail, displayName) {
  const existing = await getMyProfile(userEmail);
  if (existing) {
    return UserProfile.update(existing.id, { display_name: displayName });
  } else {
    return UserProfile.create({ display_name: displayName, is_public: true });
  }
}
