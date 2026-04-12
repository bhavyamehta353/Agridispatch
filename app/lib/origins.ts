/** Farm origins aligned with Airtable; used by farmer intake and batch overview. */
export const ORIGINS = [
  {
    farm_origin_id: "FARM001",
    origin_id: "FARM001",
    origin_name: "Farm A (Baramati)",
    origin_lat: 18.151,
    origin_lng: 74.5777,
  },
  {
    farm_origin_id: "FARM002",
    origin_id: "FARM002",
    origin_name: "Farm B (Sangamner)",
    origin_lat: 19.571,
    origin_lng: 74.212,
  },
  {
    farm_origin_id: "FARM003",
    origin_id: "FARM003",
    origin_name: "Farm C (Satara)",
    origin_lat: 17.6859,
    origin_lng: 73.9993,
  },
  {
    farm_origin_id: "FARM004",
    origin_id: "FARM004",
    origin_name: "Farm D (Dindori)",
    origin_lat: 19.975,
    origin_lng: 73.748,
  },
] as const;

export type OriginRow = (typeof ORIGINS)[number];

export function originByName(name: string): OriginRow | undefined {
  return ORIGINS.find((o) => o.origin_name === name);
}

export function originByFarmOriginId(id: string): OriginRow | undefined {
  const t = id.trim();
  return ORIGINS.find(
    (o) => o.farm_origin_id === t || o.origin_id === t
  );
}
