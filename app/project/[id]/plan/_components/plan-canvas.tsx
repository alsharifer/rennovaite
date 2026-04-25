type RoomInput = {
  id: string;
  name_en: string | null;
  area_m2: number | null;
  polygon: unknown;
};

const VIEW_W = 1000;
const VIEW_H = 600;
const PADDING = 24;

const SAND_FILL = "#F5EFE6";
const TERRACOTTA = "#B85042";

function isPointArray(value: unknown): value is number[][] {
  if (!Array.isArray(value)) return false;
  for (const point of value) {
    if (
      !Array.isArray(point) ||
      point.length < 2 ||
      typeof point[0] !== "number" ||
      typeof point[1] !== "number"
    ) {
      return false;
    }
  }
  return value.length >= 3;
}

type ScaledRoom = {
  id: string;
  name: string;
  areaLabel: string | null;
  points: [number, number][];
  cx: number;
  cy: number;
};

function fitRooms(rooms: RoomInput[]): ScaledRoom[] {
  const valid = rooms
    .map((r) => ({ ...r, polygon: r.polygon }))
    .filter((r) => isPointArray(r.polygon));

  if (valid.length === 0) return [];

  // Global bbox across all polygons. Works whether Claude returned [0,1]
  // normalized coords (the spec) or raw image-space pixels (a fallback).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const room of valid) {
    for (const [x, y] of room.polygon as number[][]) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);

  const availW = VIEW_W - 2 * PADDING;
  const availH = VIEW_H - 2 * PADDING;
  const scale = Math.min(availW / spanX, availH / spanY);
  const offsetX = (VIEW_W - spanX * scale) / 2;
  const offsetY = (VIEW_H - spanY * scale) / 2;

  return valid.map((room) => {
    const points = (room.polygon as number[][]).map(
      ([x, y]) =>
        [(x - minX) * scale + offsetX, (y - minY) * scale + offsetY] as [
          number,
          number,
        ],
    );
    const cx = points.reduce((s, [x]) => s + x, 0) / points.length;
    const cy = points.reduce((s, [, y]) => s + y, 0) / points.length;
    return {
      id: room.id,
      name: room.name_en ?? "Room",
      areaLabel:
        typeof room.area_m2 === "number"
          ? `${Math.round(room.area_m2 * 10) / 10} m²`
          : null,
      points,
      cx,
      cy,
    };
  });
}

function pointsAttr(points: [number, number][]): string {
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

function chipWidth(label: string): number {
  // Rough estimate: 6.5 px per char + 16 px padding, clamped.
  return Math.min(140, Math.max(48, label.length * 6.5 + 16));
}

export function PlanCanvas({ rooms }: { rooms: RoomInput[] }) {
  const scaled = fitRooms(rooms);

  return (
    <div className="overflow-hidden rounded-xl border border-bg-border bg-bg-elevated/60 backdrop-blur-sm">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="block h-auto w-full"
        role="img"
        aria-label="Floorplan"
      >
        {scaled.length === 0 ? (
          <text
            x={VIEW_W / 2}
            y={VIEW_H / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="var(--color-text-tertiary)"
            fontSize="16"
          >
            No room polygons available.
          </text>
        ) : (
          scaled.map((room) => {
            const chipW = room.areaLabel ? chipWidth(room.areaLabel) : 0;
            return (
              <g key={room.id}>
                <polygon
                  points={pointsAttr(room.points)}
                  fill={SAND_FILL}
                  fillOpacity={0.88}
                  stroke={TERRACOTTA}
                  strokeOpacity={0.7}
                  strokeWidth={1.5}
                />
                <text
                  x={room.cx}
                  y={room.cy - 4}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="14"
                  fontWeight={500}
                  fill="#1F1830"
                >
                  {room.name}
                </text>
                {room.areaLabel && (
                  <g>
                    <rect
                      x={room.cx - chipW / 2}
                      y={room.cy + 8}
                      width={chipW}
                      height={20}
                      rx={10}
                      ry={10}
                      fill={TERRACOTTA}
                      fillOpacity={0.12}
                      stroke={TERRACOTTA}
                      strokeOpacity={0.45}
                      strokeWidth={1}
                    />
                    <text
                      x={room.cx}
                      y={room.cy + 18}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize="11"
                      fontWeight={500}
                      fill={TERRACOTTA}
                    >
                      {room.areaLabel}
                    </text>
                  </g>
                )}
              </g>
            );
          })
        )}
      </svg>
    </div>
  );
}
