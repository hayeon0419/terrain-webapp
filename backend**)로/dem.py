import io
import math

import numpy as np
import requests
from rasterio.io import MemoryFile
from skimage import measure

OPENTOPO_URL = "https://portal.opentopography.org/API/globaldem"


def fetch_dem_bytes(bbox: dict, demtype: str, api_key: str) -> bytes:
    params = {
        "demtype": demtype,
        "south": bbox["south"],
        "north": bbox["north"],
        "west": bbox["west"],
        "east": bbox["east"],
        "outputFormat": "GTiff",
        "API_Key": api_key,
    }
    res = requests.get(OPENTOPO_URL, params=params, timeout=60)
    res.raise_for_status()
    return res.content


def load_dem(tif_bytes: bytes):
    with MemoryFile(tif_bytes) as memfile:
        with memfile.open() as dataset:
            elevation = dataset.read(1).astype(np.float64)
            transform = dataset.transform
            nodata = dataset.nodata
    if nodata is not None:
        elevation = np.where(elevation == nodata, np.nan, elevation)
    return elevation, transform


def pixel_to_lonlat(transform, row, col):
    lon, lat = transform * (col + 0.5, row + 0.5)
    return lon, lat


def local_projector(lon0: float, lat0: float):
    m_per_deg_lat = 111320.0
    m_per_deg_lon = 111320.0 * math.cos(math.radians(lat0))

    def project(lon, lat, elev):
        x = (lon - lon0) * m_per_deg_lon
        y = (lat - lat0) * m_per_deg_lat
        return x, y, elev

    return project


def extract_contours(elevation: np.ndarray, transform, interval: float, lon0: float, lat0: float):
    project = local_projector(lon0, lat0)
    valid = elevation[~np.isnan(elevation)]
    if valid.size == 0:
        return []
    lo = math.floor(valid.min() / interval) * interval
    hi = math.ceil(valid.max() / interval) * interval
    levels = np.arange(lo, hi + interval, interval)

    filled = np.nan_to_num(elevation, nan=valid.min())
    lines = []
    for level in levels:
        for contour in measure.find_contours(filled, level=level):
            pts = []
            for row, col in contour:
                lon, lat = pixel_to_lonlat(transform, row, col)
                pts.append(project(lon, lat, float(level)))
            if len(pts) >= 2:
                lines.append({"elevation": float(level), "points": pts})
    return lines


def build_terrain_mesh(elevation: np.ndarray, transform, lon0: float, lat0: float):
    rows, cols = elevation.shape
    fill_value = float(np.nanmin(elevation)) if np.any(~np.isnan(elevation)) else 0.0
    filled = np.nan_to_num(elevation, nan=fill_value)

    col_idx, row_idx = np.meshgrid(np.arange(cols) + 0.5, np.arange(rows) + 0.5)
    lon, lat = transform * (col_idx, row_idx)
    m_per_deg_lat = 111320.0
    m_per_deg_lon = 111320.0 * math.cos(math.radians(lat0))
    xs = (lon - lon0) * m_per_deg_lon
    ys = (lat - lat0) * m_per_deg_lat
    vertices = np.stack([xs.ravel(), ys.ravel(), filled.ravel()], axis=1)

    faces = []
    for r in range(rows - 1):
        for c in range(cols - 1):
            i0 = r * cols + c
            i1 = i0 + 1
            i2 = i0 + cols
            i3 = i2 + 1
            faces.append((i0, i2, i1))
            faces.append((i1, i2, i3))

    return vertices, np.array(faces, dtype=np.int64)
