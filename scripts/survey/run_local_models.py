"""Run the locally available detection models on a road's panorama cube faces and write engine-style COCO output.

For roads the shared engine has not processed yet. The output uses the same category names and supercategories as the
engine (usf-cv-project) so build_road.py treats both the same: masks for striping / road objects / access, boxes for
signs. Every image is source=prelabel (automatic, unreviewed).

Models (paths below): road objects = street features-seg oct6 (Guard Rail, Mail Box, PowerPole, lightpole);
striping = nov19 lane model; access = YOLO-Turnouts-jan13; signs = sign_model_v11_synth (coarse sign classes).

usage: run_local_models.py <faces_root> <out.json> [--limit N]
  faces_root/<station>/Img_<k>_2048.jpg, faces 0-3 (W, N, E, S)
"""

import argparse
import json
from pathlib import Path

import numpy as np
from ultralytics import YOLO

CV = Path.home() / "Downloads" / "CV-Code"
MODELS = [
    # (path, imgsz, conf, {model class -> (engine name, supercategory)}, kind)
    (CV / "Code 3/Trained Models/street features-seg/oct6.pt", 1024, 0.30,
     {"Guard Rail": ("Guard Rail", "road_objects"), "Mail Box": ("Mail Box", "road_objects"),
      "PowerPole": ("UtilityPole", "road_objects"), "lightpole": ("UtilityPole_light", "road_objects")}, "mask"),
    (CV / "Code 3/Trained Models/nov19/best (1).pt", 1024, 0.40,
     {n: (n, "striping") for n in ["CenterLine_No_Passing", "CenterLine_One_Way_Passing", "CenterLine_Two_Way_Passing", "LeftLane",
                                    "LeftPavementEdge", "LeftShoulderEdge", "RightLane", "RightPavementEdge", "RightShoulderEdge"]}, "mask"),
    (CV / "Code 2/Trained Models/YOLO-Turnouts-jan13.pt", 1024, 0.50, {"Turnout": ("access", "access")}, "mask"),
    (Path.home() / "Downloads/sign_model_v11_synth/v11/weights/best.pt", 1280, 0.35,
     {n: (n, "signs_coarse") for n in ["street_name", "stop", "intersection", "no_passing_zone", "stop_ahead", "curve", "two_direction_arrow",
                                        "regulatory_other", "warning_other", "speed_limit", "one_way", "informational", "school"]}, "box"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("out")
    ap.add_argument("--road", default="road")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    root = Path(a.root)
    stations = sorted([p for p in root.iterdir() if p.is_dir()], key=lambda p: int(p.name.split("_")[-1]))
    if a.limit:
        stations = stations[: a.limit]
    files = [s / f"Img_{k}_2048.jpg" for s in stations for k in range(4) if (s / f"Img_{k}_2048.jpg").exists()]
    images = [{"id": i + 1, "file_name": f"raw/{a.road}/{f.parent.name}/{f.name}", "width": 2048, "height": 2048, "source": "prelabel"}
              for i, f in enumerate(files)]
    cats, anns = {}, []
    for path, imgsz, conf, cmap, kind in MODELS:
        m = YOLO(str(path))
        print(path.name, flush=True)
        for i in range(0, len(files), 8):
            batch = files[i:i + 8]
            for j, r in enumerate(m.predict([str(f) for f in batch], imgsz=imgsz, conf=conf, verbose=False, device="mps", retina_masks=False)):
                img_id = i + j + 1
                for k in range(len(r.boxes)):
                    name = r.names[int(r.boxes.cls[k])]
                    if name not in cmap:
                        continue
                    ename, sup = cmap[name]
                    cid = cats.setdefault((ename, sup), len(cats) + 1)
                    x0, y0, x1, y1 = [float(v) for v in r.boxes.xyxy[k]]
                    ann = {"id": len(anns) + 1, "image_id": img_id, "category_id": cid, "iscrowd": 0,
                           "attributes": {"occluded": False, "score": round(float(r.boxes.conf[k]), 3)}}
                    if kind == "mask" and r.masks is not None:
                        poly = r.masks.xy[k]
                        if len(poly) < 3:
                            continue
                        step = max(1, len(poly) // 120)
                        poly = np.asarray(poly)[::step]
                        ann["segmentation"] = [np.round(poly.reshape(-1), 1).tolist()]
                        ann["bbox"] = []
                        ann["area"] = float(abs(np.dot(poly[:, 0], np.roll(poly[:, 1], 1)) - np.dot(poly[:, 1], np.roll(poly[:, 0], 1))) / 2)
                    else:
                        ann["segmentation"] = []
                        ann["bbox"] = [round(x0, 1), round(y0, 1), round(x1 - x0, 1), round(y1 - y0, 1)]
                        ann["area"] = (x1 - x0) * (y1 - y0)
                    anns.append(ann)
            if i % 400 == 0:
                print(f"  {i}/{len(files)} images, {len(anns)} annotations", flush=True)
    out = {"info": {"description": f"{a.road}: automatic detections from the local models in run_local_models.py; nothing reviewed."},
           "categories": [{"id": cid, "name": n, "supercategory": s} for (n, s), cid in cats.items()], "images": images, "annotations": anns}
    json.dump(out, open(a.out, "w"))
    print("wrote", a.out, len(images), "images", len(anns), "annotations")


if __name__ == "__main__":
    main()
