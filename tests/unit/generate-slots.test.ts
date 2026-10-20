import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { generateSlots, type Rule, type SlotInput } from "@/lib/availability/generate-slots";

const weekdays = (startTime: string, endTime: string, days = [1, 2, 3, 4, 5]): Rule[] =>
  days.map((weekday) => ({
    weekday,
    startTime,
    endTime,
    validFrom: "2020-01-01",
    validUntil: null,
  }));

function base(overrides: Partial<SlotInput> = {}): SlotInput {
  return {
    zone: "America/Lima",
    rules: weekdays("09:00", "12:00"),
    exceptions: [],
    booked: [],
    externalBusy: [],
    now: new Date("2027-03-01T00:00:00Z"),
    from: new Date("2027-03-01T00:00:00Z"),
    to: new Date("2027-03-08T00:00:00Z"),
    durationMinutes: 30,
    slotIntervalMinutes: 30,
    minNoticeMinutes: 0,
    maxAdvanceDays: 60,
    ...overrides,
  };
}

const local = (slot: { startsAt: Date }, zone: string) =>
  DateTime.fromJSDate(slot.startsAt, { zone }).toFormat("yyyy-MM-dd HH:mm");

describe("generateSlots", () => {
  it("expands wall-clock rules in the clinic zone (Lima, UTC-5, no DST)", () => {
    const slots = generateSlots(
      base({ from: new Date("2027-03-01T00:00:00Z"), to: new Date("2027-03-02T00:00:00Z") }),
    );
    // Monday 2027-03-01 local 09:00-12:00 => 14:00Z-17:00Z, six 30-minute slots
    expect(slots).toHaveLength(6);
    expect(slots[0]?.startsAt.toISOString()).toBe("2027-03-01T14:00:00.000Z");
    expect(slots[5]?.endsAt.toISOString()).toBe("2027-03-01T17:00:00.000Z");
  });

  it("removes slots overlapping a booking, an external busy block and a block exception", () => {
    const slots = generateSlots(
      base({
        from: new Date("2027-03-01T00:00:00Z"),
        to: new Date("2027-03-02T00:00:00Z"),
        booked: [
          { startsAt: new Date("2027-03-01T14:00:00Z"), endsAt: new Date("2027-03-01T14:30:00Z") },
        ],
        externalBusy: [
          { startsAt: new Date("2027-03-01T14:45:00Z"), endsAt: new Date("2027-03-01T15:15:00Z") },
        ],
        exceptions: [
          {
            type: "block",
            startsAt: new Date("2027-03-01T16:00:00Z"),
            endsAt: new Date("2027-03-01T17:00:00Z"),
          },
        ],
      }),
    );
    expect(slots.map((s) => s.startsAt.toISOString().slice(11, 16))).toEqual(["15:30"]);
  });

  it("an open exception adds hours outside the rules", () => {
    const slots = generateSlots(
      base({
        from: new Date("2027-03-06T00:00:00Z"), // Saturday local, no rule
        to: new Date("2027-03-07T12:00:00Z"),
        exceptions: [
          {
            type: "open",
            startsAt: new Date("2027-03-06T15:00:00Z"),
            endsAt: new Date("2027-03-06T16:00:00Z"),
          },
        ],
      }),
    );
    expect(slots).toHaveLength(2);
  });

  it("honours minimum notice and maximum advance", () => {
    const now = new Date("2027-03-01T14:10:00Z");
    const noticed = generateSlots(
      base({ now, from: now, minNoticeMinutes: 60, to: new Date("2027-03-02T00:00:00Z") }),
    );
    expect(noticed[0]?.startsAt.toISOString()).toBe("2027-03-01T15:30:00.000Z");
    const far = generateSlots(base({ maxAdvanceDays: 2, to: new Date("2027-03-20T00:00:00Z") }));
    expect(
      far.every((s) => s.startsAt.getTime() <= new Date("2027-03-03T00:00:00Z").getTime()),
    ).toBe(true);
  });

  it("respects validFrom / validUntil", () => {
    const rules: Rule[] = [
      {
        weekday: 1,
        startTime: "09:00",
        endTime: "10:00",
        validFrom: "2027-03-08",
        validUntil: null,
      },
    ];
    const slots = generateSlots(
      base({ rules, from: new Date("2027-03-01T00:00:00Z"), to: new Date("2027-03-15T00:00:00Z") }),
    );
    expect(slots.map((s) => local(s, "America/Lima"))).toEqual([
      "2027-03-08 09:00",
      "2027-03-08 09:30",
    ]);
  });

  it.each([
    ["America/Lima", "2027-03-01T14:00:00.000Z"],
    ["Asia/Kolkata", "2027-03-01T03:30:00.000Z"], // UTC+5:30
    ["America/Santiago", "2027-03-01T12:00:00.000Z"], // southern-hemisphere DST (UTC-3 in March)
    ["UTC", "2027-03-01T09:00:00.000Z"],
  ])("first Monday slot for %s starts at local 09:00", (zone, expectedUtc) => {
    const slots = generateSlots(
      base({ zone, from: new Date("2027-02-28T00:00:00Z"), to: new Date("2027-03-02T00:00:00Z") }),
    );
    const first = slots.find(
      (s) => DateTime.fromJSDate(s.startsAt, { zone }).toISODate() === "2027-03-01",
    );
    expect(first?.startsAt.toISOString()).toBe(expectedUtc);
    expect(local(first as { startsAt: Date }, zone)).toBe("2027-03-01 09:00");
  });

  it("keeps wall-clock 09:00 across a DST change (Santiago, DST ends 2027-04-03/04)", () => {
    const rules = weekdays("09:00", "09:30", [1, 2, 3, 4, 5, 6, 7]);
    const slots = generateSlots(
      base({
        zone: "America/Santiago",
        rules,
        from: new Date("2027-04-01T00:00:00Z"),
        to: new Date("2027-04-07T00:00:00Z"),
      }),
    );
    expect(
      new Set(
        slots.map((s) =>
          DateTime.fromJSDate(s.startsAt, { zone: "America/Santiago" }).toFormat("HH:mm"),
        ),
      ),
    ).toEqual(new Set(["09:00"]));
    expect(new Set(slots.map((s) => s.startsAt.getUTCHours())).size).toBe(2); // the UTC hour moved
  });

  it("emits no slot inside a spring-forward gap (Madrid 2027-03-28, 02:00-03:00 does not exist)", () => {
    const rules = weekdays("01:00", "05:00", [7]);
    const slots = generateSlots(
      base({
        zone: "Europe/Madrid",
        rules,
        durationMinutes: 60,
        slotIntervalMinutes: 60,
        from: new Date("2027-03-27T00:00:00Z"),
        to: new Date("2027-03-29T00:00:00Z"),
      }),
    );
    expect(slots.map((s) => local(s, "Europe/Madrid"))).toEqual([
      "2027-03-28 01:00",
      "2027-03-28 03:00",
      "2027-03-28 04:00",
    ]);
  });

  it("emits each real hour once on a fall-back day (Madrid 2027-10-31, 02:00-03:00 occurs twice)", () => {
    const rules = weekdays("01:00", "04:00", [7]);
    const slots = generateSlots(
      base({
        zone: "Europe/Madrid",
        rules,
        durationMinutes: 60,
        slotIntervalMinutes: 60,
        now: new Date("2027-10-01T00:00:00Z"),
        from: new Date("2027-10-30T00:00:00Z"),
        to: new Date("2027-11-01T00:00:00Z"),
      }),
    );
    expect(slots).toHaveLength(4);
    expect(new Set(slots.map((s) => s.startsAt.getTime())).size).toBe(4);
  });

  it("is pure: does not mutate its input", () => {
    const input = base();
    const snapshot = JSON.stringify(input);
    generateSlots(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
