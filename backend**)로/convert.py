import ezdxf
import numpy as np
import trimesh


def export_obj(terrain_vertices, terrain_faces, buildings, path):
    meshes = []
    if terrain_vertices is not None and len(terrain_faces) > 0:
        meshes.append(trimesh.Trimesh(vertices=terrain_vertices, faces=terrain_faces, process=False))
    meshes.extend(b["mesh"] for b in buildings)

    if not meshes:
        raise ValueError("내보낼 메쉬가 없습니다 (지형/건물 데이터 없음)")

    combined = trimesh.util.concatenate(meshes) if len(meshes) > 1 else meshes[0]
    combined.export(path, file_type="obj")


def export_dxf(contours, buildings, path):
    doc = ezdxf.new()
    msp = doc.modelspace()
    doc.layers.add(name="CONTOUR", color=8)
    doc.layers.add(name="BUILDING", color=1)

    for line in contours:
        points = [(x, y, z) for x, y, z in line["points"]]
        if len(points) >= 2:
            msp.add_polyline3d(points, dxfattribs={"layer": "CONTOUR"})

    for b in buildings:
        verts = np.asarray(b["mesh"].vertices)
        faces = np.asarray(b["mesh"].faces)
        polyface = msp.add_polyface(dxfattribs={"layer": "BUILDING"})
        polyface.append_faces(
            [[tuple(verts[idx]) for idx in face] for face in faces],
        )

    doc.saveas(path)
