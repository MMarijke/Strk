import React from "react";
import { Button } from "@/components/ui/button";
import { Users, Plus, LogIn } from "lucide-react";

export default function GroupsEmptyState({ onCreate, onJoin }) {
  return (
    <div className="flex flex-col items-center text-center py-16 px-4 space-y-4">
      <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mb-2">
        <Users className="w-9 h-9 text-primary" />
      </div>
      <h3 className="text-lg font-bold text-foreground">Track habits together</h3>
      <p className="text-sm text-muted-foreground max-w-xs">
        Create a group or join one with an invite code — see how your streaks stack up against friends.
      </p>
      <div className="flex gap-3 mt-2">
        <Button onClick={onCreate} className="gap-2 rounded-full px-5">
          <Plus className="w-4 h-4" /> Create Group
        </Button>
        <Button variant="outline" onClick={onJoin} className="gap-2 rounded-full px-5">
          <LogIn className="w-4 h-4" /> Join Group
        </Button>
      </div>
    </div>
  );
}