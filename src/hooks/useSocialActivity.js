import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { Group, Reaction } from "@/api/entities";

// Shared by Social.jsx and Dashboard's FriendActivityStrip so both read
// the same react-query cache entry under the same queryKey, instead of
// two independent fetch definitions that could silently drift apart.
export function useSocialActivity() {
  const { user } = useAuth();

  const { data: groups = [], isLoading: groupsLoading } = useQuery({
    queryKey: ["groups", user?.email],
    queryFn: () =>
      user?.email
        ? Group.filter(
            {
              $or: [
                { created_by: user.email },
                { member_emails: { $in: [user.email] } },
              ],
            },
            "-created_date"
          )
        : [],
    enabled: !!user?.email,
    staleTime: 5 * 60 * 1000,
  });

  const { data: reactions = [], isLoading: reactionsLoading } = useQuery({
    queryKey: ["reactions", user?.email],
    queryFn: () =>
      user?.email ? Reaction.filter({ recipient_email: user.email }, "-created_date") : [],
    enabled: !!user?.email,
    staleTime: 2 * 60 * 1000,
  });

  return {
    groups,
    groupsLoading,
    reactions,
    reactionsLoading,
    isLoading: groupsLoading || reactionsLoading,
  };
}
