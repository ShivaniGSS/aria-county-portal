"""
Generate synthetic maintenance tasks, crews, work orders, and programs/budget for
the Boone County maintenance heatmap.

None of this operational data (personnel, work orders, budgets, programs) exists
anywhere real -- not locally, not publicly -- confirmed with the user 2026-09-17, who
explicitly approved fabricating it as clearly-tagged synthetic placeholder data, the
same pattern already used for pavement_synthetic.geojson in v1. The 6 real flagged
signs (from signs_with_segment.geojson) become real task instances in this same
system rather than a separate thing -- everything else is synthetic.

Anchored to a --now date (default: today) so the complete/in-progress/critical mix
doesn't silently decay as real time passes -- regenerate before a demo:
    python3 scripts/generate_synthetic_tasks.py --now 2026-09-17

Outputs: public/data/crews.json, programs.json, work_orders.json, maintenance_tasks.json
"""
import argparse
import json
import random
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
RNG_SEED = 42

TASK_TYPE_WEIGHTS = {
    "pothole_patching": 20, "crack_sealing": 14, "shoulder_repair": 8,
    "culvert_cleaning": 10, "ditch_regrading": 6,
    "mowing": 16, "debris_removal": 10,
    "sign_replacement": 8, "pavement_marking_restripe": 6,
    "guardrail_repair": 5, "guardrail_end_treatment_upgrade": 2,
    "culvert_structure_repair": 3, "bridge_deck_patch_followup": 2,
}

CREW_DEFS = [
    {"id": "crew_belvidere", "name": "Belvidere Section Crew", "zone_id": "belvidere", "size": 4},
    {"id": "crew_caledonia", "name": "Caledonia Section Crew", "zone_id": "caledonia", "size": 3},
    {"id": "crew_spring_flora", "name": "Spring/Flora Section Crew", "zone_id": "spring", "size": 3},
    {"id": "crew_poplar_manchester", "name": "Poplar Grove/Manchester Section Crew", "zone_id": "poplar_grove", "size": 3},
    {"id": "crew_bonus_leroy_boone", "name": "Bonus/LeRoy/Boone Section Crew", "zone_id": "bonus", "size": 3},
    {"id": "crew_signs_striping", "name": "Signs & Striping Crew (countywide)", "zone_id": None, "size": 2},
    {"id": "crew_bridge_structures", "name": "Bridge & Structures Crew (countywide)", "zone_id": None, "size": 3},
    {"id": "crew_mowing_roadside", "name": "Mowing & Roadside Crew (countywide)", "zone_id": None, "size": 4},
]

PROGRAM_DEFS = [
    {"id": "prog_routine", "name": "FY2027 Routine Maintenance", "funding_source": "County General Fund", "budget_total": 480_000},
    {"id": "prog_hsip", "name": "FY2027 Highway Safety Improvement Program", "funding_source": "Federal HSIP", "budget_total": 220_000},
    {"id": "prog_resurfacing", "name": "FY2027 Capital Resurfacing Program", "funding_source": "IDOT MFT + County Match", "budget_total": 650_000},
]

ZONE_FOR_CREW_FALLBACK = ["belvidere", "caledonia", "spring", "poplar_grove", "bonus", "manchester", "flora", "leroy", "boone"]


def load_json(path):
    with open(path) as f:
        return json.load(f)


def pick_task_type(rng):
    ids, weights = zip(*TASK_TYPE_WEIGHTS.items())
    return rng.choices(ids, weights=weights, k=1)[0]


def crew_for_zone(zone_id, rng):
    zone_crews = [c for c in CREW_DEFS if c["zone_id"] == zone_id]
    countywide = [c for c in CREW_DEFS if c["zone_id"] is None]
    pool = zone_crews if zone_crews else countywide
    return rng.choice(pool)["id"]


