// GPS tracking (spec §7.1). Foreground watch at 1–3 s sampling; on a custom
// dev client / EAS build, expo-location runs this through an Android
// foreground service (config in app.json). Expo Go = foreground only, which
// is sufficient for Phase-0 engine validation.

import * as Location from "expo-location";

export interface Fix {
  lat: number;
  lon: number;
  speed: number | null; // m/s
  accuracy: number | null;
  t: number;
}

export async function requestPermissions(): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync();
  return fg.status === "granted";
}

export async function startTracking(onFix: (fix: Fix) => void): Promise<() => void> {
  const sub = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 2000,
      distanceInterval: 3,
    },
    (loc) => {
      onFix({
        lat: loc.coords.latitude,
        lon: loc.coords.longitude,
        speed: loc.coords.speed,
        accuracy: loc.coords.accuracy,
        t: loc.timestamp,
      });
    }
  );
  return () => sub.remove();
}

/** Haversine distance in metres between two fixes. */
export function haversineM(a: Fix, b: Fix): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la = (a.lat * Math.PI) / 180;
  const lb = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
