import React, { useState, useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents, Polygon, Circle, Tooltip as LeafletTooltip } from 'react-leaflet';
import L from 'leaflet';
import inside from 'point-in-polygon';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';
import { 
  Calendar, 
  Map as MapIcon, 
  CheckCircle2, 
  Navigation, 
  Plus, 
  Trash2, 
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Search,
  Filter,
  Clock,
  MapPin,
  Fuel,
  ArrowRightLeft,
  Layers,
  MousePointer2,
  Square as SquareIcon,
  Circle as CircleIcon,
  Check,
  GripVertical,
  AlertCircle,
  Download,
  WifiOff,
  Database,
  Trash
} from 'lucide-react';
import { locations, Location } from './data';
import { cn } from './lib/utils';
import { auth, signInWithGoogle, logout, db, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, setDoc, getDoc, onSnapshot, query, where, serverTimestamp, addDoc, deleteDoc, getDocs } from 'firebase/firestore';
import { geminiFlash, geminiProThinking } from './gemini';
import { LogOut, LogIn, MessageSquare, Send, Sparkles, X, CloudDownload, Info } from 'lucide-react';
import { getAllAreas, saveAreaMetadata, getTilesInBounds, downloadTile, OfflineArea, deleteArea, getTile } from './lib/offlineMap';

// Fix Leaflet marker icons
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom Offline TileLayer
const OfflineTileLayer = ({ url, attribution, activeLayer }: { url: string; attribution: string; activeLayer: string }) => {
  const map = useMap();
  
  useEffect(() => {
    // @ts-ignore
    const OfflineLayer = L.TileLayer.extend({
      createTile: function (coords: L.Coords, done: L.DoneCallback) {
        const tile = document.createElement('img');
        const tileUrl = this.getTileUrl(coords);
        
        getTile(tileUrl).then(blob => {
          if (blob) {
            const objUrl = URL.createObjectURL(blob);
            tile.src = objUrl;
            tile.onload = () => {
              URL.revokeObjectURL(objUrl);
              done(null, tile);
            };
          } else {
            tile.src = tileUrl;
            tile.onload = () => done(null, tile);
            tile.onerror = () => done(new Error('Offline tile missing'), tile);
          }
        });
        return tile;
      }
    });

    // @ts-ignore
    const layer = new OfflineLayer(url, { attribution });
    layer.addTo(map);

    return () => {
      map.removeLayer(layer);
    };
  }, [map, url, attribution, activeLayer]);

  return null;
};

// Custom marker icons
const createMarkerIcon = (color: string, isPlanned: boolean, number?: number, isSelected?: boolean) => {
  const size = isSelected ? 40 : 30;
  const innerSize = isSelected ? 14 : 10;
  
  return L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="
      background-color: ${color};
      width: ${size}px;
      height: ${size}px;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      display: flex;
      align-items: center;
      justify-content: center;
      border: ${isSelected ? '3px' : '2px'} solid white;
      box-shadow: 0 4px 8px rgba(0,0,0,0.4);
      opacity: ${isPlanned && !isSelected ? 0.6 : 1};
      transition: all 0.3s ease;
      z-index: ${isSelected ? 1000 : 1};
    ">
      <div style="
        width: ${innerSize}px;
        height: ${innerSize}px;
        background: white;
        border-radius: 50%;
        transform: rotate(45deg);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: ${isSelected ? '10px' : '8px'};
        font-weight: bold;
        color: ${color};
      ">
        ${number !== undefined ? number : ''}
      </div>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
  });
};

function MapUpdater({ center, zoom }: { center: [number, number], zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom || 12, { animate: true });
  }, [center, zoom, map]);
  return null;
}

function DrawingLayer({ 
  mode, 
  points, 
  setPoints, 
  circle, 
  setCircle 
}: { 
  mode: 'polygon' | 'circle' | null, 
  points: [number, number][], 
  setPoints: (p: [number, number][]) => void,
  circle: { center: [number, number], radius: number } | null,
  setCircle: (c: { center: [number, number], radius: number } | null) => void
}) {
  useMapEvents({
    click(e) {
      if (mode === 'polygon') {
        setPoints([...points, [e.latlng.lat, e.latlng.lng]]);
      } else if (mode === 'circle') {
        if (!circle || circle.radius > 0) {
          setCircle({ center: [e.latlng.lat, e.latlng.lng], radius: 0 });
        } else {
          // Second click sets radius
          const dist = L.latLng(circle.center).distanceTo(e.latlng);
          setCircle({ ...circle, radius: dist });
        }
      }
    }
  });

  return (
    <>
      {mode === 'polygon' && points.length > 0 && (
        <>
          <Polygon positions={points} pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.2, weight: 2 }} />
          {points.map((p, i) => (
            <Circle key={i} center={p} radius={5} pathOptions={{ color: '#3b82f6', fillColor: '#fff', fillOpacity: 1, weight: 2 }} />
          ))}
        </>
      )}
      {mode === 'circle' && circle && (
        <>
          <Circle center={circle.center} radius={circle.radius || 10} pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.2, weight: 2 }} />
          <Circle center={circle.center} radius={5} pathOptions={{ color: '#3b82f6', fillColor: '#fff', fillOpacity: 1, weight: 2 }} />
        </>
      )}
    </>
  );
}

const HOME_LOCATION = {
  id: 'HOME',
  address: '1564 41st St SE',
  city: 'Washington',
  state: 'DC',
  lat: 38.8654,
  lng: -76.9448,
  name: 'Home'
};

