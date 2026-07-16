import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { UserProfile } from "@/api/entities";

export function useSubscription() {
  const { user } = useAuth();

  const { data: profiles = [], isLoading, refetch } = useQuery({
    queryKey: ["subscription", user?.email],
    queryFn: () => (user?.email ? UserProfile.filter({ created_by: user.email }) : []),
    enabled: !!user?.email,
  });

  return {
    isPro: profiles[0]?.plan === "pro",
    isLoading,
    refetch,
  };
}
