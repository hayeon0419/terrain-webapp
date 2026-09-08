import math

import requests
import trimesh
from shapely.geometry import Polygon, shape

VWORLD_WFS_URL = "https://api.vworld.kr/req/wfs"
DEFAULT_FLOOR_HEIGHT_M = 3.0
DEFAULT_BUILDING_HEIGHT_M = 9.0


def fetch_buildings_geojson(bbox: dict, api_key: str, domain: str, typename: str) -> dict:
    bbox_param = f"{bbox['south']},{bbox['west']},{bbox['north']},{bbox['east']},EPSG:4326"
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typename": typename,
        "bbox": bbox_param,
        "srsName": "EPSG:4326",
        "output": "application/json",
        "key": api_key,
        "domain": domain,
    }
    res = requests.get(VWORLD_WFS_URL, params=params, timeout=30)
    res.raise_for_status()
    return res.json()


def building_height(properties: dict) -> float:
    floors = properties.get("gro_flo_co")
    try:
        floors = int(floors)
    except (TypeError, ValueError):
        floors = 0
    if floors > 0:
        return floors * DEFAULT_FLOOR_HEIGHT_M
    return DEFAULT_BUILDING_HEIGHT_M


def local_projector(lon0: float, lat0: float):
    m_per_deg_lat = 111320.0
    m_per_deg_lon = 111320.0 * math.cos(math.radians(lat0))

    def project(lon, lat):
        return (lon - lon0) * m_per_deg_lon, (lat - lat0) * m_per_deg_lat

    return project


def buildings_to_meshes(geojson: dict, lon0: float, lat0: float):
    """Returns a list of {"mesh": trimesh.Trimesh, "footprint": [(x, y), ...]}."""
    project = local_projector(lon0, lat0)
    results = []
    for feature in geojson.get("features", []):
        geom = shape(feature["geometry"])
        height = building_height(feature.get("properties", {}))
        polygons = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]
        for poly in polygons:
            if poly.is_empty or len(poly.exterior.coords) < 4:
                continue
            local_coords = [project(lon, lat) for lon, lat in poly.exterior.coords]
            try:
                mesh = trimesh.creation.extrude_polygon(Polygon(local_coords), height=height)
            except Exception:
                continue
            results.append({"mesh": mesh, "footprint": local_coords})
    return results
