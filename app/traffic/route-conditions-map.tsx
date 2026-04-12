"use client";

import L from "leaflet";
import { useEffect } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";

export type MapFarm = { id: string; name: string; lat: number; lng: number };
export type MapMarket = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  location: string;
};

function FitBounds({
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
    map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 9 });
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

export default function RouteConditionsMap({
  farms,
  markets,
}: {
  farms: MapFarm[];
  markets: MapMarket[];
}) {
  const points: [number, number][] = [
    ...farms.map((f) => [f.lat, f.lng] as [number, number]),
    ...markets.map((m) => [m.lat, m.lng] as [number, number]),
  ];
  const center: [number, number] =
    points.length > 0 ? points[0]! : [18.5, 74.2];

  return (
    <div className="relative z-0 w-full overflow-hidden rounded-2xl border border-zinc-200/80 shadow-inner">
      <div className="h-[clamp(18rem,45vh,32rem)] w-full sm:h-[clamp(22rem,50vh,36rem)]">
        <MapContainer
          center={center}
          zoom={7}
          className="z-0 h-full w-full"
          scrollWheelZoom={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <SyncMapSize />
          {points.length > 0 ? <FitBounds points={points} /> : null}
          {farms.map((f) => (
            <CircleMarker
              key={`f-${f.id}`}
              center={[f.lat, f.lng]}
              radius={9}
              pathOptions={{
                color: "#14532d",
                fillColor: "#22c55e",
                fillOpacity: 0.9,
                weight: 2,
              }}
            >
              <Tooltip
                direction="top"
                offset={[0, -10]}
                opacity={0.95}
                permanent
              >
                Farm: {f.name}
              </Tooltip>
              <Popup>
                <span className="font-semibold text-emerald-900">Farm</span>
                <br />
                {f.name}
              </Popup>
            </CircleMarker>
          ))}
          {markets.map((m) => (
            <CircleMarker
              key={`m-${m.id}`}
              center={[m.lat, m.lng]}
              radius={8}
              pathOptions={{
                color: "#1e3a8a",
                fillColor: "#3b82f6",
                fillOpacity: 0.88,
                weight: 2,
              }}
            >
              <Tooltip
                direction="top"
                offset={[0, -10]}
                opacity={0.95}
                permanent
              >
                Market: {m.name}
              </Tooltip>
              <Popup>
                <span className="font-semibold text-blue-900">Market</span>
                <br />
                {m.name}
                {m.location ? (
                  <>
                    <br />
                    <span className="text-zinc-600">{m.location}</span>
                  </>
                ) : null}
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
