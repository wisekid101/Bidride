import { useCallback, useRef, useState } from 'react';
import type MapView from 'react-native-maps';

// Follow-camera behavior shared by the active-trip maps. It keeps the moving
// vehicle centered without remounting the map, ignores GPS jitter, throttles
// camera animations, and pauses when the user pans so the map does not fight
// the gesture. Nothing here touches location streaming, proximity, trip state,
// or the backend — it only drives the on-screen camera.

export interface LatLng {
  lat: number;
  lng: number;
}

export interface FollowOptions {
  minMoveMeters: number;
  minIntervalMs: number;
}

export const DEFAULT_FOLLOW_OPTIONS: FollowOptions = {
  minMoveMeters: 12, // ignore sub-12m jitter
  minIntervalMs: 900, // at most ~1 camera animation per second
};

const FOLLOW_ZOOM = 15;
const ANIM_MS = 500;

export function metersBetween(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Pure decision: should the camera animate to `next`? Extracted so the
 * jitter/throttle rules are unit-testable without a native map.
 */
export function shouldAnimateCamera(
  last: LatLng | null,
  next: LatLng | null,
  lastTs: number,
  now: number,
  opts: FollowOptions = DEFAULT_FOLLOW_OPTIONS,
): boolean {
  if (!next) return false; // no valid fix — never move (no reset on GPS loss)
  if (!last) return true; // first fix — center immediately
  if (now - lastTs < opts.minIntervalMs) return false; // throttle
  if (metersBetween(last, next) < opts.minMoveMeters) return false; // jitter
  return true;
}

export function useFollowCamera(
  mapRef: React.RefObject<MapView | null>,
  opts: FollowOptions = DEFAULT_FOLLOW_OPTIONS,
) {
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);
  const lastCenter = useRef<LatLng | null>(null);
  const lastTs = useRef(0);
  const lastCoord = useRef<(LatLng & { heading?: number }) | null>(null);

  const setFollow = useCallback((v: boolean) => {
    followingRef.current = v;
    setFollowing(v);
  }, []);

  const animate = useCallback(
    (coord: LatLng, heading?: number) => {
      const camera: {
        center: { latitude: number; longitude: number };
        zoom: number;
        pitch: number;
        heading?: number;
      } = {
        center: { latitude: coord.lat, longitude: coord.lng },
        zoom: FOLLOW_ZOOM,
        pitch: 0,
      };
      // Missing/invalid heading → leave rotation unchanged instead of snapping north.
      if (typeof heading === 'number' && heading >= 0) camera.heading = heading;
      mapRef.current?.animateCamera?.(camera, { duration: ANIM_MS });
    },
    [mapRef],
  );

  /** Feed the newest valid driver coordinate; animates only when appropriate. */
  const follow = useCallback(
    (coord: LatLng | null | undefined, heading?: number) => {
      if (!coord) return;
      lastCoord.current = { ...coord, heading };
      if (!followingRef.current) return; // paused by a user gesture
      const now = Date.now();
      if (!shouldAnimateCamera(lastCenter.current, coord, lastTs.current, now, opts)) return;
      lastTs.current = now;
      lastCenter.current = coord;
      animate(coord, heading);
    },
    [animate, opts],
  );

  /** Call from MapView.onPanDrag — a clear user gesture pauses following. */
  const onUserGesture = useCallback(() => {
    if (followingRef.current) setFollow(false);
  }, [setFollow]);

  /** Recenter control: resume following and jump to the latest known coordinate. */
  const recenter = useCallback(() => {
    setFollow(true);
    const c = lastCoord.current;
    if (c) {
      lastCenter.current = { lat: c.lat, lng: c.lng };
      lastTs.current = Date.now();
      animate({ lat: c.lat, lng: c.lng }, c.heading);
    }
  }, [animate, setFollow]);

  return { following, follow, onUserGesture, recenter };
}
