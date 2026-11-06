import * as maplibregl from "maplibre-gl";
import type { Map as MlMap } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useEffect, useRef, useState } from "react";

// MapLibre 6 ships its worker as a separate module; let Vite emit it and point MapLibre at it.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

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
  const [basemapUnavailable, setBasemapUnavailable] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const camera = useRef<{ center: [number, number]; zoom: number }>(SAO_PAULO_VIEW);
  const ready = useRef(onReady);
  ready.current = onReady;

  useEffect(() => {
    setBasemapUnavailable(false);
    const map = new maplibregl.Map({
      container: container.current!,
      style: dark ? STYLES.dark : STYLES.light,
      center: camera.current.center,
      zoom: camera.current.zoom,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("error", () => {
      setBasemapUnavailable(true);
      if (!map.getStyle()) {
        map.setStyle({ version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": dark ? "#242422" : "#eae7de" } }] });
      }
    });
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container.current!);
    map.on("moveend", () => {
      const c = map.getCenter();
      camera.current = { center: [c.lng, c.lat], zoom: map.getZoom() };
    });
    map.on("load", () => ready.current(map));
    return () => {
      ready.current(null);
      resize.disconnect();
      map.remove();
    };
  }, [dark]);

  return <>
    <div className="map-canvas" ref={container} />
    {basemapUnavailable && <p className="map-notice" role="status">Some background map details couldn’t be loaded. Project overlays can still be explored.</p>}
  </>;
}

/** Adds or replaces a GeoJSON source's data. */
export function setGeoJson(map: MlMap, id: string, data: GeoJSON.FeatureCollection) {
  const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData(data);
  else map.addSource(id, { type: "geojson", data });
}
