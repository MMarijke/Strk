import React, { useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { requestNotificationPermission } from "@/lib/notificationService";

const DAYS = [
  { label: "Su", value: 0 },
  { label: "Mo", value: 1 },
  { label: "Tu", value: 2 },
  { label: "We", value: 3 },
  { label: "Th", value: 4 },
  { label: "Fr", value: 5 },
  { label: "Sa", value: 6 },
];

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

// Convert 24h "HH:MM" to 12h display
function to12h(time24) {
  if (!time24) return { hour: "8", minute: "00", ampm: "AM" };
  const [h, m] = time24.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? "12" : String(h % 12);
  return { hour, minute: String(m).padStart(2, "0"), ampm };
}

// Convert 12h parts back to 24h "HH:MM"
function to24h(hour, minute, ampm) {
  let h = Number(hour);
  if (ampm === "AM" && h === 12) h = 0;
  if (ampm === "PM" && h !== 12) h += 12;
  return `${String(h).padStart(2, "0")}:${minute}`;
}

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = ["00", "15", "30", "45"];

export default function ReminderSection({ reminderTime, reminderDays, onChange }) {
  const enabled = !!reminderTime;
  const [permissionDenied, setPermissionDenied] = useState(
    typeof Notification !== "undefined" && Notification.permission === "denied"
  );

  const parsed = to12h(reminderTime);
  const [hour, setHour] = useState(parsed.hour);
  const [minute, setMinute] = useState(parsed.minute);
  const [ampm, setAmpm] = useState(parsed.ampm);
  const activeDays = reminderDays || ALL_DAYS;

  const handleToggle = async () => {
    if (!enabled) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        setPermissionDenied(true);
        return;
      }
      setPermissionDenied(false);
      onChange({ reminderTime: to24h(hour, minute, ampm), reminderDays: activeDays });
    } else {
      onChange({ reminderTime: "", reminderDays: [] });
    }
  };

  const updateTime = (h, m, ap) => {
    if (enabled) onChange({ reminderTime: to24h(h, m, ap), reminderDays: activeDays });
  };

  const toggleDay = (day) => {
    const next = activeDays.includes(day)
      ? activeDays.filter((d) => d !== day)
      : [...activeDays, day].sort((a, b) => a - b);
    if (next.length === 0) return; // must keep at least 1 day
    onChange({ reminderTime, reminderDays: next });
  };

  return (
    <div className="space-y-3 border-t border-border pt-4">
      {/* Toggle row */}
      <button
        type="button"
        onClick={handleToggle}
        className="flex items-center justify-between w-full group"
      >
        <div className="flex items-center gap-2">
          {enabled
            ? <Bell className="w-4 h-4 text-primary" />
            : <BellOff className="w-4 h-4 text-muted-foreground" />
          }
          <Label className="text-sm font-medium cursor-pointer">
            {enabled ? "Reminder on" : "Set a reminder"}
          </Label>
        </div>
        <div className={cn(
          "w-10 h-6 rounded-full transition-colors duration-200 relative",
          enabled ? "bg-primary" : "bg-muted"
        )}>
          <div className={cn(
            "absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all duration-200",
            enabled ? "left-5" : "left-1"
          )} />
        </div>
      </button>

      {/* Permission denied message */}
      {permissionDenied && (
        <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
          Notifications are blocked. Enable them in your browser settings to use reminders.
        </p>
      )}

      {/* Time & day picker */}
      {enabled && !permissionDenied && (
        <div className="space-y-3 pl-1">
          {/* Time picker */}
          <div className="flex items-center gap-2">
            <select
              value={hour}
              onChange={(e) => { setHour(e.target.value); updateTime(e.target.value, minute, ampm); }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
            <span className="text-muted-foreground font-bold">:</span>
            <select
              value={minute}
              onChange={(e) => { setMinute(e.target.value); updateTime(hour, e.target.value, ampm); }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select
              value={ampm}
              onChange={(e) => { setAmpm(e.target.value); updateTime(hour, minute, e.target.value); }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          </div>

          {/* Day chips */}
          <div className="flex gap-1.5 flex-wrap">
            {DAYS.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => toggleDay(d.value)}
                className={cn(
                  "w-9 h-9 rounded-full text-xs font-semibold transition-all",
                  activeDays.includes(d.value)
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}