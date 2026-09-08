import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MplPolygon

# macOS ships AppleGothic, which covers Hangul glyphs that DejaVu Sans lacks.
matplotlib.rcParams["font.family"] = ["AppleGothic", "DejaVu Sans"]
matplotlib.rcParams["axes.unicode_minus"] = False


def generate_preview(contours, buildings, path, radius_hint_m=None):
    fig, ax = plt.subplots(figsize=(6, 6), dpi=150)

    for line in contours:
        xs = [p[0] for p in line["points"]]
        ys = [p[1] for p in line["points"]]
        ax.plot(xs, ys, color="#888888", linewidth=0.6)

    for b in buildings:
        footprint = b["footprint"]
        patch = MplPolygon(footprint, closed=True, facecolor="#f2994a", edgecolor="#8a4d1f", linewidth=0.5, alpha=0.85)
        ax.add_patch(patch)

    ax.set_aspect("equal")
    ax.set_xlabel("동서 방향 (m)")
    ax.set_ylabel("남북 방향 (m)")
    ax.set_title("지형/건물 미리보기 (상단뷰)")
    if radius_hint_m:
        ax.set_xlim(-radius_hint_m * 1.1, radius_hint_m * 1.1)
        ax.set_ylim(-radius_hint_m * 1.1, radius_hint_m * 1.1)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)
