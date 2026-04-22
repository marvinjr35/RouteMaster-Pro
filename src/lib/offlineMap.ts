import L from 'leaflet';
import localforage from 'localforage';

// Configure localforage
const tileCache = localforage.createInstance({
  name: 'tile-cache',
  storeName: 'tiles'
});

const areaMetadata = localforage.createInstance({
  name: 'offline-areas',
  storeName: 'metadata'
});

export interface OfflineArea {
  id: string;
  name: string;
  bounds: L.LatLngBoundsLiteral;
  zoomRange: [number, number];
  tileCount: number;
  sizeMB: number;
  date: string;
  geojson?: any;
}

/**
 * Utility to calculate tile coordinates from lat/lng and zoom
 */
export const getTileCoords = (lat: number, lng: number, zoom: number) => {
  const x = Math.floor((lng + 180) / 360 * Math.pow(2, zoom));
  const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
  return { x, y, z: zoom };
};

/**
 * Utility to check if a tile is in cache
 */
export const isTileCached = async (url: string) => {
  const cached = await tileCache.getItem(url);
  return !!cached;
};

/**
 * Save tile to cache
 */
export const saveTile = async (url: string, blob: Blob) => {
  await tileCache.setItem(url, blob);
};

/**
 * Get tile from cache
 */
export const getTile = async (url: string) => {
  return await tileCache.getItem(url) as Blob | null;
};

/**
 * Fetch and cache tile
 */
export const downloadTile = async (url: string) => {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const blob = await response.blob();
    await saveTile(url, blob);
    return true;
  } catch (error) {
    console.error('Download tile failed:', error);
    return false;
  }
};

/**
 * Custom TileLayer for Offline Support
 */
export const createOfflineTileLayer = (urlTemplate: string, options: any) => {
  return L.TileLayer.extend({
    createTile: function (coords: L.Coords, done: L.DoneCallback) {
      const tile = document.createElement('img');
      const url = this.getTileUrl(coords);
      
      getTile(url).then(cachedBlob => {
        if (cachedBlob) {
          const objectUrl = URL.createObjectURL(cachedBlob);
          tile.src = objectUrl;
          tile.onload = () => {
            URL.revokeObjectURL(objectUrl);
            done(null, tile);
          };
          tile.onerror = () => {
             // Fallback if blob is corrupt
             tile.src = url;
             done(null, tile);
          }
        } else {
          // If not cached, attempt to load normally and cache it if internet is available
          tile.src = url;
          // We don't automatically cache everything here to avoid bloat, 
          // usually offline apps only cache specifically selected areas.
          tile.onload = () => done(null, tile);
          tile.onerror = () => done(new Error('Tile not found'), tile);
        }
      });

      return tile;
    }
  });
};

/**
 * Logic to calculate all tiles in a bounds
 */
export const getTilesInBounds = (bounds: L.LatLngBounds, minZoom: number, maxZoom: number) => {
  const tiles: { x: number; y: number; z: number }[] = [];
  const northWest = bounds.getNorthWest();
  const southEast = bounds.getSouthEast();

  for (let z = minZoom; z <= maxZoom; z++) {
    const nwTile = getTileCoords(northWest.lat, northWest.lng, z);
    const seTile = getTileCoords(southEast.lat, southEast.lng, z);

    for (let x = nwTile.x; x <= seTile.x; x++) {
      for (let y = nwTile.y; y <= seTile.y; y++) {
        tiles.push({ x, y, z });
      }
    }
  }
  return tiles;
};

export const saveAreaMetadata = async (area: OfflineArea) => {
  await areaMetadata.setItem(area.id, area);
};

export const getAllAreas = async (): Promise<OfflineArea[]> => {
  const keys = await areaMetadata.keys();
  const areas = await Promise.all(keys.map(k => areaMetadata.getItem(k) as Promise<OfflineArea>));
  return areas.filter(Boolean);
};

export const deleteArea = async (id: string, urlTemplate: string) => {
  const area = await areaMetadata.getItem(id) as OfflineArea;
  if (!area) return;

  // Ideally we would delete tiles here, but tiles could be shared between areas.
  // A simple cleanup would be complex. For now just delete metadata.
  await areaMetadata.removeItem(id);
};
