import * as maplibregl from "maplibre-gl";
import type { Map as MlMap } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useEffect, useRef } from "react";

// MapLibre 6 ships its worker as a separate module; let Vite emit it and point MapLibre at it.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

// OpenFreeMap: free vector tiles, no API key, no usage fees.
const STYLES = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

const SAO_PAULO_VIEW = { center: [-46.6, -23.62] as [number, number], zoom: 9.6 };

interface Props {
  dark: boolean;
  /** Called with the map once its style has loaded, and with null when it is torn down (theme switch). */
  onReady: (map: MlMap | null) => void;
}

/** A MapLibre map that is rebuilt (keeping the camera) when the theme changes. */
export function MapView({ dark, onReady }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const camera = useRef<{ center: [number, number]; zoom: number }>(SAO_PAULO_VIEW);
  const ready = useRef(onReady);
  ready.current = onReady;

  useEffect(() => {
    const map = new maplibregl.Map({
      container: container.current!,
      style: dark ? STYLES.dark : STYLES.light,
      center: camera.current.center,
      zoom: camera.current.zoom,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("moveend", () => {
      const c = map.getCenter();
      camera.current = { center: [c.lng, c.lat], zoom: map.getZoom() };
    });
    map.on("load", () => ready.current(map));
    return () => {
      ready.current(null);
      map.remove();
    };
  }, [dark]);

  return <div ref={container} />;
}

/** Adds or replaces a GeoJSON source's data. */
export function setGeoJson(map: MlMap, id: string, data: GeoJSON.FeatureCollection) {
  const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData(data);
  else map.addSource(id, { type: "geojson", data });
}
