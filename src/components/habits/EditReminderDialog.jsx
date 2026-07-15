import React, { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import ReminderSection from "./ReminderSection";

export default function EditReminderDialog({ open, onOpenChange, habit, onSave }) {
  const [reminderTime, setReminderTime] = useState(habit?.reminder_time || "");
  const [reminderDays, setReminderDays] = useState(habit?.reminder_days ?? [0, 1, 2, 3, 4, 5, 6]);

  const handleChange = ({ reminderTime: rt, reminderDays: rd }) => {
    setReminderTime(rt ?? reminderTime);
    setReminderDays(rd ?? reminderDays);
  };

  const handleSave = () => {
    onSave({ reminder_time: reminderTime, reminder_days: reminderDays });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Edit Reminder</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">
          Set a daily or weekly reminder for <strong>{habit?.name}</strong>.
        </p>

        <ReminderSection
          reminderTime={reminderTime}
          reminderDays={reminderDays}
          onChange={handleChange}
        />

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}