def program_for_task_type(task_type_id):
    family_program = {
        "sign_replacement": "prog_hsip", "guardrail_repair": "prog_hsip",
        "guardrail_end_treatment_upgrade": "prog_hsip",
        "pothole_patching": "prog_resurfacing", "crack_sealing": "prog_resurfacing",
        "shoulder_repair": "prog_resurfacing",
    }
    return family_program.get(task_type_id, "prog_routine")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--now", type=str, default=None, help="Anchor date YYYY-MM-DD (default: today)")
    args = parser.parse_args()
    now = date.fromisoformat(args.now) if args.now else date.today()
    rng = random.Random(RNG_SEED)

    task_types = load_json(DATA / "task_types.json")["task_types"]
    task_type_by_id = {t["id"]: t for t in task_types}
    segments = load_json(DATA / "maintenance_segments.geojson")["features"]
    signs = load_json(DATA / "signs_with_segment.geojson")["features"]

    # --- crews & programs (pure reference data, no dependency on tasks) ---
    crews = [{**c, "source": "synthetic_placeholder"} for c in CREW_DEFS]
    with open(DATA / "crews.json", "w") as f:
        json.dump({"generated_at": now.isoformat(), "crews": crews}, f, indent=2)
    print(f"crews.json: {len(crews)} crews")

    programs = [
        {**p, "budget_spent": round(p["budget_total"] * rng.uniform(0.25, 0.7), 2), "source": "synthetic_placeholder"}
        for p in PROGRAM_DEFS
    ]
    with open(DATA / "programs.json", "w") as f:
        json.dump({"generated_at": now.isoformat(), "programs": programs}, f, indent=2)
    print(f"programs.json: {len(programs)} programs")

    schedulable = []  # (task, zone_id) pairs still needing a crew/date assignment
    segment_zone = {f["properties"]["segment_id"]: f["properties"]["zone_id"] for f in segments}

    # --- real task instances: the 6 flagged signs ---
    # Status stays 'not_started' -- that's the honest real state (no evidence any
    # repair has happened). Most still enter the scheduling pool below so some get a
    # future work order/crew assigned, demonstrating "real detection -> synthetic
    # response workflow" end to end rather than leaving all 6 permanently unscheduled.
    tasks = []
    task_counter = 0
    for feat in signs:
        p = feat["properties"]
        if p["review_status"] != "flagged":
            continue
        task_counter += 1
        date_identified = now - timedelta(days=rng.randint(10, 50))
        task = {
            "id": f"task_{task_counter:04d}",
            "task_type_id": "sign_replacement",
            "target_type": "point_asset",
            "target_id": p["sign_id"],
            "segment_id": p["segment_id"],
            "status": "not_started",
            "date_identified": date_identified.isoformat(),
            "date_completed": None,
            "work_order_id": None,
            "source": "real",
            "source_detail": f"Real MUTCD compliance flag: {'; '.join(p['violations'])}",
        }
        tasks.append(task)
        if rng.random() < 0.5:
            schedulable.append((task, segment_zone.get(p["segment_id"])))

    # --- synthetic task instances sprinkled across the county network ---
    eligible_segments = [f["properties"]["segment_id"] for f in segments]
    n_active_segments = int(len(eligible_segments) * 0.10)
    active_segments = rng.sample(eligible_segments, n_active_segments)

    STATUS_WEIGHTS = {"complete": 0.40, "in_progress": 0.15, "not_started": 0.45}

    for seg_id in active_segments:
        n_tasks = rng.choices([1, 2, 3], weights=[60, 30, 10], k=1)[0]
        chosen_types = rng.sample(list(TASK_TYPE_WEIGHTS.keys()), k=min(n_tasks, len(TASK_TYPE_WEIGHTS)))
        for task_type_id in chosen_types:
            task_counter += 1
            status = rng.choices(list(STATUS_WEIGHTS.keys()), weights=list(STATUS_WEIGHTS.values()), k=1)[0]
            target_window = task_type_by_id[task_type_id]["default_target_response_days"]

            if status == "complete":
                date_identified = now - timedelta(days=rng.randint(target_window, target_window + 150))
                date_completed = date_identified + timedelta(days=rng.randint(1, target_window))
                if date_completed > now:
                    date_completed = now
            else:
                # spread identification dates so some are fresh and some are badly overdue
                date_identified = now - timedelta(days=rng.randint(0, int(target_window * 2.5) + 20))
                date_completed = None

            task = {
                "id": f"task_{task_counter:04d}",
                "task_type_id": task_type_id,
                "target_type": "segment",
                "target_id": seg_id,
                "segment_id": seg_id,
                "status": status,
                "date_identified": date_identified.isoformat(),
                "date_completed": date_completed.isoformat() if date_completed else None,
                "work_order_id": None,
                "source": "synthetic_placeholder",
                "source_detail": None,
            }
            tasks.append(task)
            if status != "not_started" or rng.random() < 0.5:
                schedulable.append((task, segment_zone.get(seg_id)))

    # --- bundle schedulable tasks into work orders: same crew + same day gets grouped ---
    work_orders = {}
    wo_counter = 0
    for task, zone_id in schedulable:
        crew_id = crew_for_zone(zone_id, rng)
        task_type = task_type_by_id[task["task_type_id"]]

        if task["status"] == "complete":
            scheduled_date = date.fromisoformat(task["date_completed"])
        elif task["status"] == "in_progress":
            scheduled_date = now - timedelta(days=rng.randint(0, 5))
        else:
            scheduled_date = now + timedelta(days=rng.randint(1, 30))

        key = (crew_id, scheduled_date.isoformat())
        if key not in work_orders:
            wo_counter += 1
            work_orders[key] = {
                "id": f"wo_{wo_counter:04d}",
                "crew_id": crew_id,
                "scheduled_date": scheduled_date.isoformat(),
                "program_id": program_for_task_type(task["task_type_id"]),
                "task_ids": [],
                "cost_estimate": 0,
                "source": "synthetic_placeholder",
            }
        wo = work_orders[key]
        wo["task_ids"].append(task["id"])
        wo["cost_estimate"] += round(rng.uniform(300, 4500) * task_type["severity_weight"] / 3, 2)
        task["work_order_id"] = wo["id"]

    work_order_list = list(work_orders.values())
    with open(DATA / "work_orders.json", "w") as f:
        json.dump({"generated_at": now.isoformat(), "work_orders": work_order_list}, f, indent=2)
    print(f"work_orders.json: {len(work_order_list)} work orders")

    with open(DATA / "maintenance_tasks.json", "w") as f:
        json.dump({"generated_at": now.isoformat(), "tasks": tasks}, f, indent=2)

    status_counts = {}
    for t in tasks:
        status_counts[t["status"]] = status_counts.get(t["status"], 0) + 1
    real_count = sum(1 for t in tasks if t["source"] == "real")
    print(f"maintenance_tasks.json: {len(tasks)} tasks ({real_count} real, {len(tasks) - real_count} synthetic)")
    print(f"  status mix: {status_counts}")
    print(f"  anchor date (now): {now.isoformat()}")


if __name__ == "__main__":
    main()
