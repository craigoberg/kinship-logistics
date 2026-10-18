# Offline Trip Deliver (venues)

## Link (locked 2026-10-17)

The tablet is offline when the DEV switch is on, the browser has no link, or a 2-second health read fails. One slow screen does not latch it. The latch survives a refresh. Once a minute the health read is tried again. A reply clears the latch. While the latch is on, database reads and writes are not sent, so a later success cannot replace what is already on the tablet.

The link above is in the app. The rest of the day is agreed and not finished yet: opening the event card downloads the whole day, and meals, medication, and close day run from that copy. A gate uses this tablet’s own record. It does not invent people who were never downloaded.

**Locked with the build 2026-10-17.** This is the practice note for the Policies & Procedures pack (BL-092). It is not the signed policy. Do not drop it when the trip / safeguarding procedure is written.

Help for the floor: Event Deliver — Day happy path, step **No signal at a venue**. Bus hops stay in `OFFLINE-BUS-HEADCOUNT.md`.

## What the tablet keeps

While Trip Deliver can reach the server, it downloads:

- who is on today’s check-in and check-out roll
- support staff, volunteers, and carers on that roll
- the day’s venue stops
- the activity roll for a venue that has been opened

That download is the last known list.

## When the venue has no signal

Check-in, check-out, opening a venue (walk, other, or on site), closing it, activity check-in, and morning or evening roll save on this tablet. The amber bar shows how many taps are waiting. They upload in the order they were made, stamped with the time of the tap.

Open Trip Deliver once while there is still signal. If this tablet never downloaded today’s list, it cannot invent names.

## Still needs signal

Meals, medication rounds, and Close day. Those are next, from the download on the event card. A bus destination still opens from Manifest when the hop arrives, including **Start this leg anyway** when the group has not been released.

## Office

The office sees the taps after they upload. Do not re-tick a person the tablet already marked. If two tablets marked the same person before either uploaded, confirm which tap stands.
