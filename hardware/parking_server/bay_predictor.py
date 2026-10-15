"""TransitSense · Bay predictor (runs on the server that receives the ESP32-CAM frames).

The zone cameras report which bays are occupied. From the garage's history the
server knows roughly how many cars arrive and leave per minute, and which parked
cars are likely to leave first (longest-parked, expiring tickets, ...). To answer
"Will there be a bay for me when I arrive, and where?" it replays the predicted
departures and arrivals up to the driver's arrival time, bay by bay:

* a departure frees that car's bay;
* every earlier arrival takes the best free bay (shortest drive from the entrance);
* the driver is offered the best bay still free on arrival, plus a backup.

If no bay is left, it searches later arrival times for the next predicted opening.
This is the same logic the website demo runs (dist/model.mjs, planArrival).
"""

import math
from dataclasses import dataclass, field


@dataclass
class Plan:
    bay: int | None
    backup: int | None
    free_bays: list[int]
    freed_at: float | None          # minutes until the offered bay is freed (None = free already)
    turned_away: int
    events: list[tuple[float, str, int | None]] = field(default_factory=list)


def round_half_up(x):
    return math.floor(x + 0.5)  # matches JavaScript's Math.round (Python's round() rounds halves to even)


def plan_arrival(occupied, minutes, cost, depart_order, arrive_per_min=0.9, depart_per_min=0.45):
    state = list(occupied)
    departures = min(round_half_up(minutes * depart_per_min), len(depart_order))
    arrivals = round_half_up(minutes * arrive_per_min)
    events = [((k + 0.5) / depart_per_min, "depart", depart_order[k]) for k in range(departures)]
    events += [((k + 0.5) / arrive_per_min, "arrive", None) for k in range(arrivals)]
    events.sort(key=lambda e: (e[0], e[1] != "depart"))

    def best_free():
        free = [i for i, taken in enumerate(state) if not taken]
        return min(free, key=lambda i: (cost[i], i)) if free else None

    freed_at, played, turned_away = {}, [], 0
    for t, kind, bay in events:
        if kind == "depart":
            state[bay] = False
            freed_at[bay] = t
        else:
            bay = best_free()
            if bay is None:
                turned_away += 1
            else:
                state[bay] = True
                freed_at.pop(bay, None)
        played.append((t, kind, bay))

    free_bays = sorted((i for i, taken in enumerate(state) if not taken), key=lambda i: (cost[i], i))
    bay = free_bays[0] if free_bays else None
    return Plan(
        bay=bay,
        backup=free_bays[1] if len(free_bays) > 1 else None,
        free_bays=free_bays,
        freed_at=freed_at.get(bay) if bay is not None else None,
        turned_away=turned_away,
        events=played,
    )


def next_opening(occupied, minutes, cost, depart_order, horizon=30, **rates):
    for m in range(minutes + 1, minutes + horizon + 1):
        if plan_arrival(occupied, m, cost, depart_order, **rates).bay is not None:
            return m
    return None


def bay_name(index, bays_per_zone=10):
    return f"{'ABC'[index // bays_per_zone]}-{index % bays_per_zone + 1:02d}"


if __name__ == "__main__":
    # 30 bays in zones A, B, C; True = occupied (as reported by the three ESP32-CAMs).
    occupied = [i in {0, 1, 3, 4, 6, 7, 10, 11, 13, 14, 16, 18, 20, 21, 22, 24, 26, 28} for i in range(30)]
    cost = [abs(i % 10 - 9) * 3.6 + (10 if i < 10 else 5 if i < 20 else 0) for i in range(30)]  # metres from entrance
    depart_order = [i for i, taken in enumerate(occupied) if taken]  # from camera history: who leaves first

    for eta, rates in [(10, {}), (12, {"arrive_per_min": 1.5, "depart_per_min": 0.3})]:
        plan = plan_arrival(occupied, eta, cost, depart_order, **rates)
        if plan.bay is None:
            later = next_opening(occupied, eta, cost, depart_order, **rates)
            print(f"Arriving in {eta} min: garage predicted full; next opening in {later} min")
        else:
            reason = "free now" if plan.freed_at is None else f"freed by a departure at ~{plan.freed_at:.0f} min"
            print(f"Arriving in {eta} min: go to bay {bay_name(plan.bay)} ({reason}); backup {bay_name(plan.backup) if plan.backup is not None else 'none'}")
