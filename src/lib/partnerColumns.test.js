import { describe, it, expect } from "vitest";
import { groupPartnerColumns, describeToday } from "./partnerColumns";

const row = (over = {}) => ({
  partnership_id: "p1",
  side: "you",
  user_email: "me@example.com",
  display_name: "Me",
  avatar_color: "blue",
  habit_id: null,
  habit_name: null,
  current_streak: null,
  completed_today: null,
  ...over,
});

describe("groupPartnerColumns", () => {
  it("returns null for zero rows, which is how an ended partnership reads", () => {
    expect(groupPartnerColumns([])).toBeNull();
    expect(groupPartnerColumns()).toBeNull();
    expect(groupPartnerColumns(null)).toBeNull();
  });

  it("splits rows by side and carries the partnership id", () => {
    const out = groupPartnerColumns([
      row({ side: "you", habit_id: "h1", habit_name: "Gym", current_streak: 4, completed_today: true }),
      row({ side: "partner", user_email: "jo@example.com", display_name: "Jo", habit_id: "h2", habit_name: "Reading", current_streak: 9, completed_today: false }),
    ]);
    expect(out.partnershipId).toBe("p1");
    expect(out.you.habits).toEqual([{ id: "h1", name: "Gym", streak: 4, completedToday: true }]);
    expect(out.partner.name).toBe("Jo");
    expect(out.partner.habits[0].streak).toBe(9);
  });

  // The null-habit row is the left join reporting a real person who has
  // shared nothing. It must give identity without inventing a habit.
  it("keeps identity from a null-habit row without listing a nameless habit", () => {
    const out = groupPartnerColumns([
      row({ side: "partner", user_email: "jo@example.com", display_name: "Jo", avatar_color: "red" }),
    ]);
    expect(out.partner.name).toBe("Jo");
    expect(out.partner.avatarColor).toBe("red");
    expect(out.partner.habits).toEqual([]);
    expect(out.partner.total).toBe(0);
    expect(out.you).toBeNull();
  });

  it("counts today across several habits", () => {
    const out = groupPartnerColumns([
      row({ habit_id: "h1", habit_name: "A", completed_today: true }),
      row({ habit_id: "h2", habit_name: "B", completed_today: false }),
      row({ habit_id: "h3", habit_name: "C", completed_today: true }),
    ]);
    expect(out.you.doneToday).toBe(2);
    expect(out.you.total).toBe(3);
  });

  it("defaults a null streak to 0 rather than rendering null", () => {
    const out = groupPartnerColumns([
      row({ habit_id: "h1", habit_name: "A", current_streak: null }),
    ]);
    expect(out.you.habits[0].streak).toBe(0);
    expect(out.you.habits[0].completedToday).toBe(false);
  });
});

describe("describeToday", () => {
  // "0 of 0" would read as a score. A side that shares nothing has not
  // failed at anything, so it gets different words entirely.
  it("never scores a side that shares nothing", () => {
    expect(describeToday({ doneToday: 0, total: 0 })).toBe("Nothing shared");
    expect(describeToday(null)).toBe("Nothing shared");
  });

  it("reads naturally at the edges", () => {
    expect(describeToday({ doneToday: 0, total: 3 })).toBe("None of 3 today");
    expect(describeToday({ doneToday: 1, total: 1 })).toBe("Done today");
    expect(describeToday({ doneToday: 3, total: 3 })).toBe("All 3 today");
    expect(describeToday({ doneToday: 2, total: 3 })).toBe("2 of 3 today");
  });
});
