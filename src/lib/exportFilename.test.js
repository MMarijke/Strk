import { describe, it, expect } from "vitest";
import { exportFilename } from "./utils";

/**
 * The filename is the only pure part of the data export -- the rest is an
 * edge-function call and a Blob download, neither of which is meaningful
 * to assert against a mock.
 *
 * It is worth a test anyway, because the obvious implementation
 * (toISOString().slice(0, 10)) is wrong in a way nobody notices from the
 * timezone they wrote it in: it is UTC, so an export taken at 9pm in
 * Johannesburg or anywhere else east of Greenwich is fine, while one taken
 * at 8pm in New York is stamped with tomorrow's date. The user's file
 * should carry the date their own calendar showed.
 */
describe("exportFilename", () => {
  it("stamps the local calendar date, not UTC", () => {
    // 2026-03-01 01:30 local. In any timezone behind UTC this instant is
    // still 2026-02-28 or 2026-03-01 in UTC terms, and toISOString() would
    // disagree with the local date for roughly half the world.
    const local = new Date(2026, 2, 1, 1, 30);
    expect(exportFilename(local)).toBe("strk-my-data-2026-03-01.json");
  });

  it("zero-pads months and days", () => {
    expect(exportFilename(new Date(2026, 0, 5))).toBe("strk-my-data-2026-01-05.json");
  });

  it("does not drift across a late-evening export", () => {
    // 23:59 local on the last day of the year -- the case where a UTC
    // stamp would name next year for western timezones.
    const local = new Date(2026, 11, 31, 23, 59);
    expect(exportFilename(local)).toBe("strk-my-data-2026-12-31.json");
  });

  it("is a .json file with a recognisable prefix", () => {
    expect(exportFilename()).toMatch(/^strk-my-data-\d{4}-\d{2}-\d{2}\.json$/);
  });
});
