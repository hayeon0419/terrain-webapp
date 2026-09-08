import math
import os
import uuid

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import buildings as buildings_mod
import convert as convert_mod
import dem as dem_mod
import preview as preview_mod

load_dotenv()

OPENTOPOGRAPHY_API_KEY = os.getenv("OPENTOPOGRAPHY_API_KEY", "")
VWORLD_API_KEY = os.getenv("VWORLD_API_KEY", "")
VWORLD_DOMAIN = os.getenv("VWORLD_DOMAIN", "localhost")
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]

OUTPUTS_DIR = os.path.join(os.path.dirname(__file__), "outputs")
os.makedirs(OUTPUTS_DIR, exist_ok=True)

app = FastAPI(title="지형모델러 edu backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS or ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/outputs", StaticFiles(directory=OUTPUTS_DIR), name="outputs")


class Area(BaseModel):
    type: str
    center: list[float] | None = None
    radius_m: float | None = None
    bbox: list[float] | None = None


class ProcessRequest(BaseModel):
    area: Area
    layers: list[str]
    contourInterval: float = 1.0
    formats: list[str] = []
    demtype: str = "SRTMGL1"
    vworldTypename: str = "lt_c_spbd"


def area_to_bbox(area: Area) -> dict:
    if area.type == "circle":
        if not area.center or not area.radius_m:
            raise HTTPException(400, "circle 타입은 center와 radius_m이 필요합니다")
        lat0, lon0 = area.center
        m_per_deg_lat = 111320.0
        m_per_deg_lon = 111320.0 * math.cos(math.radians(lat0))
        d_lat = area.radius_m / m_per_deg_lat
        d_lon = area.radius_m / m_per_deg_lon
        return {
            "south": lat0 - d_lat,
            "north": lat0 + d_lat,
            "west": lon0 - d_lon,
            "east": lon0 + d_lon,
        }
    if area.type == "rect":
        if not area.bbox or len(area.bbox) != 4:
            raise HTTPException(400, "rect 타입은 bbox [minLng, minLat, maxLng, maxLat]가 필요합니다")
        west, south, east, north = area.bbox
        return {"south": south, "north": north, "west": west, "east": east}
    raise HTTPException(400, f"알 수 없는 area.type: {area.type}")


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "opentopography_key_configured": bool(OPENTOPOGRAPHY_API_KEY),
        "vworld_key_configured": bool(VWORLD_API_KEY),
    }


@app.post("/api/buildings")
def get_buildings(area: Area, typename: str = "lt_c_spbd"):
    if not VWORLD_API_KEY:
        raise HTTPException(500, "서버에 VWORLD_API_KEY가 설정되어 있지 않습니다")
    bbox = area_to_bbox(area)
    geojson = buildings_mod.fetch_buildings_geojson(bbox, VWORLD_API_KEY, VWORLD_DOMAIN, typename)
    return geojson


@app.post("/api/process")
def process(req: ProcessRequest):
    bbox = area_to_bbox(req.area)
    lat0 = (bbox["south"] + bbox["north"]) / 2
    lon0 = (bbox["west"] + bbox["east"]) / 2

    contours = []
    terrain_vertices, terrain_faces = None, []
    if "contour" in req.layers:
        if not OPENTOPOGRAPHY_API_KEY:
            raise HTTPException(500, "서버에 OPENTOPOGRAPHY_API_KEY가 설정되어 있지 않습니다")
        tif_bytes = dem_mod.fetch_dem_bytes(bbox, req.demtype, OPENTOPOGRAPHY_API_KEY)
        elevation, transform = dem_mod.load_dem(tif_bytes)
        contours = dem_mod.extract_contours(elevation, transform, req.contourInterval, lon0, lat0)
        terrain_vertices, terrain_faces = dem_mod.build_terrain_mesh(elevation, transform, lon0, lat0)

    buildings = []
    building_warning = None
    if "building" in req.layers:
        if not VWORLD_API_KEY:
            building_warning = "서버에 VWORLD_API_KEY가 설정되어 있지 않아 건물 조회를 건너뛰었습니다"
        else:
            try:
                geojson = buildings_mod.fetch_buildings_geojson(bbox, VWORLD_API_KEY, VWORLD_DOMAIN, req.vworldTypename)
                buildings = buildings_mod.buildings_to_meshes(geojson, lon0, lat0)
            except Exception as exc:
                building_warning = (
                    f"VWorld 건물 조회 실패: {exc} "
                    "(VWorld는 해외 서버 IP를 차단합니다 — 국내 네트워크에서 백엔드를 실행해야 동작합니다)"
                )

    job_id = uuid.uuid4().hex[:12]
    job_dir = os.path.join(OUTPUTS_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)

    radius_hint = req.area.radius_m
    preview_path = os.path.join(job_dir, "preview.png")
    preview_mod.generate_preview(contours, buildings, preview_path, radius_hint_m=radius_hint)

    result = {
        "job_id": job_id,
        "preview_url": f"/outputs/{job_id}/preview.png",
        "contour_count": len(contours),
        "building_count": len(buildings),
        "building_warning": building_warning,
        "files": {},
    }

    if "obj" in req.formats:
        obj_path = os.path.join(job_dir, "model.obj")
        convert_mod.export_obj(terrain_vertices, terrain_faces, buildings, obj_path)
        result["files"]["obj"] = f"/outputs/{job_id}/model.obj"

    if "dxf" in req.formats:
        dxf_path = os.path.join(job_dir, "model.dxf")
        convert_mod.export_dxf(contours, buildings, dxf_path)
        result["files"]["dxf"] = f"/outputs/{job_id}/model.dxf"

    return result