const homeIcon = L.divIcon({
  className: 'custom-div-icon',
  html: `<div style="
    background-color: #000;
    width: 34px;
    height: 34px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid white;
    box-shadow: 0 4px 6px rgba(0,0,0,0.3);
  ">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
  </div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'model'; text: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState('2026-04-11');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showTrafficLayer, setShowTrafficLayer] = useState(false);
  const [trafficAlerts, setTrafficAlerts] = useState<string[]>([]);
  const [trafficMultiplier, setTrafficMultiplier] = useState(1.0);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Firestore Sync: Planned Routes
  useEffect(() => {
    if (!user || !isAuthReady) return;

    const q = query(
      collection(db, `users/${user.uid}/plannedRoutes`),
      where('date', '==', selectedDate)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const data = snapshot.docs[0].data();
        const stops = data.stops.map((id: string) => locations.find(l => l.id === id)).filter(Boolean);
        setPlannedRoute(stops);
        setIsRouteConfirmed(data.isConfirmed || false);
        if (data.startPointId) {
          const sp = locations.find(l => l.id === data.startPointId) || HOME_LOCATION;
          setStartPoint(sp as Location);
        }
        if (data.endPointId) {
          const ep = locations.find(l => l.id === data.endPointId) || HOME_LOCATION;
          setEndPoint(ep as Location);
        }
      } else {
        setPlannedRoute([]);
        setIsRouteConfirmed(false);
        setStartPoint(HOME_LOCATION as Location);
        setEndPoint(HOME_LOCATION as Location);
      }
    }, (err) => handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/plannedRoutes`));

    return () => unsubscribe();
  }, [user, isAuthReady, selectedDate]);

  // Firestore Sync: History
  useEffect(() => {
    if (!user || !isAuthReady) return;

    const q = collection(db, `users/${user.uid}/history`);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const history = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRouteHistory(history.sort((a: any, b: any) => b.timestamp?.seconds - a.timestamp?.seconds));
    }, (err) => handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/history`));

    return () => unsubscribe();
  }, [user, isAuthReady]);

  // Firestore Sync: Visited Stores (Checked off)
  useEffect(() => {
    if (!user || !isAuthReady) return;

    const q = query(
      collection(db, `users/${user.uid}/plannedRoutes`),
      where('isConfirmed', '==', true)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ids = new Set<string>();
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.stops) {
          data.stops.forEach((id: string) => ids.add(id));
        }
        // Also include start/end points if they are stores
        if (data.startPointId && data.startPointId !== 'HOME') ids.add(data.startPointId);
        if (data.endPointId && data.endPointId !== 'HOME') ids.add(data.endPointId);
      });
      setConfirmedPlannedStoreIds(ids);
    }, (err) => handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/plannedRoutes`));

    return () => unsubscribe();
  }, [user, isAuthReady]);

  const [isRescheduling, setIsRescheduling] = useState<string | null>(null); // sourceDate

  const rescheduleRoute = async (sourceDate: string, targetDate: string) => {
    if (!user || !allPlannedRoutes[sourceDate]) return;
    
    if (allPlannedRoutes[targetDate]) {
      if (!confirm(`A route already exists for ${targetDate}. Overwrite it?`)) return;
    }

    try {
      const sourceRoute = allPlannedRoutes[sourceDate];
      const routeData = {
        uid: user.uid,
        date: targetDate,
        stops: sourceRoute.stops,
        startPointId: sourceRoute.startPointId || 'HOME',
        endPointId: sourceRoute.endPointId || 'HOME',
        isConfirmed: true,
        updatedAt: serverTimestamp()
      };

      // Add/Update target
      const qTarget = query(
        collection(db, `users/${user.uid}/plannedRoutes`),
        where('date', '==', targetDate)
      );
      const snapshotTarget = await getDocs(qTarget);
      if (snapshotTarget.empty) {
        await addDoc(collection(db, `users/${user.uid}/plannedRoutes`), routeData);
      } else {
        await setDoc(doc(db, `users/${user.uid}/plannedRoutes`, snapshotTarget.docs[0].id), routeData, { merge: true });
      }

      // Delete source
      const qSource = query(
        collection(db, `users/${user.uid}/plannedRoutes`),
        where('date', '==', sourceDate)
      );
      const snapshotSource = await getDocs(qSource);
      if (!snapshotSource.empty) {
        await deleteDoc(doc(db, `users/${user.uid}/plannedRoutes`, snapshotSource.docs[0].id));
      }

      setSelectedDate(targetDate);
    } catch (error) {
      console.error('Error rescheduling route:', error);
    }
  };

  const confirmRoute = async () => {
    if (user) {
      try {
        const targetDate = assignDate || selectedDate;
        const routeData = {
          uid: user.uid,
          date: targetDate,
          stops: plannedRoute.map(s => s?.id).filter(Boolean),
          startPointId: startPoint?.id,
          endPointId: endPoint?.id,
          isConfirmed: true,
          updatedAt: serverTimestamp()
        };

        const q = query(
          collection(db, `users/${user.uid}/plannedRoutes`),
          where('date', '==', targetDate)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
          await addDoc(collection(db, `users/${user.uid}/plannedRoutes`), routeData);
        } else {
          await setDoc(doc(db, `users/${user.uid}/plannedRoutes`, snapshot.docs[0].id), routeData, { merge: true });
        }

        if (assignDate !== selectedDate) {
          // Delete from current date if we moved it
          const qOld = query(
            collection(db, `users/${user.uid}/plannedRoutes`),
            where('date', '==', selectedDate)
          );
          const snapshotOld = await getDocs(qOld);
          if (!snapshotOld.empty && snapshotOld.docs[0].id !== snapshot.docs[0]?.id) {
            await deleteDoc(doc(db, `users/${user.uid}/plannedRoutes`, snapshotOld.docs[0].id));
          }
          setSelectedDate(assignDate);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/plannedRoutes`);
      }
    }
    setShowReviewModal(false);
  };

  const savePlannedRoute = async (stops: Location[], sp: Location, ep: Location, dateOverride?: string) => {
    if (!user) return;
    const targetDate = dateOverride || selectedDate;
    try {
      const q = query(
        collection(db, `users/${user.uid}/plannedRoutes`),
        where('date', '==', targetDate)
      );
      const snapshot = await getDocs(q);
      const routeData = {
        uid: user.uid,
        date: targetDate,
        stops: stops.map(s => s?.id).filter(Boolean),
        startPointId: sp?.id,
        endPointId: ep?.id,
        isConfirmed: false,
        updatedAt: serverTimestamp()
      };

      if (snapshot.empty) {
        await addDoc(collection(db, `users/${user.uid}/plannedRoutes`), routeData);
      } else {
        await setDoc(doc(db, `users/${user.uid}/plannedRoutes`, snapshot.docs[0].id), routeData, { merge: true });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/plannedRoutes`);
    }
  };

  const handleChat = async () => {
    if (!chatInput.trim()) return;
    const userMsg = { role: 'user' as const, text: chatInput };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const systemPrompt = `You are the RouteMaster AI Assistant. You help Arquize Bowser plan store visits in the Washington market.
      Current Date: ${selectedDate}
      Planned Stops: ${plannedRoute.length}
      Available Stores: ${locations.length}
      User Home: 1564 41st St SE, Washington, DC
      Working Hours: ${startTime} - ${endTime}
      Traffic Layer Enabled: ${showTrafficLayer}
      
      Provide helpful, concise advice on routing, traffic, and store clusters. Use Google Search and Maps data when needed. If the user asks about traffic, use Google Maps grounding to get real-time data for the DC/Washington area.`;

      const response = await geminiFlash(chatInput, systemPrompt);
      setChatMessages(prev => [...prev, { role: 'model', text: response.text || 'I am sorry, I could not process that.' }]);
    } catch (error) {
      console.error("Chat error:", error);
      setChatMessages(prev => [...prev, { role: 'model', text: 'Error connecting to Gemini. Please try again.' }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const [trafficIncidents, setTrafficIncidents] = useState<{description: string, lat: number, lng: number}[]>([]);
  const fetchTrafficData = async () => {
    try {
      const prompt = `What are the current traffic conditions and any major accidents or delays in the Washington DC area right now? 
      Provide a concise list of major incidents. 
      For each incident, provide a short description and approximate latitude and longitude coordinates within the DC area.
      Also, provide a single number representing the overall traffic delay multiplier (1.0 to 2.0). 
      Format strictly as JSON: 
      {
        "alerts": [{"description": "string", "lat": number, "lng": number}],
        "multiplier": number
      }`;
      
      const response = await geminiFlash(prompt, "You are a traffic data parser. Output ONLY valid JSON.");
      const text = response.text || "{}";
      const cleanedJson = text.replace(/```json|```/g, "").trim();
      const data = JSON.parse(cleanedJson);
      
      if (data.alerts) {
        setTrafficIncidents(data.alerts);
        setTrafficAlerts(data.alerts.map((a: any) => a.description));
      }
      if (data.multiplier) {
        setTrafficMultiplier(Math.max(1, data.multiplier));
      }
    } catch (error) {
      console.error("Traffic fetch error:", error);
    }
  };

  useEffect(() => {
    if (showTrafficLayer) {
      fetchTrafficData();
      const interval = setInterval(fetchTrafficData, 300000); // Every 5 mins
      return () => clearInterval(interval);
    }
  }, [showTrafficLayer]);

  const toggleSelection = (id: string) => {
    const newSelection = new Set(selectedIds);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedIds(newSelection);
  };

  const addSelectedToRoute = async () => {
    const selectedLocs = locations.filter(l => selectedIds.has(l.id) && !plannedRoute.some(p => p?.id === l.id));
    if (selectedLocs.length === 0) return;
    
    const newRoute = [...plannedRoute, ...selectedLocs];
    setPlannedRoute(newRoute);
    setSelectedIds(new Set());
    if (user) await savePlannedRoute(newRoute, startPoint, endPoint);
  };

  const [plannedRoute, setPlannedRoute] = useState<Location[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCarrier, setFilterCarrier] = useState<string | 'ALL'>('ALL');
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [instructions, setInstructions] = useState<any[]>([]);
  const [routeGeometry, setRouteGeometry] = useState<[number, number][]>([]);
  const [routeStats, setRouteStats] = useState<{ distance: number; duration: number }[]>([]);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [showOnlyClosest, setShowOnlyClosest] = useState(true);
  const [activeTab, setActiveTab] = useState<'PLANNER' | 'VISITED' | 'HISTORY' | 'ANALYTICS' | 'CALENDAR' | 'OFFLINE'>('PLANNER');
  const [confirmedPlannedStoreIds, setConfirmedPlannedStoreIds] = useState<Set<string>>(new Set());
  const [routeHistory, setRouteHistory] = useState<any[]>([]);
  const visitedStoreIds = useMemo(() => {
    const ids = new Set<string>(confirmedPlannedStoreIds);
    routeHistory.forEach(entry => {
      if (entry.stopIds) {
        entry.stopIds.forEach((id: string) => ids.add(id));
      }
      if (entry.startPointId && entry.startPointId !== 'HOME') ids.add(entry.startPointId);
      if (entry.endPointId && entry.endPointId !== 'HOME') ids.add(entry.endPointId);
    });
    return ids;
  }, [confirmedPlannedStoreIds, routeHistory]);
  const [isTracking, setIsTracking] = useState(false);
  const [trackingStartTime, setTrackingStartTime] = useState<number | null>(null);
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('18:00');
  const [visitDuration, setVisitDuration] = useState(40);
  const [startPoint, setStartPoint] = useState<Location>(HOME_LOCATION as Location);
  const [endPoint, setEndPoint] = useState<Location>(HOME_LOCATION as Location);
  const [avoidTolls, setAvoidTolls] = useState(false);
  const [avoidTraffic, setAvoidTraffic] = useState(false);
  const [showGasStations, setShowGasStations] = useState(false);
  const [gasStations, setGasStations] = useState<any[]>([]);
  const [isLoadingGas, setIsLoadingGas] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [mapLayer, setMapLayer] = useState<'standard' | 'satellite' | 'terrain'>('standard');
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [drawingMode, setDrawingMode] = useState<'polygon' | 'circle' | null>(null);
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([]);
  const [drawCircle, setDrawCircle] = useState<{ center: [number, number], radius: number } | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [assignDate, setAssignDate] = useState(selectedDate);
  const [isRouteConfirmed, setIsRouteConfirmed] = useState(false);
  const [expandedCluster, setExpandedCluster] = useState<string | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [offlineAreas, setOfflineAreas] = useState<OfflineArea[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [offlineStatus, setOfflineStatus] = useState<'online' | 'offline'>('online');
  const [planningAlert, setPlanningAlert] = useState<string | null>(null);
  const [isRouteSummaryMinimized, setIsRouteSummaryMinimized] = useState(false);

  useEffect(() => {
    const loadAreas = async () => {
      const areas = await getAllAreas();
      setOfflineAreas(areas);
    };
    loadAreas();
    
    // Simple online/offline detection
    const handleOnline = () => setOfflineStatus('online');
    const handleOffline = () => setOfflineStatus('offline');
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (plannedRoute.length > 0) {
      checkOfflineValidity([
        { lat: startPoint.lat, lng: startPoint.lng },
        ...plannedRoute.map(p => ({ lat: p.lat, lng: p.lng })),
        { lat: endPoint.lat, lng: endPoint.lng }
      ]);
    } else {
      setPlanningAlert(null);
    }
  }, [plannedRoute, startPoint, endPoint, offlineAreas]);

  const workingDays = useMemo(() => {
    const days = [];
    // Use local time for calculation to avoid timezone shifts with getDay()
    let curr = new Date(2026, 3, 11); // April 11, 2026
    const end = new Date(2026, 4, 29); // May 29, 2026
    
    while (curr <= end) {
      const day = curr.getDay();
      const y = curr.getFullYear();
      const m = String(curr.getMonth() + 1).padStart(2, '0');
      const d = String(curr.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${d}`;
      
      // April 11 (Sat) and 12 (Sun) are exceptions
      if (dateStr === '2026-04-11' || dateStr === '2026-04-12') {
        days.push(dateStr);
      } else if (day >= 1 && day <= 4) {
        // Mon-Thu
        days.push(dateStr);
      }
      curr.setDate(curr.getDate() + 1);
    }
    return days;
  }, []);

  const [allPlannedRoutes, setAllPlannedRoutes] = useState<Record<string, any>>({});

  // Fetch all planned routes for the calendar
  useEffect(() => {
    if (!user || !isAuthReady) return;

    const q = query(
      collection(db, `users/${user.uid}/plannedRoutes`)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const routes: Record<string, any> = {};
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        routes[data.date] = { id: doc.id, ...data };
      });
      setAllPlannedRoutes(routes);
    }, (err) => handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/plannedRoutes`));

    return () => unsubscribe();
  }, [user, isAuthReady]);

  const autoSchedule = async () => {
    if (!user) return;
    setIsOptimizing(true);
    
    try {
      const unvisited = [...locations];
      const schedule: Record<string, Location[]> = {};
      let currentPos = HOME_LOCATION;
      
      for (const date of workingDays) {
        const dayRoute: Location[] = [];
        let currentTime = 10 * 60; // 10:00 AM in minutes
        const endTimeMinutes = 18 * 60; // 6:00 PM
        
        // Is it a weekend? (Only April 11/12)
        const isWeekend = date === '2026-04-11' || date === '2026-04-12';
        
        while (unvisited.length > 0) {
          // Find closest store
          // Respect T-Mobile constraint: No T-Mobile on Fri-Sun (except 11/12)
          // Since we only work Mon-Thu + 11/12, this is mostly handled by workingDays
          // but let's be explicit if we ever add more days.
          
          const candidates = unvisited.filter(loc => {
            if (loc.carrier === 'T-MOBILE') {
              const d = new Date(date + 'T12:00:00');
              const day = d.getDay();
              if ((day === 0 || day === 5 || day === 6) && !isWeekend) return false;
            }
            return true;
          });
          
          if (candidates.length === 0) break;
          
          // Simple greedy: closest to currentPos
          candidates.sort((a, b) => {
            const distA = Math.sqrt(Math.pow(a.lat - currentPos.lat, 2) + Math.pow(a.lng - currentPos.lng, 2));
            const distB = Math.sqrt(Math.pow(b.lat - currentPos.lat, 2) + Math.pow(b.lng - currentPos.lng, 2));
            return distA - distB;
          });
          
          const next = candidates[0];
          
          // Estimate travel + visit time (approx 15m travel + 45m visit)
          const estimatedTime = 60; 
          
          if (currentTime + estimatedTime > endTimeMinutes) break;
          
          dayRoute.push(next);
          unvisited.splice(unvisited.indexOf(next), 1);
          currentTime += estimatedTime;
          currentPos = next;
        }
        
        if (dayRoute.length > 0) {
          schedule[date] = dayRoute;
          // Save to Firestore
          const routeData = {
            uid: user.uid,
            date: date,
            stops: dayRoute.map(s => s.id),
            startPointId: 'HOME',
            endPointId: 'HOME',
            isConfirmed: true,
            updatedAt: serverTimestamp()
          };
          
          const q = query(
            collection(db, `users/${user.uid}/plannedRoutes`),
            where('date', '==', date)
          );
          const snap = await getDocs(q);
          if (snap.empty) {
            await addDoc(collection(db, `users/${user.uid}/plannedRoutes`), routeData);
          } else {
            await setDoc(doc(db, `users/${user.uid}/plannedRoutes`, snap.docs[0].id), routeData, { merge: true });
          }
        }
        
        currentPos = HOME_LOCATION; // Reset to home for next day
        if (unvisited.length === 0) break;
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsOptimizing(false);
    }
  };

  const selectEnclosedStores = () => {
    if (drawingMode === 'polygon' && drawPoints.length >= 3) {
      const polygon = drawPoints.map(p => [p[1], p[0]]); // [lng, lat] for point-in-polygon
      const enclosed = locations.filter(loc => {
        return inside([loc.lng, loc.lat], polygon);
      });
      const newIds = new Set(selectedIds);
      enclosed.forEach(loc => newIds.add(loc.id));
      setSelectedIds(newIds);
    } else if (drawingMode === 'circle' && drawCircle) {
      const enclosed = locations.filter(loc => {
        const dist = L.latLng(drawCircle.center).distanceTo([loc.lat, loc.lng]);
        return dist <= drawCircle.radius;
      });
      const newIds = new Set(selectedIds);
      enclosed.forEach(loc => newIds.add(loc.id));
      setSelectedIds(newIds);
    }
    setDrawingMode(null);
    setDrawPoints([]);
    setDrawCircle(null);
  };

  const clearAllSchedules = async () => {
    if (!user) return;
    
    setIsOptimizing(true);
    setShowClearConfirm(false);
    try {
      const q = query(collection(db, `users/${user.uid}/plannedRoutes`));
      const snap = await getDocs(q);
      const deletePromises = snap.docs.map(d => deleteDoc(doc(db, `users/${user.uid}/plannedRoutes`, d.id)));
      await Promise.all(deletePromises);
    } catch (err) {
      console.error(err);
    } finally {
      setIsOptimizing(false);
    }
  };

  const CalendarView = () => {
    const months = [
      { name: 'April 2026', month: 3, year: 2026 },
      { name: 'May 2026', month: 4, year: 2026 }
    ];

    return (
      <div className="p-8 h-full overflow-y-auto custom-scrollbar bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-3xl font-black text-neutral-900 tracking-tight">Visit Calendar</h2>
              {isRescheduling ? (
                <p className="text-blue-600 font-bold animate-pulse">Select a new date for the route from {isRescheduling}</p>
              ) : (
                <p className="text-neutral-500 font-medium">April 11 - May 29, 2026 • Washington Market</p>
              )}
            </div>
            <div className="flex gap-3">
              {isRescheduling && (
                <button 
                  onClick={() => setIsRescheduling(null)}
                  className="px-6 py-3 bg-neutral-100 text-neutral-600 rounded-2xl font-bold transition-all"
                >
                  Cancel Move
                </button>
              )}
              <button 
                onClick={autoSchedule}
                disabled={isOptimizing}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold shadow-lg shadow-blue-200 transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {isOptimizing ? <Sparkles className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Auto-Schedule All Stores
              </button>
              {Object.keys(allPlannedRoutes).length > 0 && (
                <div className="relative">
                  <button 
                    onClick={() => setShowClearConfirm(!showClearConfirm)}
                    disabled={isOptimizing}
                    className="px-6 py-3 bg-white border-2 border-neutral-200 hover:border-red-200 hover:bg-red-50 text-neutral-600 hover:text-red-600 rounded-2xl font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                    Clear All
                  </button>
                  
                  <AnimatePresence>
                    {showClearConfirm && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute top-full right-0 mt-2 w-64 bg-white rounded-2xl shadow-2xl border border-neutral-100 p-4 z-50"
                      >
                        <p className="text-xs font-bold text-neutral-900 mb-3">Clear all scheduled routes?</p>
                        <div className="flex gap-2">
                          <button 
                            onClick={clearAllSchedules}
                            className="flex-1 py-2 bg-red-600 text-white rounded-xl text-[10px] font-bold hover:bg-red-700 transition-all"
                          >
                            Yes, Clear
                          </button>
                          <button 
                            onClick={() => setShowClearConfirm(false)}
                            className="flex-1 py-2 bg-neutral-100 text-neutral-600 rounded-xl text-[10px] font-bold hover:bg-neutral-200 transition-all"
                          >
                            Cancel
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            {months.map(({ name, month, year }) => {
              const firstDay = new Date(year, month, 1).getDay();
              const daysInMonth = new Date(year, month + 1, 0).getDate();
              const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
              const padding = Array.from({ length: firstDay }, (_, i) => null);

              return (
                <div key={name} className="space-y-4">
                  <h3 className="text-xl font-bold text-neutral-800 px-2">{name}</h3>
                  <div className="grid grid-cols-7 gap-2">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                      <div key={d} className="text-center text-[10px] font-black text-neutral-400 uppercase tracking-widest py-2">
                        {d}
                      </div>
                    ))}
                    {[...padding, ...days].map((day, i) => {
                      if (day === null) return <div key={`pad-${i}`} />;
                      
                      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                      const isWorking = workingDays.includes(dateStr);
                      const route = allPlannedRoutes[dateStr];
                      const isSelected = selectedDate === dateStr;

                      return (
                        <div 
                          key={dateStr}
                          onClick={() => {
                            if (isRescheduling) {
                              if (isWorking) {
                                rescheduleRoute(isRescheduling, dateStr);
                                setIsRescheduling(null);
                              }
                              return;
                            }
                            setSelectedDate(dateStr);
                            if (isWorking && route) setActiveTab('PLANNER');
                          }}
                          className={cn(
                            "aspect-square rounded-2xl border-2 flex flex-col items-center justify-center gap-1 transition-all cursor-pointer relative group",
                            isSelected ? "border-blue-600 bg-blue-50 shadow-md scale-105 z-10" : "border-transparent hover:border-neutral-200",
                            !isWorking && "opacity-30 grayscale cursor-not-allowed",
                            isWorking && !route && "bg-neutral-50",
                            route && "bg-blue-600 text-white border-blue-600",
                            isRescheduling === dateStr && "ring-4 ring-blue-400 ring-offset-2",
                            isRescheduling && isWorking && isRescheduling !== dateStr && "hover:bg-blue-50 hover:border-blue-300"
                          )}
                        >
                          <span className={cn("text-sm font-bold", route ? "text-white" : "text-neutral-700")}>{day}</span>
                          {route && (
                            <div className="flex flex-col items-center">
                              <span className="text-[8px] font-black uppercase opacity-80">{route.stops.length} Stores</span>
                              <div className="flex gap-0.5 mt-0.5">
                                {route.stops.slice(0, 3).map((_: any, idx: number) => (
                                  <div key={idx} className="w-1 h-1 rounded-full bg-white/60" />
                                ))}
                              </div>
                            </div>
                          )}
                          {route && !isRescheduling && (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setIsRescheduling(dateStr);
                              }}
                              className="absolute -top-2 -right-2 p-1.5 bg-white text-blue-600 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-all border border-neutral-100"
                              title="Move Route"
                            >
                              <ArrowRightLeft className="w-3 h-3" />
                            </button>
                          )}
                          {isSelected && (
                            <motion.div 
                              layoutId="active-day"
                              className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-blue-600 rounded-full"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-12 p-8 bg-neutral-900 rounded-[32px] text-white overflow-hidden relative">
            <div className="relative z-10">
              <h4 className="text-xl font-bold mb-2">Schedule Overview</h4>
              <p className="text-neutral-400 text-sm mb-6">Summary of your Washington market store visits.</p>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                  <p className="text-[10px] font-black text-neutral-500 uppercase tracking-widest mb-1">Total Stores</p>
                  <p className="text-2xl font-bold">{locations.length}</p>
                </div>
                <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                  <p className="text-[10px] font-black text-neutral-500 uppercase tracking-widest mb-1">Scheduled</p>
                  <p className="text-2xl font-bold text-blue-400">
                    {Object.values(allPlannedRoutes).reduce((acc: number, r: any) => acc + (r.stops?.length || 0), 0)}
                  </p>
                </div>
                <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                  <p className="text-[10px] font-black text-neutral-500 uppercase tracking-widest mb-1">Working Days</p>
                  <p className="text-2xl font-bold">{workingDays.length}</p>
                </div>
                <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                  <p className="text-[10px] font-black text-neutral-500 uppercase tracking-widest mb-1">Avg Stops/Day</p>
                  <p className="text-2xl font-bold">
                    {(() => {
                      const routesArray = Object.values(allPlannedRoutes) as any[];
                      const total = routesArray.reduce((acc: number, r: any) => acc + (Number(r?.stops?.length) || 0), 0);
                      const daysCount = Number(workingDays.length);
                      const avg = daysCount > 0 ? total / daysCount : 0;
                      return avg.toFixed(1);
                    })()}
                  </p>
                </div>
              </div>
            </div>
            <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/20 blur-[100px] rounded-full -mr-32 -mt-32" />
          </div>
        </div>
      </div>
    );
  };

  // Clustering logic: Group by City/Area
  const clusters = useMemo(() => {
    const groups: Record<string, Location[]> = {};
    locations.forEach(loc => {
      const area = loc.city;
      if (!groups[area]) groups[area] = [];
      groups[area].push(loc);
    });
    return groups;
  }, []);

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 3958.8; // Miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const sortedLocations = useMemo(() => {
    return [...locations].map(loc => ({
      ...loc,
      distanceFromHome: calculateDistance(HOME_LOCATION.lat, HOME_LOCATION.lng, loc.lat, loc.lng)
    })).sort((a, b) => a.distanceFromHome - b.distanceFromHome);
  }, []);

  const filteredLocations = useMemo(() => {
    const date = new Date(selectedDate + 'T00:00:00');
    const dayOfWeek = date.getDay(); // 0 = Sun, 5 = Fri, 6 = Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
    const isExceptionDate = selectedDate === '2026-04-11' || selectedDate === '2026-04-12';

    return sortedLocations.filter((loc, index) => {
      if (!loc) return false;
      // Filter out stores already part of a confirmed route
      if (visitedStoreIds.has(loc.id)) return false;

      // Closest 62 stores requirement
      if (showOnlyClosest && index >= 62) return false;

      // T-Mobile restriction: No Fri-Sun (except April 11-12)
      if (loc.carrier === 'T-MOBILE' && isWeekend && !isExceptionDate) return false;

      const matchesSearch = loc.address.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           loc.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           loc.city.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCarrier = filterCarrier === 'ALL' || loc.carrier === filterCarrier;
      return matchesSearch && matchesCarrier;
    });
  }, [searchQuery, filterCarrier, selectedDate, showOnlyClosest, sortedLocations, visitedStoreIds]);

  const visitedLocations = useMemo(() => {
    return locations.filter(loc => visitedStoreIds.has(loc.id));
  }, [locations, visitedStoreIds]);

  const optimizeRoute = async () => {
    if (plannedRoute.length < 1) return;
    setIsOptimizing(true);
    
    // Use selected start and end points
    const fullRoute = [startPoint, ...plannedRoute.filter(l => l && l?.id !== startPoint?.id && l?.id !== endPoint?.id), endPoint].filter(Boolean);
    const coords = fullRoute.map(l => `${l.lng},${l.lat}`).join(';');
    
    try {
      const response = await fetch(`https://router.project-osrm.org/trip/v1/driving/${coords}?source=first&destination=last&geometries=geojson`);
      const data = await response.json();
      
      if (data.code === 'Ok') {
        const optimizedIndices = data.waypoints
          .sort((a: any, b: any) => a.waypoint_index - b.waypoint_index)
          .map((w: any) => w.trips_index);
        
        // Reconstruct the plannedRoute in optimized order, excluding start/end if they are Home
        const optimized = optimizedIndices.map(idx => fullRoute[idx]);
        
        // Update plannedRoute to be the middle stops if start/end are Home, 
        // or the full sequence if they are specific stores
        const middleStops = optimized.filter(l => l.id !== 'HOME');
        setPlannedRoute(middleStops);
        
        const trip = data.trips[0];
        setRouteGeometry(trip.geometry.coordinates.map((c: any) => [c[1], c[0]]));
        
        const stats = trip.legs.map((leg: any) => ({
          distance: leg.distance,
          duration: leg.duration
        }));
        setRouteStats(stats);
      }
    } catch (error) {
      console.error('Error optimizing route:', error);
    } finally {
      setIsOptimizing(false);
    }
  };

  const fetchRoute = async (skipNav = false) => {
    if (plannedRoute.length < 1) return;
    
    const fullRoute = [startPoint, ...plannedRoute.filter(l => l && l?.id !== startPoint?.id && l?.id !== endPoint?.id), endPoint].filter(Boolean);
    const coords = fullRoute.map(l => `${l.lng},${l.lat}`).join(';');
    
    try {
      const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?steps=true&geometries=geojson`);
      const data = await response.json();
      
      if (data.code === 'Ok') {
        const route = data.routes[0];
        setRouteGeometry(route.geometry.coordinates.map((c: any) => [c[1], c[0]]));
        
        const steps = route.legs.flatMap((leg: any) => leg.steps.map((step: any) => ({
          instruction: step.maneuver.instruction,
          distance: step.distance,
          name: step.name
        })));
        setInstructions(steps);

        const stats = route.legs.map((leg: any) => ({
          distance: leg.distance,
          duration: leg.duration
        }));
        setRouteStats(stats);

        if (!skipNav) {
          setIsNavigating(true);
        }
      }
    } catch (error) {
      console.error('Error fetching route:', error);
      // OFFLINE FALLBACK: Direct lines
      const fallbackGeometry: [number, number][] = fullRoute.map(l => [l.lat, l.lng]);
      setRouteGeometry(fallbackGeometry);
      setInstructions([{ instruction: "Offline Mode: Showing direct lines between stops.", distance: 0, name: "Direct Path" }]);
      
      const fallbackStats = [];
      for(let i=0; i<fullRoute.length-1; i++) {
        const d = calculateDistance(fullRoute[i].lat, fullRoute[i].lng, fullRoute[i+1].lat, fullRoute[i+1].lng);
        fallbackStats.push({ distance: d, duration: d / 12 }); // Approx 30mph
      }
      setRouteStats(fallbackStats);
      
      if (!skipNav) {
        setIsNavigating(true);
      }
    }
  };

  const checkOfflineValidity = (points: { lat: number; lng: number }[]) => {
    if (offlineAreas.length === 0) return true;
    
    // Check if each point is in at least one downloaded area
    const invalidPoints = points.filter(p => {
      const point = [p.lat, p.lng] as [number, number];
      return !offlineAreas.some(area => {
        if (area.geojson) {
          return inside(point, area.geojson);
        }
        // Fallback to bounds if no geojson
        return p.lat <= area.bounds[0][0] && p.lat >= area.bounds[1][0] &&
               p.lng >= area.bounds[0][1] && p.lng <= area.bounds[1][1];
      });
    });

    if (invalidPoints.length > 0) {
      setPlanningAlert(`Warning: ${invalidPoints.length} stop(s) are in areas without offline map data. Navigation may fail if you go offline.`);
      return false;
    }
    setPlanningAlert(null);
    return true;
  };

  const handleDownloadArea = async () => {
    if ((drawPoints.length < 3 && !drawCircle) || isDownloading) return;
    
    setIsDownloading(true);
    setDownloadProgress(0);
    
    try {
      const areaId = Math.random().toString(36).substring(7);
      let bounds: L.LatLngBounds;
      let geojson: any = null;

      if (drawCircle) {
        const circle = L.circle(drawCircle.center, { radius: drawCircle.radius });
        bounds = circle.getBounds();
        // Approximation of circle for inside check
        geojson = []; // Simplified for this demo
      } else {
        const polygon = L.polygon(drawPoints);
        bounds = polygon.getBounds();
        geojson = drawPoints;
      }

      const urlTemplate = mapLayer === 'satellite' 
        ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        : mapLayer === 'terrain'
        ? "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
        : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

      // Zoom levels to download (e.g., 10 to 15 for a good balance)
      const minZ = 10;
      const maxZ = 15;
      const tiles = getTilesInBounds(bounds, minZ, maxZ);
      
      const total = tiles.length;
      let downloaded = 0;

      // Download in batches to avoid overwhelming the browser
      const batchSize = 10;
      for (let i = 0; i < tiles.length; i += batchSize) {
        const batch = tiles.slice(i, i + batchSize);
        await Promise.all(batch.map(async tile => {
          // Replace {s} {x} {y} {z} in template
          const s = ['a', 'b', 'c'][Math.floor(Math.random() * 3)];
          const url = urlTemplate
            .replace('{s}', s)
            .replace('{x}', tile.x.toString())
            .replace('{y}', tile.y.toString())
            .replace('{z}', tile.z.toString());
          
          await downloadTile(url);
          downloaded++;
          setDownloadProgress(Math.round((downloaded / total) * 100));
        }));
      }

      const newArea: OfflineArea = {
        id: areaId,
        name: `Area ${offlineAreas.length + 1}`,
        bounds: [[bounds.getNorth(), bounds.getWest()], [bounds.getSouth(), bounds.getEast()]],
        zoomRange: [minZ, maxZ],
        tileCount: total,
        sizeMB: parseFloat((total * 0.05).toFixed(2)), // Approx 50KB per tile
        date: new Date().toISOString(),
        geojson
      };

      await saveAreaMetadata(newArea);
      setOfflineAreas(prev => [...prev, newArea]);
      setDrawPoints([]);
      setDrawCircle(null);
      setDrawingMode(null);
      alert('Area downloaded successfully!');
    } catch (error) {
      console.error('Download failed:', error);
      alert('Failed to download area. Check your connection.');
    } finally {
      setIsDownloading(false);
      setDownloadProgress(0);
    }
  };

  const handleDeleteArea = async (id: string) => {
    if (!confirm('Are you sure you want to delete this offline area?')) return;
    await deleteArea(id, "");
    setOfflineAreas(prev => prev.filter(a => a.id !== id));
  };

  const calculateETA = (index: number) => {
    const [startH, startM] = (startTime || '10:00').split(':').map(Number);
    const [endH, endM] = (endTime || '18:00').split(':').map(Number);
    
    const fullRoute = [startPoint, ...plannedRoute.filter(l => l && l?.id !== startPoint?.id && l?.id !== endPoint?.id), endPoint].filter(Boolean);
    
    let totalSeconds = 0;
    
    // Calculate Arrival Time for stop 'index'
    for (let i = 0; i < index; i++) {
      const currentStop = fullRoute[i];
      if (!currentStop) continue;

      // If the stop we are leaving (i) is NOT home, we spend time there BEFORE leaving
      if (currentStop.id !== 'HOME') {
        const duration = (currentStop.visitDuration || visitDuration) * 60;
        totalSeconds += duration;
      }

      // Add travel time for the leg leading to stop i+1
      if (routeStats[i]) {
        totalSeconds += (routeStats[i].duration * trafficMultiplier);
      }
    }
    
    const start = new Date();
    start.setHours(startH, startM, 0);
    const arrivalTime = new Date(start.getTime() + totalSeconds * 1000);
    
    // Departure time is arrival time + visit duration (if not Home)
    const currentVisitDuration = (fullRoute[index]?.visitDuration || visitDuration) * 60;
    const departureTime = new Date(arrivalTime.getTime() + (fullRoute[index]?.id !== 'HOME' ? currentVisitDuration : 0));
    
    const end = new Date();
    end.setHours(endH, endM, 0);
    
    const format = (date: Date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    return {
      arrival: format(arrivalTime),
      departure: format(departureTime),
      isOverdue: arrivalTime > end
    };
  };

  const fetchGasStations = async () => {
    setIsLoadingGas(true);
    // Search around the home location for gas stations
    const lat = HOME_LOCATION.lat;
    const lng = HOME_LOCATION.lng;
    const radius = 5000; // 5km
    
    const query = `
      [out:json];
      node["amenity"="fuel"](around:${radius},${lat},${lng});
      out body;
    `;
    
    try {
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query
      });
      const data = await response.json();
      
      // Mock prices since real-time gas prices are not available via free public API
      // We'll use a realistic range for DC area (e.g., $3.40 - $3.90)
      const stations = data.elements.map((el: any) => ({
        id: el.id,
        lat: el.lat,
        lng: el.lon,
        name: el.tags.name || 'Gas Station',
        brand: el.tags.brand || 'Independent',
        price: (3.4 + Math.random() * 0.5).toFixed(2)
      }));
      
      setGasStations(stations);
    } catch (error) {
      console.error('Error fetching gas stations:', error);
    } finally {
      setIsLoadingGas(false);
    }
  };

  useEffect(() => {
    if (showGasStations && gasStations.length === 0) {
      fetchGasStations();
    }
  }, [showGasStations]);

  const addToRoute = async (location: Location) => {
    if (plannedRoute.find(l => l?.id === location.id)) {
      // If already in route, remove it (unselect)
      const newRoute = plannedRoute.filter(l => l?.id !== location.id);
      setPlannedRoute(newRoute);
      if (selectedLocation?.id === location.id) {
        setSelectedLocation(null);
      }
      if (user) await savePlannedRoute(newRoute, startPoint, endPoint);
    } else {
      // If not in route, add it (select)
      const newRoute = [...plannedRoute, location];
      setPlannedRoute(newRoute);
      setSelectedLocation(location);
      if (user) await savePlannedRoute(newRoute, startPoint, endPoint);
    }
  };

  const removeFromRoute = async (id: string) => {
    const newRoute = plannedRoute.filter(l => l?.id !== id);
    setPlannedRoute(newRoute);
    if (user) await savePlannedRoute(newRoute, startPoint, endPoint);
  };

  const updateLocationDuration = (id: string, duration: number) => {
    const newRoute = plannedRoute.map(l => {
      if (l.id === id) {
        return { ...l, visitDuration: duration };
      }
      return l;
    });
    setPlannedRoute(newRoute);
    
    // Also update start/end points if they match
    if (startPoint?.id === id) setStartPoint({ ...startPoint, visitDuration: duration });
    if (endPoint?.id === id) setEndPoint({ ...endPoint, visitDuration: duration });
  };

  const isPlanned = (id: string) => plannedRoute.some(l => l?.id === id);

  const moveInRoute = async (index: number, direction: 'up' | 'down') => {
    const newRoute = [...plannedRoute];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newRoute.length) return;
    
    [newRoute[index], newRoute[targetIndex]] = [newRoute[targetIndex], newRoute[index]];
    setPlannedRoute(newRoute);
    if (user) await savePlannedRoute(newRoute, startPoint, endPoint);
  };

  const routePositions = useMemo(() => 
    plannedRoute.map(loc => [loc.lat, loc.lng] as [number, number]),
  [plannedRoute]);

  const centerPosition: [number, number] = useMemo(() => {
    if (selectedLocation) return [selectedLocation.lat, selectedLocation.lng];
    if (plannedRoute.length > 0) return [plannedRoute[0].lat, plannedRoute[0].lng];
    return [38.8654, -76.9448]; // Home
  }, [selectedLocation, plannedRoute]);

  const mapZoom = 12;

  const exportToCSV = () => {
    const headers = ["Date", "Stops Count", "Total Miles", "Duration (min)", "Visited Stops"];
    
    const rows = routeHistory.map(r => {
      // Resolve addresses for all stops in the route
      const getAddress = (id: string) => {
        if (id === 'HOME') return HOME_LOCATION.address;
        const loc = locations.find(l => l.id === id);
        return loc ? loc.address : id;
      };

      const startAddr = getAddress(r.startPointId);
      const endAddr = getAddress(r.endPointId);
      const stopsAddrs = (r.stopIds || []).map((id: string) => getAddress(id));

      // Construct the full stop sequence
      const fullSequence = [
        `START: ${startAddr}`,
        ...stopsAddrs,
        `END: ${endAddr}`
      ].join(" -> ");

      return [
        r.date,
        r.stops,
        r.miles.toFixed(2),
        Math.round(r.duration / 60),
        fullSequence
      ];
    });
    
    // Properly escape CSV fields that might contain commas or quotes
    const csvContent = [headers, ...rows]
      .map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `route_history_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const completeRoute = async () => {
    const totalMiles = routeStats.reduce((acc, curr) => acc + curr.distance * 0.000621371, 0);
    const totalDuration = routeStats.reduce((acc, curr) => acc + curr.duration, 0);
    
    const newEntry = {
      uid: user?.uid,
      date: selectedDate,
      stops: plannedRoute.length,
      stopIds: plannedRoute.map(s => s.id),
      startPointId: startPoint?.id,
      endPointId: endPoint?.id,
      miles: totalMiles,
      duration: totalDuration,
      timestamp: serverTimestamp()
    };
    
    if (user) {
      try {
        await addDoc(collection(db, `users/${user.uid}/history`), newEntry);
        // Clear planned route for this day
        const q = query(
          collection(db, `users/${user.uid}/plannedRoutes`),
          where('date', '==', selectedDate)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          await deleteDoc(doc(db, `users/${user.uid}/plannedRoutes`, snapshot.docs[0].id));
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/history`);
      }
    }

    setIsNavigating(false);
    setPlannedRoute([]);
    setRouteStats([]);
    setRouteGeometry([]);
    setIsTracking(false);
  };

  return (
    <div className="flex h-screen bg-neutral-50 font-sans text-neutral-900 overflow-hidden">
      {/* Sidebar */}
      <div className="w-96 flex flex-col border-r border-neutral-200 bg-white z-10 shadow-xl overflow-hidden">
        <div className="p-6 border-bottom border-neutral-100 shrink-0 w-[300px] h-[87px] pl-[11px] pt-[13px] pr-[3px] pb-0">
          <div className="flex items-center justify-between mb-6 w-[243px] h-[38px] mb-[11px]">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-blue-600 rounded-lg">
                <Navigation className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-xl font-bold tracking-tight">RouteMaster</h1>
            </div>
            <div className="flex items-center gap-2">
              {user ? (
                <div className="flex items-center gap-2">
                  <img src={user.photoURL || ''} alt="Avatar" className="w-8 h-8 rounded-full border-2 border-blue-100" />
                  <button onClick={logout} className="p-2 hover:bg-neutral-100 rounded-xl text-neutral-400" title="Logout">
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button onClick={signInWithGoogle} className="p-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-all" title="Login">
                  <LogIn className="w-4 h-4" />
                </button>
              )}
              <div className="flex bg-neutral-100 p-1 rounded-xl w-[165px] pr-[38px] pt-[2px] mt-[70px] mr-[33px] h-[34px] mb-[-8px]">
                <button 
                  onClick={() => setActiveTab('CALENDAR')}
                  className={cn("p-2 rounded-lg transition-all", activeTab === 'CALENDAR' ? "bg-white shadow-sm text-blue-600" : "text-neutral-400")}
                  title="Calendar View"
                >
                  <Calendar className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setActiveTab('PLANNER')}
                  className={cn("p-2 rounded-lg transition-all", activeTab === 'PLANNER' ? "bg-white shadow-sm text-blue-600" : "text-neutral-400")}
                  title="Planner"
                >
                  <MapIcon className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setActiveTab('VISITED')}
                  className={cn("p-2 rounded-lg transition-all", activeTab === 'VISITED' ? "bg-white shadow-sm text-green-600" : "text-neutral-400")}
                  title="Visited Stores"
                >
                  <CheckCircle2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setActiveTab('HISTORY')}
                  className={cn("p-2 rounded-lg transition-all", activeTab === 'HISTORY' ? "bg-white shadow-sm text-blue-600" : "text-neutral-400")}
                  title="Route History"
                >
                  <Clock className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setActiveTab('ANALYTICS')}
                  className={cn("p-2 rounded-lg transition-all", activeTab === 'ANALYTICS' ? "bg-white shadow-sm text-blue-600" : "text-neutral-400")}
                  title="Analytics"
                >
                  <Filter className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setActiveTab('OFFLINE')}
                  className={cn("p-2 rounded-lg transition-all", activeTab === 'OFFLINE' ? "bg-white shadow-sm text-blue-600" : "text-neutral-400")}
                  title="Offline Maps"
                >
                  <Database className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
          {activeTab === 'PLANNER' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                  <input 
                    type="date" 
                    min="2026-04-11"
                    max="2026-05-29"
                    className="w-full pl-10 pr-4 py-2 bg-neutral-100 border-none rounded-xl text-xs focus:ring-2 focus:ring-blue-500"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                  />
                </div>
                <button 
                  onClick={() => setShowOnlyClosest(!showOnlyClosest)}
                  className={cn(
                    "px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all",
                    showOnlyClosest ? "bg-blue-600 text-white" : "bg-neutral-100 text-neutral-600"
                  )}
                >
                  {showOnlyClosest ? "Closest 62" : "All Stores"}
                </button>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                <input 
                  type="text" 
                  placeholder="Search locations..." 
                  className="w-full pl-10 pr-4 py-2 bg-neutral-100 border-none rounded-xl text-sm focus:ring-2 focus:ring-blue-500 transition-all"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              
              <div className="flex gap-2">
                <button 
                  onClick={() => setFilterCarrier('ALL')}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                    filterCarrier === 'ALL' ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                  )}
                >
                  All
                </button>
                <button 
                  onClick={() => setFilterCarrier('T-MOBILE')}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                    filterCarrier === 'T-MOBILE' ? "bg-pink-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                  )}
                >
                  T-Mobile
                </button>
                <button 
                  onClick={() => setFilterCarrier('METRO')}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                    filterCarrier === 'METRO' ? "bg-purple-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                  )}
                >
                  Metro
                </button>
              </div>

              <div className="p-4 bg-neutral-50 rounded-2xl space-y-3">
                <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Schedule Settings</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-neutral-500">Start Time</label>
                    <input 
                      type="time" 
                      className="w-full px-2 py-1.5 bg-white border border-neutral-200 rounded-lg text-xs"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-neutral-500">End Time</label>
                    <input 
                      type="time" 
                      className="w-full px-2 py-1.5 bg-white border border-neutral-200 rounded-lg text-xs"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-neutral-500">Visit Duration (min)</label>
                  <div className="flex items-center gap-3">
                    <input 
                      type="range" 
                      min="15" 
                      max="120" 
                      step="5"
                      className="flex-1 h-1.5 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                      value={visitDuration}
                      onChange={(e) => setVisitDuration(parseInt(e.target.value))}
                    />
                    <span className="text-xs font-bold text-neutral-700 w-8">{visitDuration}m</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-neutral-100 space-y-2">
                  <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Route Options</p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input 
                        type="checkbox" 
                        className="w-3 h-3 rounded border-neutral-300 text-blue-600 focus:ring-blue-500"
                        checked={avoidTolls}
                        onChange={(e) => setAvoidTolls(e.target.checked)}
                      />
                      <span className="text-[10px] text-neutral-600 group-hover:text-neutral-900 transition-colors">Avoid Tolls</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input 
                        type="checkbox" 
                        className="w-3 h-3 rounded border-neutral-300 text-blue-600 focus:ring-blue-500"
                        checked={avoidTraffic}
                        onChange={(e) => setAvoidTraffic(e.target.checked)}
                      />
                      <span className="text-[10px] text-neutral-600 group-hover:text-neutral-900 transition-colors">Avoid Traffic</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input 
                        type="checkbox" 
                        className="w-3 h-3 rounded border-neutral-300 text-blue-600 focus:ring-blue-500"
                        checked={showGasStations}
                        onChange={(e) => setShowGasStations(e.target.checked)}
                      />
                      <span className="text-[10px] text-neutral-600 group-hover:text-neutral-900 transition-colors">Show Gas</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input 
                        type="checkbox" 
                        className="w-3 h-3 rounded border-neutral-300 text-blue-600 focus:ring-blue-500"
                        checked={showTrafficLayer}
                        onChange={(e) => setShowTrafficLayer(e.target.checked)}
                      />
                      <span className="text-[10px] text-neutral-600 group-hover:text-neutral-900 transition-colors">Traffic Layer & Alerts</span>
                    </label>
                  </div>
                  {(avoidTolls || avoidTraffic || showTrafficLayer) && (
                    <div className="space-y-1">
                      <p className="text-[9px] text-blue-500 font-medium italic">* Routing engine will prioritize these preferences where data is available.</p>
                      {showTrafficLayer && trafficAlerts.length > 0 && (
                        <div className="bg-blue-50 p-2 rounded-lg border border-blue-100">
                          <p className="text-[9px] font-bold text-blue-700 uppercase mb-1 flex items-center gap-1">
                            <Sparkles className="w-2 h-2" />
                            Live Traffic Insights
                          </p>
                          {trafficAlerts.map((alert, i) => (
                            <p key={i} className="text-[9px] text-blue-600 leading-tight">• {alert}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
          {activeTab === 'PLANNER' && (
            <>
              {showGasStations && (
                <div className="mb-6 space-y-3">
                  <div className="flex items-center justify-between px-2">
                    <span className="text-xs font-bold uppercase tracking-widest text-green-600 flex items-center gap-2">
                      <Fuel className="w-3 h-3" />
                      Nearby Gas Stations
                    </span>
                    {isLoadingGas && <div className="w-3 h-3 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />}
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                    {gasStations.map(station => (
                      <div 
                        key={station.id}
                        className="min-w-[140px] p-3 bg-green-50 rounded-2xl border border-green-100 flex flex-col gap-1"
                      >
                        <p className="text-[10px] font-bold text-green-700 truncate">{station.name}</p>
                        <p className="text-[9px] text-green-600/70 truncate">{station.brand}</p>
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-[9px] font-bold text-green-800">$</span>
                          <span className="text-xs font-black text-green-700">{station.price}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between px-2 mb-2">
                <span className="text-xs font-bold uppercase tracking-widest text-neutral-400">Available Stores</span>
                <div className="flex items-center gap-2">
                  {selectedIds.size > 0 && (
                    <button 
                      onClick={addSelectedToRoute}
                      className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-lg hover:bg-blue-100 transition-all"
                    >
                      Add {selectedIds.size} Selected
                    </button>
                  )}
                  <span className="text-xs font-medium text-neutral-500">{filteredLocations.length} found</span>
                </div>
              </div>
              
              {filteredLocations.map((loc) => (
                <motion.div
                  layout
                  key={loc.id}
                  onClick={() => setSelectedLocation(loc)}
                  className={cn(
                    "group relative p-4 rounded-2xl border transition-all cursor-pointer",
                    isPlanned(loc.id) 
                      ? "bg-neutral-50 border-neutral-100 opacity-60" 
                      : "bg-white border-neutral-200 hover:border-blue-500 hover:shadow-md",
                    selectedLocation?.id === loc.id && "ring-2 ring-blue-500 border-transparent"
                  )}
                >
                  <div className="flex justify-between items-start mb-1">
                    <div className="flex items-center gap-3">
                      {!isPlanned(loc.id) && (
                        <input 
                          type="checkbox"
                          className="w-4 h-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          checked={selectedIds.has(loc.id)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleSelection(loc.id)}
                        />
                      )}
                      <div className="flex flex-col gap-1">
                        <span className={cn(
                          "text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider w-fit",
                          loc.carrier === 'T-MOBILE' ? "bg-pink-100 text-pink-700" : "bg-purple-100 text-purple-700"
                        )}>
                          {loc.carrier}
                        </span>
                        <span className="text-[9px] font-bold text-neutral-400 uppercase tracking-tighter">
                          Area: {loc.city}
                        </span>
                      </div>
                    </div>
                    {isPlanned(loc.id) ? (
                      <CheckCircle2 className="w-5 h-5 text-blue-500" />
                    ) : (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          addToRoute(loc);
                        }}
                        className="p-1 rounded-full hover:bg-blue-50 text-neutral-400 hover:text-blue-600 transition-colors"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                  <h3 className="font-semibold text-sm mb-1">{loc.address}</h3>
                  <div className="flex items-center gap-1 text-xs text-neutral-500">
                    <MapPin className="w-3 h-3" />
                    <span>{loc.city}, {loc.state}</span>
                  </div>
                </motion.div>
              ))}
            </>
          )}

          {activeTab === 'VISITED' && (
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-400">Visited Stores</h3>
                <span className="text-xs font-bold bg-green-50 text-green-600 px-2 py-1 rounded-lg">
                  {visitedLocations.length} Completed
                </span>
              </div>
              
              <div className="space-y-3">
                {visitedLocations.map((loc) => (
                  <div 
                    key={loc.id}
                    className="p-4 bg-neutral-50 border border-neutral-100 rounded-2xl flex items-center gap-4"
                  >
                    <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-neutral-800 truncate">{loc.name}</p>
                      <p className="text-xs text-neutral-500 truncate">{loc.address}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-[10px] font-bold text-neutral-400 uppercase">{loc.carrier}</span>
                        <div className="w-1 h-1 rounded-full bg-neutral-300" />
                        <span className="text-[10px] font-bold text-green-600 uppercase">Checked Off</span>
                      </div>
                    </div>
                  </div>
                ))}
                {visitedLocations.length === 0 && (
                  <div className="text-center py-20">
                    <div className="w-16 h-16 bg-neutral-50 rounded-full flex items-center justify-center mx-auto mb-4">
                      <CheckCircle2 className="w-8 h-8 text-neutral-200" />
                    </div>
                    <p className="text-neutral-400 text-sm italic">No stores visited yet.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'HISTORY' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-400">Route History</h3>
                <button 
                  onClick={exportToCSV}
                  className="text-[10px] font-bold text-blue-600 hover:underline flex items-center gap-1"
                >
                  <Download className="w-4 h-4" /> Export CSV
                </button>
              </div>
              {routeHistory.map(route => (
                <div key={route.id} className="p-4 bg-white border border-neutral-200 rounded-2xl">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-bold text-neutral-400">{route.date}</span>
                    <span className="text-[10px] font-bold bg-blue-50 text-blue-600 px-2 py-0.5 rounded uppercase">
                      {route.stops} Stops
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] uppercase text-neutral-400 font-bold">Total Miles</p>
                      <p className="text-sm font-bold">{route.miles.toFixed(2)} mi</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-neutral-400 font-bold">Duration</p>
                      <p className="text-sm font-bold">{Math.round(route.duration / 60)} mins</p>
                    </div>
                  </div>
                </div>
              ))}
              {routeHistory.length === 0 && (
                <p className="text-center text-neutral-400 text-xs py-10 italic">No completed routes yet.</p>
              )}
            </div>
          )}

          {activeTab === 'ANALYTICS' && (
            <div className="space-y-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-400 px-2">Insights & Analytics</h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-blue-50 rounded-2xl">
                  <p className="text-[10px] font-bold text-blue-600 uppercase mb-1">Total Miles</p>
                  <p className="text-2xl font-bold text-blue-900">
                    {routeHistory.reduce((acc, curr) => acc + curr.miles, 0).toFixed(1)}
                  </p>
                </div>
                <div className="p-4 bg-purple-50 rounded-2xl">
                  <p className="text-[10px] font-bold text-purple-600 uppercase mb-1">Total Stops</p>
                  <p className="text-2xl font-bold text-purple-900">
                    {routeHistory.reduce((acc, curr) => acc + curr.stops, 0)}
                  </p>
                </div>
              </div>

              <div className="h-64 w-full bg-white p-4 rounded-3xl border border-neutral-100">
                <p className="text-[10px] font-bold text-neutral-400 uppercase mb-4">Mileage per Route</p>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={routeHistory.slice().reverse()}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis 
                      dataKey="date" 
                      hide 
                    />
                    <YAxis hide />
                    <Tooltip 
                      contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                      labelStyle={{ fontWeight: 'bold', fontSize: '12px' }}
                    />
                    <Bar dataKey="miles" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-bold text-neutral-500 uppercase px-2">Store Clusters</h4>
                <div className="grid grid-cols-1 gap-2 px-2">
                  {(Object.entries(clusters) as [string, Location[]][]).sort((a, b) => b[1].length - a[1].length).slice(0, 8).map(([area, stores]) => (
                    <div key={area} className="space-y-2">
                      <div 
                        onClick={() => setExpandedCluster(expandedCluster === area ? null : area)}
                        className={cn(
                          "flex items-center justify-between p-3 rounded-xl transition-all cursor-pointer",
                          expandedCluster === area ? "bg-blue-50 border border-blue-200 shadow-sm" : "bg-neutral-50 border border-transparent hover:bg-neutral-100"
                        )}
                      >
                        <div>
                          <p className="text-xs font-bold text-neutral-700">{area}</p>
                          <p className="text-[10px] text-neutral-400">{stores.length} locations in this cluster</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-bold bg-white px-2 py-1 rounded-lg border border-neutral-200">
                            {Math.round((stores.length / locations.length) * 100)}%
                          </span>
                          <ChevronRight className={cn("w-4 h-4 text-neutral-400 transition-transform", expandedCluster === area && "rotate-90")} />
                        </div>
                      </div>
                      
                      <AnimatePresence>
                        {expandedCluster === area && (
                          <motion.div 
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="bg-white border border-neutral-100 rounded-xl p-2 space-y-1 ml-2">
                              {stores.map(store => (
                                <div 
                                  key={store.id}
                                  onClick={() => {
                                    setActiveTab('PLANNER');
                                  }}
                                  className="p-2 hover:bg-neutral-50 rounded-lg transition-colors cursor-pointer flex items-center justify-between group"
                                >
                                  <div className="min-w-0">
                                    <p className="text-[11px] font-semibold text-neutral-800 truncate">{store.address}</p>
                                    <p className="text-[9px] text-neutral-400 uppercase font-bold">{store.carrier}</p>
                                  </div>
                                  <MapPin className="w-3 h-3 text-neutral-300 group-hover:text-blue-500 transition-colors" />
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'OFFLINE' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between px-2">
                <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-400">Offline Map Management</h3>
                <div className={cn(
                  "flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase",
                  offlineStatus === 'online' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                )}>
                  <div className={cn("w-1.5 h-1.5 rounded-full", offlineStatus === 'online' ? "bg-green-500" : "bg-red-500")} />
                  {offlineStatus}
                </div>
              </div>

              {planningAlert && (
                <div className="mx-2 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex gap-3 text-amber-800">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <p className="text-xs font-medium leading-relaxed">{planningAlert}</p>
                </div>
              )}

              <div className="mx-2 p-6 bg-blue-600 rounded-3xl text-white relative overflow-hidden group">
                <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-white/20 rounded-xl">
                      <Download className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold">Download New Area</h4>
                      <p className="text-[10px] opacity-70">Save maps for disconnected travel</p>
                    </div>
                  </div>

                  {!isDownloading ? (
                    <div className="grid grid-cols-2 gap-2">
                      <button 
                         onClick={() => {
                           setDrawingMode('polygon');
                           setDrawPoints([]);
                           setActiveTab('PLANNER'); // Switch to map view
                         }}
                         className="py-3 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 border border-white/20"
                      >
                        <SquareIcon className="w-4 h-4" />
                        Select Area
                      </button>
                      <button 
                         onClick={handleDownloadArea}
                         disabled={drawPoints.length < 3 && !drawCircle}
                         className="py-3 bg-white text-blue-600 rounded-xl text-xs font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg"
                      >
                        <CloudDownload className="w-4 h-4" />
                        Download
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-wider">
                        <span>Downloading Tiles...</span>
                        <span>{downloadProgress}%</span>
                      </div>
                      <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                        <motion.div 
                          className="h-full bg-white" 
                          initial={{ width: 0 }}
                          animate={{ width: `${downloadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
                <div className="absolute -right-8 -bottom-8 opacity-10 blur-xl">
                  <MapIcon className="w-40 h-40" />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                  <h4 className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Management Console</h4>
                  <div className="flex items-center gap-1 text-[10px] text-neutral-400 font-medium">
                    <Database className="w-3 h-3" />
                    <span>{offlineAreas.length} Areas Saved</span>
                  </div>
                </div>
                
                <div className="space-y-3 px-2">
                  {offlineAreas.length === 0 ? (
                    <div className="text-center py-12 bg-neutral-50 rounded-[32px] border-2 border-dashed border-neutral-100">
                      <div className="w-12 h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center mx-auto mb-4 border border-neutral-100">
                        <WifiOff className="w-6 h-6 text-neutral-300" />
                      </div>
                      <h5 className="text-sm font-bold text-neutral-800">No Offline Maps</h5>
                      <p className="text-[10px] text-neutral-400 max-w-[180px] mx-auto mt-2 leading-relaxed">
                        Download specific areas to use the planner and maps without an internet connection.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3">
                      {offlineAreas.map(area => (
                        <motion.div 
                          key={area.id} 
                          layout
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="bg-white border border-neutral-100 rounded-[28px] overflow-hidden shadow-sm hover:shadow-md transition-all group"
                        >
                          <div className="p-4 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-500 group-hover:bg-blue-600 group-hover:text-white transition-all">
                                <MapIcon className="w-6 h-6" />
                              </div>
                              <div className="min-w-0">
                                <h5 className="text-sm font-bold text-neutral-800 truncate">{area.name}</h5>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-[9px] font-black text-neutral-400 uppercase tracking-tighter bg-neutral-50 px-1.5 py-0.5 rounded">
                                    {area.sizeMB} MB
                                  </span>
                                  <span className="text-[9px] font-medium text-neutral-500">
                                    {new Date(area.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                  </span>
                                </div>
                              </div>
                            </div>
                            
                            <button 
                              onClick={() => handleDeleteArea(area.id)}
                              className="p-3 bg-neutral-50 hover:bg-red-50 text-neutral-400 hover:text-red-500 rounded-2xl transition-all"
                              title="Delete Area"
                            >
                              <Trash className="w-4 h-4" />
                            </button>
                          </div>
                          
                          <div className="px-4 pb-4 flex items-center justify-between border-t border-neutral-50 pt-3">
                            <div className="flex items-center gap-4">
                              <div className="flex flex-col">
                                <span className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest">Tiles</span>
                                <span className="text-xs font-bold text-neutral-700">{area.tileCount.toLocaleString()}</span>
                              </div>
                              <div className="flex flex-col">
                                <span className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest">Levels</span>
                                <span className="text-xs font-bold text-neutral-700">{area.zoomRange[0]}-{area.zoomRange[1]}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 text-[10px] text-green-600 font-bold">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Ready</span>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="mx-2 p-4 bg-neutral-50 rounded-2xl border border-neutral-100 flex gap-3 text-neutral-500">
                <Info className="w-4 h-4 shrink-0" />
                <p className="text-[10px] leading-relaxed italic">
                  Note: Offline map data is stored locally in your browser. Clearing your browser cache may remove these maps.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Planned Route Summary */}
        <motion.div 
          initial={false}
          animate={{ height: isRouteSummaryMinimized ? '72px' : '550px' }}
          className={cn(
            "bg-neutral-900 text-white shrink-0 relative overflow-hidden transition-all duration-300 flex flex-col",
            isRouteSummaryMinimized ? "h-[72px] shadow-[0_-8px_30px_rgb(0,0,0,0.5)] border-t border-neutral-800" : "h-[550px]"
          )}
        >
          <div className="p-6 pb-2 relative z-10 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-400" />
                <div className="flex flex-col">
                  <h2 className="font-bold text-sm">Today's Route</h2>
                  {isRouteSummaryMinimized && (
                    <p className="text-[10px] text-neutral-400 font-bold uppercase tracking-widest leading-none mt-0.5">
                      {plannedRoute.length} Stops • {Math.round(routeStats.reduce((acc, curr) => acc + curr.distance, 0) * 0.000621371)} Mi
                    </p>
                  )}
                </div>
                {isRouteConfirmed && !isRouteSummaryMinimized && (
                  <span className="ml-2 px-2 py-0.5 bg-green-500/20 text-green-400 text-[10px] font-bold rounded uppercase tracking-wider flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Confirmed
                  </span>
                )}
                {planningAlert && !isRouteSummaryMinimized && (
                  <div className="ml-2 group relative">
                    <AlertCircle className="w-5 h-5 text-amber-500 animate-pulse cursor-help" />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-neutral-800 border border-neutral-700 text-[9px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                      {planningAlert}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setIsRouteSummaryMinimized(!isRouteSummaryMinimized)}
                  className="p-1.5 hover:bg-white/10 rounded-lg transition-all text-neutral-400 hover:text-white"
                  title={isRouteSummaryMinimized ? "Expand Dashboard" : "Minimize Dashboard"}
                >
                  {isRouteSummaryMinimized ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
              </div>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {!isRouteSummaryMinimized && (
              <motion.div
                key="summary-expanded"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 overflow-hidden flex flex-col px-6 pb-6 relative z-10"
              >
                <div className="space-y-4 mb-4">
                  <div className="flex gap-2">
                    {plannedRoute.length > 0 && (
                      <button 
                        onClick={async () => {
                          setIsReviewing(true);
                          try {
                            await fetchRoute(true);
                            setAssignDate(selectedDate);
                            setShowReviewModal(true);
                          } finally {
                            setIsReviewing(false);
                          }
                        }}
                        disabled={isReviewing}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg transition-all text-xs font-bold flex items-center gap-1 disabled:opacity-50"
                      >
                        {isReviewing ? <Sparkles className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                        {isReviewing ? 'Loading...' : 'Review & Confirm'}
                      </button>
                    )}
                    {isRouteConfirmed && (
                      <button 
                        onClick={() => {
                          setActiveTab('CALENDAR');
                          setIsRescheduling(selectedDate);
                        }}
                        className="p-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-all text-blue-400"
                        title="Reschedule Route"
                      >
                        <ArrowRightLeft className="w-4 h-4" />
                      </button>
                    )}
                    {plannedRoute.length > 2 && (
                      <button 
                        onClick={optimizeRoute}
                        disabled={isOptimizing}
                        className="p-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-all text-purple-400 disabled:opacity-50"
                        title="Optimize Sequence"
                      >
                        <Sparkles className={cn("w-4 h-4", isOptimizing && "animate-spin")} />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-white/5 rounded-2xl border border-white/10">
                      <p className="text-[9px] font-bold text-neutral-500 uppercase tracking-widest mb-1">Total Distance</p>
                      <p className="text-xl font-bold">
                        {(routeStats.reduce((acc, curr) => acc + curr.distance, 0) * 0.000621371).toFixed(1)}
                        <span className="ml-1 text-[10px] text-neutral-500">mi</span>
                      </p>
                    </div>
                    <div className="p-3 bg-white/5 rounded-2xl border border-white/10">
                      <p className="text-[9px] font-bold text-neutral-500 uppercase tracking-widest mb-1">Travel Time</p>
                      <p className="text-xl font-bold">
                        {Math.round(routeStats.reduce((acc, curr) => acc + curr.duration, 0) / 60)}
                        <span className="ml-1 text-[10px] text-neutral-500">min</span>
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-3">
                  <AnimatePresence mode="popLayout">
                    {/* Start Point */}
                    <motion.div 
                      key="start-point"
                      layout
                      className="flex items-center gap-3 mb-2 p-2 bg-white/5 rounded-xl border border-white/10"
                    >
                      <div className="w-6 h-6 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                        1
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold truncate text-white">{startPoint?.address || 'Home'}</p>
                        <div className={cn(
                          "flex items-center gap-2 text-[10px]",
                          calculateETA(0).isOverdue ? "text-red-400 font-bold" : "text-neutral-400"
                        )}>
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-blue-400" />
                            <span>Dep: {calculateETA(0).departure}</span>
                          </div>
                        </div>
                      </div>
                    </motion.div>

                    {plannedRoute.filter(l => l && l?.id !== startPoint?.id && l?.id !== endPoint?.id).map((loc, index) => (
                      <motion.div key={loc.id} layout>
                        <motion.div 
                          className="flex items-center gap-3 group p-2 hover:bg-white/5 rounded-xl transition-all border border-transparent hover:border-white/10"
                        >
                          <div className="w-6 h-6 rounded-full bg-blue-500/20 border border-blue-500/50 flex items-center justify-center text-[10px] font-bold text-blue-400 shrink-0">
                            {index + 2}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate leading-tight text-white">{loc.address}</p>
                            <div className={cn(
                              "flex items-center gap-2 text-[10px] mt-0.5",
                              calculateETA(index + 1).isOverdue ? "text-red-400" : "text-neutral-400"
                            )}>
                              <div className="flex items-center gap-1 text-blue-400">
                                <Clock className="w-3 h-3" />
                                <span className="font-bold">Arr: {calculateETA(index + 1).arrival}</span>
                              </div>
                            </div>
                          </div>
                          <button 
                            onClick={() => removeFromRoute(loc.id)}
                            className="p-1.5 text-neutral-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </motion.div>
                      </motion.div>
                    ))}

                    {/* End Point */}
                    {plannedRoute.length > 0 && (
                      <motion.div 
                        key="end-point" 
                        layout 
                        className="flex items-center gap-3 mt-2 p-2 bg-white/5 rounded-xl border border-white/10"
                      >
                        <div className="w-6 h-6 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                          {plannedRoute.length + 2}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold truncate text-white">{endPoint?.address || 'End Point'}</p>
                          <div className={cn(
                            "flex items-center gap-2 text-[10px] mt-0.5",
                            calculateETA(plannedRoute.length + 1).isOverdue ? "text-red-400 font-bold" : "text-neutral-400"
                          )}>
                            <div className="flex items-center gap-1 text-blue-400">
                              <Clock className="w-3 h-3" />
                              <span>Arr: {calculateETA(plannedRoute.length + 1).arrival}</span>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {plannedRoute.length > 0 && (
                  <div className="flex gap-2 mt-4 shrink-0">
                    {!isNavigating ? (
                      <button 
                        onClick={fetchRoute}
                        className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20"
                      >
                        <Navigation className="w-4 h-4" />
                        Start Route
                      </button>
                    ) : (
                      <button 
                        onClick={completeRoute}
                        className="flex-1 py-3 bg-green-600 hover:bg-green-500 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-green-900/20"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Complete & Save
                      </button>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Background accent */}
          {!isRouteSummaryMinimized && (
            <div className="absolute -right-20 -bottom-20 w-64 h-64 bg-blue-600/10 blur-[100px] pointer-events-none" />
          )}
        </motion.div>
      </div>

      {/* Navigation Instructions Overlay */}
      <AnimatePresence>
        {isNavigating && (
          <motion.div 
            key="nav-instructions"
            initial={{ x: -400 }}
            animate={{ x: 0 }}
            exit={{ x: -400 }}
            className="absolute left-96 top-0 bottom-0 w-80 bg-white border-r border-neutral-200 z-20 shadow-2xl flex flex-col"
          >
            <div className="p-6 bg-blue-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Navigation className="w-5 h-5" />
                <h2 className="font-bold">Directions</h2>
              </div>
              <button 
                onClick={() => setIsNavigating(false)}
                className="p-1 hover:bg-white/20 rounded-lg transition-all"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
              {instructions.map((step, i) => (
                <div key={i} className="flex gap-3 pb-4 border-b border-neutral-100 last:border-0">
                  <div className="w-6 h-6 rounded-full bg-neutral-100 flex items-center justify-center text-[10px] font-bold text-neutral-500 shrink-0">
                    {i + 1}
                  </div>
                  <div>
                    <p className="text-sm text-neutral-800">{step.instruction}</p>
                    {step.distance > 0 && (
                      <p className="text-[10px] font-bold text-neutral-400 uppercase mt-1">
                        {(step.distance * 0.000621371).toFixed(2)} miles
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Map Area */}
      <div className="flex-1 relative">
        {activeTab === 'CALENDAR' ? (
          <CalendarView />
        ) : (
          <MapContainer 
          center={centerPosition} 
          zoom={12} 
          className="h-full w-full"
          zoomControl={false}
        >
          <OfflineTileLayer
            attribution={
              mapLayer === 'satellite' 
                ? 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EBP, and the GIS User Community'
                : mapLayer === 'terrain'
                ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
                : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }
            url={
              mapLayer === 'satellite'
                ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                : mapLayer === 'terrain'
                ? "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
                : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            }
            activeLayer={mapLayer}
          />

          {showTrafficLayer && (
            <TileLayer
              attribution="Google Maps Traffic"
              url="https://mt1.google.com/vt?lyrs=h@159000000,traffic|seconds_into_week:-1&style=3&x={x}&y={y}&z={z}"
              opacity={0.65}
              zIndex={100}
            />
          )}

          {showTrafficLayer && trafficIncidents.map((incident, idx) => (
            <Marker 
              key={`incident-${idx}`} 
              position={[incident.lat, incident.lng]}
              icon={L.divIcon({
                className: 'traffic-incident-icon',
                html: `<div class="bg-red-500 text-white p-1 rounded-full border-2 border-white shadow-lg animate-pulse">
                  <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12" y2="17.01"></line>
                  </svg>
                </div>`
              })}
            >
              <Popup className="incident-popup">
                <div className="p-2">
                  <p className="text-xs font-bold text-red-600 mb-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Major Incident
                  </p>
                  <p className="text-[10px] font-medium text-neutral-800 leading-tight">{incident.description}</p>
                </div>
              </Popup>
            </Marker>
          ))}
          
          <MapUpdater center={centerPosition} zoom={mapZoom} />
          
          <DrawingLayer 
            mode={drawingMode} 
            points={drawPoints} 
            setPoints={setDrawPoints} 
            circle={drawCircle} 
            setCircle={setDrawCircle} 
          />

          <Marker position={[HOME_LOCATION.lat, HOME_LOCATION.lng]} icon={homeIcon} />

          {showGasStations && gasStations.map((station) => (
            <Marker 
              key={station.id} 
              position={[station.lat, station.lng]}
              icon={L.divIcon({
                className: 'custom-div-icon',
                html: `<div class="w-8 h-8 bg-green-600 rounded-full border-2 border-white shadow-lg flex items-center justify-center text-white">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 22L15 22"/><path d="M4 9L15 9"/><path d="M14 22L14 9"/><path d="M7 22L7 9"/><path d="M11 22L11 9"/><path d="M15 13L20 13"/><path d="M18 5L18 22"/><path d="M18 5L21 8"/><path d="M15 9L18 5"/></svg>
                      </div>`,
                iconSize: [32, 32],
                iconAnchor: [16, 32],
              })}
            />
          ))}

          {/* Render markers for both available stores and the current planned route */}
          {Array.from(new Set([
            ...filteredLocations.filter(l => !!l).map(l => l.id), 
            ...plannedRoute.filter(l => !!l).map(l => l.id)
          ]))
            .map(id => locations.find(l => l.id === id))
            .filter((loc): loc is Location => !!loc)
            .map((loc) => {
              const fullRoute = [startPoint, ...plannedRoute.filter(l => l && l?.id !== startPoint?.id && l?.id !== endPoint?.id), endPoint].filter(Boolean);
              const routeIndex = fullRoute.findIndex(p => p?.id === loc.id);
              const isInRoute = routeIndex !== -1;
              const isSelected = selectedLocation?.id === loc.id;
              const isVisited = visitedStoreIds.has(loc.id);
              
              let color = loc.carrier === 'T-MOBILE' ? '#e20074' : '#6a0dad'; // Magenta for T-Mobile, Purple for Metro
              if (isVisited) color = '#10b981'; // Visited green (checked off)
              if (isInRoute) color = '#3b82f6'; // Planned blue
              if (isSelected) color = '#10b981'; // Selected green
              
              return (
                <Marker 
                  key={loc.id} 
                  position={[loc.lat, loc.lng]}
                  icon={createMarkerIcon(
                    color, 
                    isInRoute, 
                    isInRoute ? routeIndex + 1 : undefined,
                    isSelected
                  )}
                  eventHandlers={{
                    click: () => {
                      addToRoute(loc);
                    }
                  }}
                >
                  <LeafletTooltip direction="top" offset={[0, -30]} opacity={1} permanent={false}>
                    <div className="p-2 min-w-[150px]">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={cn(
                          "text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider",
                          loc.carrier === 'T-MOBILE' ? "bg-pink-100 text-pink-700" : "bg-purple-100 text-purple-700"
                        )}>
                          {loc.carrier}
                        </span>
                        <span className="text-[9px] font-bold text-neutral-400">ID: {loc.id}</span>
                      </div>
                      <h4 className="text-xs font-bold text-neutral-800 leading-tight mb-1">{loc.address}</h4>
                      <div className="flex items-center gap-1 text-[10px] text-neutral-500">
                        <MapPin className="w-3 h-3" />
                        <span>{loc.city}, {loc.state}</span>
                      </div>
                      {isInRoute && (
                        <div className="mt-2 pt-2 border-t border-neutral-100 flex items-center gap-1 text-[9px] font-bold text-blue-600 uppercase">
                          <Navigation className="w-3 h-3" />
                          <span>Stop #{routeIndex + 1}</span>
                        </div>
                      )}
                    </div>
                  </LeafletTooltip>
                </Marker>
              );
            })}

          {isNavigating && routeGeometry.length > 0 ? (
            <Polyline 
              positions={routeGeometry} 
              color="#3b82f6" 
              weight={6} 
              opacity={0.8}
            />
          ) : plannedRoute.length > 1 && (
            <Polyline 
              positions={routePositions} 
              color="#3b82f6" 
              weight={4} 
              opacity={0.6}
              dashArray="10, 10"
            />
          )}
        </MapContainer>
        )}

        {/* Floating Controls */}
        <div className="absolute top-6 right-6 flex flex-col gap-3 z-[1000]">
          <div className="relative">
            <button 
              onClick={() => setShowLayerMenu(!showLayerMenu)}
              className={cn(
                "p-4 rounded-2xl shadow-xl transition-all flex items-center justify-center border border-neutral-200",
                showLayerMenu ? "bg-blue-600 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"
              )}
              title="Map Layers"
            >
              <Layers className="w-6 h-6" />
            </button>
            
            <AnimatePresence>
              {showLayerMenu && (
                <motion.div 
                  initial={{ opacity: 0, x: -20, scale: 0.95 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: -20, scale: 0.95 }}
                  className="absolute top-0 right-full mr-3 w-40 bg-white rounded-2xl shadow-2xl border border-neutral-100 p-2 overflow-hidden"
                >
                  <button 
                    onClick={() => { setMapLayer('standard'); setShowLayerMenu(false); }}
                    className={cn(
                      "w-full px-4 py-2.5 rounded-xl text-xs font-bold text-left transition-all",
                      mapLayer === 'standard' ? "bg-blue-50 text-blue-600" : "text-neutral-600 hover:bg-neutral-50"
                    )}
                  >
                    Standard
                  </button>
                  <button 
                    onClick={() => { setMapLayer('satellite'); setShowLayerMenu(false); }}
                    className={cn(
                      "w-full px-4 py-2.5 rounded-xl text-xs font-bold text-left transition-all",
                      mapLayer === 'satellite' ? "bg-blue-50 text-blue-600" : "text-neutral-600 hover:bg-neutral-50"
                    )}
                  >
                    Satellite
                  </button>
                  <button 
                    onClick={() => { setMapLayer('terrain'); setShowLayerMenu(false); }}
                    className={cn(
                      "w-full px-4 py-2.5 rounded-xl text-xs font-bold text-left transition-all",
                      mapLayer === 'terrain' ? "bg-blue-50 text-blue-600" : "text-neutral-600 hover:bg-neutral-50"
                    )}
                  >
                    Terrain
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="bg-white p-2 rounded-2xl shadow-xl border border-neutral-200 flex flex-col gap-1">
            <button className="p-3 hover:bg-neutral-100 rounded-xl transition-all text-neutral-600">
              <Plus className="w-5 h-5" />
            </button>
            <div className="h-px bg-neutral-100 mx-2" />
            <button className="p-3 hover:bg-neutral-100 rounded-xl transition-all text-neutral-600">
              <CircleIcon className="w-5 h-5" />
            </button>
          </div>
          
          <button 
            onClick={() => {
              if (plannedRoute.length > 0) {
                setSelectedLocation(plannedRoute[0]);
              }
            }}
            className="bg-white p-4 rounded-2xl shadow-xl border border-neutral-200 hover:bg-neutral-50 transition-all text-blue-600"
          >
            <Navigation className="w-6 h-6" />
          </button>

          <div className="h-px bg-neutral-100 mx-2" />

          <div className="flex flex-col gap-2">
            <button 
              onClick={() => {
                if (drawingMode === 'polygon') {
                  setDrawingMode(null);
                  setDrawPoints([]);
                } else {
                  setDrawingMode('polygon');
                  setDrawCircle(null);
                }
              }}
              className={cn(
                "p-4 rounded-2xl shadow-xl transition-all flex items-center justify-center border border-neutral-200",
                drawingMode === 'polygon' ? "bg-blue-600 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"
              )}
              title="Draw Polygon Selection"
            >
              <SquareIcon className="w-6 h-6" />
            </button>
            
            <button 
              onClick={() => {
                if (drawingMode === 'circle') {
                  setDrawingMode(null);
                  setDrawCircle(null);
                } else {
                  setDrawingMode('circle');
                  setDrawPoints([]);
                }
              }}
              className={cn(
                "p-4 rounded-2xl shadow-xl transition-all flex items-center justify-center border border-neutral-200",
                drawingMode === 'circle' ? "bg-blue-600 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"
              )}
              title="Draw Circle Selection"
            >
              <CircleIcon className="w-6 h-6" />
            </button>

            {drawingMode && (
              <button 
                onClick={selectEnclosedStores}
                className="p-4 rounded-2xl shadow-xl bg-green-600 text-white transition-all flex items-center justify-center animate-bounce border border-green-500"
                title="Confirm Selection"
              >
                <Check className="w-6 h-6" />
              </button>
            )}
          </div>
        </div>

        {/* Review Modal */}
        <AnimatePresence>
          {showReviewModal && (
            <motion.div 
              key="review-modal-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            >
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl"
              >
                <div className="p-6 border-b border-neutral-100 flex justify-between items-center">
                  <h3 className="text-xl font-bold text-neutral-900">Review Route</h3>
                  <button onClick={() => setShowReviewModal(false)} className="p-2 hover:bg-neutral-100 rounded-full text-neutral-400">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="p-6 space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-neutral-50 rounded-2xl">
                      <p className="text-[10px] font-bold text-neutral-400 uppercase mb-1">Total Stops</p>
                      <p className="text-xl font-bold text-neutral-900">{plannedRoute.length + 2}</p>
                    </div>
                    <div className="p-4 bg-neutral-50 rounded-2xl">
                      <p className="text-[10px] font-bold text-neutral-400 uppercase mb-1">Est. Distance</p>
                      <p className="text-xl font-bold text-neutral-900">
                        {(routeStats.reduce((acc, curr) => acc + curr.distance, 0) * 0.000621371).toFixed(1)} mi
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-neutral-400 uppercase px-1">Assign to Date</label>
                    <input 
                      type="date" 
                      value={assignDate}
                      onChange={(e) => setAssignDate(e.target.value)}
                      min="2026-04-11"
                      max="2026-05-29"
                      className="w-full p-4 bg-neutral-50 rounded-2xl border-none focus:ring-2 focus:ring-blue-500 font-bold text-neutral-700"
                    />
                  </div>

                  <Reorder.Group 
                    axis="y" 
                    values={plannedRoute} 
                    onReorder={setPlannedRoute}
                    className="max-h-[300px] overflow-y-auto space-y-2 pr-2 custom-scrollbar p-1"
                  >
                    <div className="flex items-center gap-3 p-3 bg-blue-50/50 border border-blue-100 rounded-2xl mb-2">
                      <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-[10px] font-bold text-white shrink-0 shadow-lg shadow-blue-600/20">1</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate text-neutral-800">{startPoint?.address || 'Start Point'}</p>
                        <p className="text-[10px] text-blue-600 font-bold uppercase tracking-wider">Dep: {calculateETA(0).departure}</p>
                      </div>
                    </div>

                    {plannedRoute.map((loc, i) => (
                      <Reorder.Item 
                        key={loc.id} 
                        value={loc}
                        onDragEnd={async () => {
                          if (user) await savePlannedRoute(plannedRoute, startPoint, endPoint);
                          await fetchRoute(true);
                        }}
                      >
                        <div className="flex items-center gap-3 p-3 bg-white border border-neutral-100 rounded-2xl group hover:border-blue-300 hover:shadow-md transition-all">
                          <div className="cursor-grab active:cursor-grabbing text-neutral-300 hover:text-neutral-500 transition-colors">
                            <GripVertical className="w-5 h-5" />
                          </div>
                          <div className="w-6 h-6 rounded-full bg-neutral-100 flex items-center justify-center text-[10px] font-bold text-neutral-600 shrink-0 border border-neutral-200">
                            {i + 2}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-neutral-800 truncate">{loc.address}</p>
                            <div className={cn(
                              "flex items-center gap-2 text-[10px] mt-0.5",
                              calculateETA(i + 1).isOverdue ? "text-red-500" : "text-neutral-500"
                            )}>
                              <div className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                <span className="font-bold">Arr: {calculateETA(i + 1).arrival}</span>
                              </div>
                              <div className="w-1 h-1 rounded-full bg-neutral-300" />
                              <div className="flex items-center gap-1">
                                <span>Dep: {calculateETA(i + 1).departure}</span>
                              </div>
                              {calculateETA(i + 1).isOverdue && (
                                <div className="flex items-center gap-1 font-bold animate-pulse">
                                  <AlertCircle className="w-3 h-3" />
                                  <span>Overdue</span>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={async () => {
                                await moveInRoute(i, 'up');
                                await fetchRoute(true);
                              }}
                              disabled={i === 0}
                              className="p-1.5 text-neutral-400 hover:text-blue-500 disabled:opacity-30 transition-colors"
                            >
                              <ChevronUp className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={async () => {
                                await moveInRoute(i, 'down');
                                await fetchRoute(true);
                              }}
                              disabled={i === plannedRoute.length - 1}
                              className="p-1.5 text-neutral-400 hover:text-blue-500 disabled:opacity-30 transition-colors"
                            >
                              <ChevronDown className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </Reorder.Item>
                    ))}

                    <div className="flex items-center gap-3 p-3 bg-blue-50/50 border border-blue-100 rounded-2xl mt-2">
                      <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-[10px] font-bold text-white shrink-0 shadow-lg shadow-blue-600/20">
                        {plannedRoute.length + 2}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate text-neutral-800">{endPoint?.address || 'End Point'}</p>
                        <div className={cn(
                          "flex items-center gap-2 text-[10px] mt-0.5",
                          calculateETA(plannedRoute.length + 1).isOverdue ? "text-red-500" : "text-blue-600"
                        )}>
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span className="font-bold uppercase tracking-wider">Arrival: {calculateETA(plannedRoute.length + 1).arrival}</span>
                          </div>
                          {calculateETA(plannedRoute.length + 1).isOverdue && (
                            <div className="flex items-center gap-1 font-bold animate-pulse">
                              <AlertCircle className="w-3 h-3" />
                              <span>Overdue</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </Reorder.Group>
                </div>

                <div className="p-6 bg-neutral-50 flex gap-3">
                  <button 
                    onClick={() => setShowReviewModal(false)}
                    className="flex-1 py-4 bg-white border border-neutral-200 rounded-2xl font-bold text-neutral-600 hover:bg-neutral-100 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={confirmRoute}
                    className="flex-1 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold transition-all shadow-lg shadow-blue-600/20"
                  >
                    Confirm & Save
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Gemini Chatbot */}
        <div className="absolute bottom-6 right-6 z-[1001]">
          <AnimatePresence>
            {showChat && (
              <motion.div
                key="chat-window"
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="mb-4 w-96 h-[500px] bg-white rounded-3xl shadow-2xl border border-neutral-200 flex flex-col overflow-hidden"
              >
                <div className="p-4 bg-blue-600 text-white flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5" />
                    <h3 className="font-bold">RouteMaster AI</h3>
                  </div>
                  <button onClick={() => setShowChat(false)} className="p-1 hover:bg-white/20 rounded-lg">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                  {chatMessages.length === 0 && (
                    <div className="text-center py-10">
                      <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-3">
                        <MessageSquare className="w-6 h-6 text-blue-600" />
                      </div>
                      <p className="text-sm text-neutral-500">Ask me anything about your routes or store clusters!</p>
                    </div>
                  )}
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={cn(
                      "max-w-[80%] p-3 rounded-2xl text-sm",
                      msg.role === 'user' ? "ml-auto bg-blue-600 text-white" : "bg-neutral-100 text-neutral-800"
                    )}>
                      {msg.text}
                    </div>
                  ))}
                  {isChatLoading && (
                    <div className="bg-neutral-100 text-neutral-800 max-w-[80%] p-3 rounded-2xl text-sm animate-pulse">
                      Thinking...
                    </div>
                  )}
                </div>

                <div className="p-4 border-t border-neutral-100 flex gap-2">
                  <input 
                    type="text" 
                    placeholder="Type a message..."
                    className="flex-1 px-4 py-2 bg-neutral-100 border-none rounded-xl text-sm focus:ring-2 focus:ring-blue-500"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleChat()}
                  />
                  <button 
                    onClick={handleChat}
                    disabled={isChatLoading}
                    className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-500 disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          
          <button 
            onClick={() => setShowChat(!showChat)}
            className="p-4 bg-blue-600 text-white rounded-2xl shadow-xl hover:bg-blue-500 transition-all flex items-center gap-2"
          >
            <MessageSquare className="w-6 h-6" />
            <span className="font-bold">Chat with AI</span>
          </button>
        </div>

        {/* Login Overlay */}
        {!user && isAuthReady && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-[2000] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-md w-full bg-white rounded-3xl shadow-2xl border border-neutral-200 p-8 text-center"
            >
              <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-600/20">
                <Navigation className="w-10 h-10 text-white" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Welcome to RouteMaster</h2>
              <p className="text-neutral-500 mb-8">Sign in to securely plan, optimize, and track your store visits in the Washington market.</p>
              <button 
                onClick={signInWithGoogle}
                className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold transition-all flex items-center justify-center gap-3 shadow-lg shadow-blue-600/20"
              >
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5 bg-white rounded-full p-0.5" />
                Sign in with Google
              </button>
            </motion.div>
          </div>
        )}
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .leaflet-container {
          background: #f8fafc;
        }
        .leaflet-popup-content-wrapper {
          border-radius: 20px;
          padding: 8px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
        }
        .leaflet-popup-tip {
          display: none;
        }
      `}</style>
    </div>
  );
}
