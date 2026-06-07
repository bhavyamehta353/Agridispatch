"use client";

import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";

type RoutePoint = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

type RoutingState = {
  path: [number, number][];
  source: "road" | "direct";
};

const truckIcon = L.divIcon({
  className: "",
  html: `
    <div style="
      display:flex;
      align-items:center;
      justify-content:center;
      width:28px;
      height:28px;
      border-radius:9999px;
      background:#047857;
      color:white;
      border:2px solid #d1fae5;
      box-shadow:0 4px 12px rgba(0,0,0,0.18);
      font-size:15px;
      line-height:1;
    ">🚚</div>
  `,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

function FitRoute({
  points,
}: {
  points: [number, number][];
}) {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0]!, 9);
      return;
    }

    map.fitBounds(L.latLngBounds(points), {
      padding: [40, 40],
      maxZoom: 9,
    });
  }, [map, points]);

  return null;
}

function SyncMapSize() {
  const map = useMap();

  useEffect(() => {
    const resize = () => {
      map.invalidateSize();
    };

    resize();

    const container = map.getContainer();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => resize())
        : null;

    observer?.observe(container);
    window.addEventListener("resize", resize);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [map]);

  return null;
}

export default function RecommendedRouteMap({
  farm,
  market,
}: {
  farm: RoutePoint;
  market: RoutePoint;
}) {
  const fallbackPath = useMemo<[number, number][]>(
    () => [
      [farm.lat, farm.lng],
      [market.lat, market.lng],
    ],
    [farm.lat, farm.lng, market.lat, market.lng]
  );
  const [routing, setRouting] = useState<RoutingState>({
    path: fallbackPath,
    source: "direct",
  });
  const truckPoint =
    routing.path[Math.max(0, Math.floor((routing.path.length - 1) / 2))] ??
    fallbackPath[0];

  useEffect(() => {
    let cancelled = false;

    const loadRoadRoute = async () => {
      try {
        const url = new URL(
          `https://router.project-osrm.org/route/v1/driving/${farm.lng},${farm.lat};${market.lng},${market.lat}`
        );
        url.searchParams.set("overview", "full");
        url.searchParams.set("geometries", "geojson");

        const res = await fetch(url.toString());
        const json = (await res.json()) as {
          routes?: { geometry?: { coordinates?: [number, number][] } }[];
        };

        const coords = json.routes?.[0]?.geometry?.coordinates ?? [];
        if (!cancelled && coords.length >= 2) {
          setRouting({
            path: coords.map(([lng, lat]) => [lat, lng]),
            source: "road",
          });
          return;
        }
      } catch {
        // Fall back to a direct line when route geometry is unavailable.
      }

      if (!cancelled) {
        setRouting({
          path: fallbackPath,
          source: "direct",
        });
      }
    };

    void loadRoadRoute();

    return () => {
      cancelled = true;
    };
  }, [fallbackPath, farm.lat, farm.lng, market.lat, market.lng]);

  return (
    <div className="relative z-0 w-full overflow-hidden rounded-2xl border border-zinc-200/80 shadow-inner">
      <div className="h-[clamp(16rem,38vh,24rem)] w-full sm:h-[clamp(18rem,42vh,28rem)]">
        <MapContainer
          key={`${farm.id}-${market.id}`}
          center={routing.path[0] ?? fallbackPath[0]}
          zoom={8}
          className="h-full w-full"
          scrollWheelZoom={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <SyncMapSize />
          <FitRoute points={routing.path} />
          <Polyline
            positions={routing.path}
            pathOptions={{
              color: "#059669",
              weight: 5,
              opacity: 0.9,
            }}
          />
          <CircleMarker
            center={[farm.lat, farm.lng]}
            radius={9}
            pathOptions={{
              color: "#14532d",
              fillColor: "#22c55e",
              fillOpacity: 0.95,
              weight: 2,
            }}
          >
            <Tooltip
              direction="top"
              offset={[0, -10]}
              opacity={0.95}
              permanent
            >
              Farm: {farm.name}
            </Tooltip>
            <Popup>
              <span className="font-semibold text-emerald-900">Farm</span>
              <br />
              {farm.name}
            </Popup>
          </CircleMarker>
          <CircleMarker
            center={[market.lat, market.lng]}
            radius={9}
            pathOptions={{
              color: "#1d4ed8",
              fillColor: "#60a5fa",
              fillOpacity: 0.95,
              weight: 2,
            }}
          >
            <Tooltip
              direction="top"
              offset={[0, -10]}
              opacity={0.95}
              permanent
            >
              Market: {market.name}
            </Tooltip>
            <Popup>
              <span className="font-semibold text-blue-900">Chosen market</span>
              <br />
              {market.name}
            </Popup>
          </CircleMarker>
          <Marker position={truckPoint} icon={truckIcon}>
            
            <Popup>
              <span className="font-semibold text-emerald-900">
                Dispatch route
              </span>
              <br />
              Truck marker on the selected farm-to-market path
            </Popup>
          </Marker>
        </MapContainer>
      </div>
      <div className="border-t border-zinc-200/80 bg-white/90 px-3 py-2 text-xs text-zinc-500">
        {routing.source === "road"
          ? "Road route shown from routing data."
          : "Straight-line fallback shown because road routing is unavailable."}
      </div>
    </div>
  );
}
