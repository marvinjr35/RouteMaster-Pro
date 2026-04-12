import React, { useState, useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { motion, AnimatePresence } from 'motion/react';
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
  Circle, 
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
  Fuel
} from 'lucide-react';
import { locations, Location } from './data';
import { cn } from './lib/utils';
import { auth, signInWithGoogle, logout, db, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, setDoc, getDoc, onSnapshot, query, where, serverTimestamp, addDoc, deleteDoc, getDocs } from 'firebase/firestore';
import { geminiFlash, geminiProThinking } from './gemini';
import { LogOut, LogIn, MessageSquare, Send, Sparkles, X } from 'lucide-react';

// Fix Leaflet marker icons
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

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
      setVisitedStoreIds(ids);
    }, (err) => handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/plannedRoutes`));

    return () => unsubscribe();
  }, [user, isAuthReady]);

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

  const fetchTrafficData = async () => {
    try {
      const prompt = "What are the current traffic conditions and any major accidents or delays in the Washington DC and surrounding Maryland/Virginia areas right now? Provide a concise summary of major bottlenecks. Also, provide a single number representing the overall traffic delay multiplier (e.g., 1.0 for normal, 1.5 for heavy traffic). Format: Alerts: [list] Multiplier: [number]";
      const response = await geminiFlash(prompt, "You are a traffic reporter for the Washington DC area. Provide concise alerts and a numeric multiplier.");
      const text = response.text || "";
      const alertsMatch = text.match(/Alerts:([\s\S]*?)Multiplier:/i);
      const multiplierMatch = text.match(/Multiplier:\s*([\d.]+)/i);
      
      if (alertsMatch) {
        const alerts = alertsMatch[1].split('\n').filter(line => line.trim().length > 10).slice(0, 3);
        setTrafficAlerts(alerts);
      }
      if (multiplierMatch) {
        setTrafficMultiplier(parseFloat(multiplierMatch[1]) || 1.0);
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
  const [showOnlyClosest, setShowOnlyClosest] = useState(true);
  const [activeTab, setActiveTab] = useState<'PLANNER' | 'VISITED' | 'HISTORY' | 'ANALYTICS'>('PLANNER');
  const [visitedStoreIds, setVisitedStoreIds] = useState<Set<string>>(new Set());
  const [routeHistory, setRouteHistory] = useState<any[]>([]);
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
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [assignDate, setAssignDate] = useState(selectedDate);
  const [isRouteConfirmed, setIsRouteConfirmed] = useState(false);
  const [expandedCluster, setExpandedCluster] = useState<string | null>(null);

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
    const fullRoute = [startPoint, ...plannedRoute.filter(l => l?.id !== startPoint?.id && l?.id !== endPoint?.id), endPoint];
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

  const fetchRoute = async () => {
    if (plannedRoute.length < 1) return;
    
    const fullRoute = [startPoint, ...plannedRoute.filter(l => l?.id !== startPoint?.id && l?.id !== endPoint?.id), endPoint];
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

        setIsNavigating(true);
      }
    } catch (error) {
      console.error('Error fetching route:', error);
    }
  };

  const calculateETA = (index: number) => {
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    
    const visitDurationSec = visitDuration * 60;
    const fullRoute = [startPoint, ...plannedRoute.filter(l => l && l?.id !== startPoint?.id && l?.id !== endPoint?.id), endPoint].filter(Boolean);
    
    let totalSeconds = 0;
    
    // Calculate Arrival Time for stop 'index'
    for (let i = 0; i < index; i++) {
      const currentStop = fullRoute[i];
      if (!currentStop) continue;

      // If the stop we are leaving (i) is NOT home, we spend time there BEFORE leaving
      // This applies to the start point (i=0) if it's a store, 
      // and all subsequent middle stops (i > 0)
      if (currentStop.id !== 'HOME') {
        totalSeconds += visitDurationSec;
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
    const departureTime = new Date(arrivalTime.getTime() + (fullRoute[index]?.id !== 'HOME' ? visitDurationSec : 0));
    
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
    if (!plannedRoute.find(l => l?.id === location.id)) {
      const newRoute = [...plannedRoute, location];
      setPlannedRoute(newRoute);
      if (user) await savePlannedRoute(newRoute, startPoint, endPoint);
    }
  };

  const removeFromRoute = async (id: string) => {
    const newRoute = plannedRoute.filter(l => l?.id !== id);
    setPlannedRoute(newRoute);
    if (user) await savePlannedRoute(newRoute, startPoint, endPoint);
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

  const mapZoom = useMemo(() => {
    if (selectedLocation) return 15;
    return 12;
  }, [selectedLocation]);

  const exportToCSV = () => {
    const headers = ["Date", "Stops", "Total Miles", "Total Duration (min)"];
    const rows = routeHistory.map(r => [
      r.date,
      r.stops,
      r.miles.toFixed(2),
      Math.round(r.duration / 60)
    ]);
    
    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
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
        <div className="p-6 border-bottom border-neutral-100 shrink-0">
          <div className="flex items-center justify-between mb-6">
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
              <div className="flex bg-neutral-100 p-1 rounded-xl">
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
                >
                  <Filter className="w-4 h-4" />
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
                      <span className="text-[10px] text-neutral-600 group-hover:text-neutral-900 transition-colors">Traffic Alerts</span>
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
                  <Plus className="w-3 h-3 rotate-45" /> Export CSV
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
        </div>

        {/* Planned Route Summary */}
        <div className="p-6 bg-neutral-900 text-white shrink-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-400" />
              <h2 className="font-bold">Today's Route</h2>
              {isRouteConfirmed && (
                <span className="ml-2 px-2 py-0.5 bg-green-500/20 text-green-400 text-[10px] font-bold rounded uppercase tracking-wider flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  Confirmed
                </span>
              )}
            </div>
            <div className="flex gap-2">
              {plannedRoute.length > 0 && (
                <button 
                  onClick={async () => {
                    await fetchRoute();
                    setAssignDate(selectedDate);
                    setShowReviewModal(true);
                  }}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg transition-all text-xs font-bold flex items-center gap-1"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  Review & Confirm
                </button>
              )}
              {plannedRoute.length > 2 && (
                <button 
                  onClick={optimizeRoute}
                  disabled={isOptimizing}
                  className="p-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-all text-blue-400 disabled:opacity-50"
                  title="Optimize Route"
                >
                  <Filter className={cn("w-4 h-4", isOptimizing && "animate-spin")} />
                </button>
              )}
              <button 
                onClick={async () => {
                  if (confirm("Are you sure you want to clear the entire route for today?")) {
                    setPlannedRoute([]);
                    setStartPoint(HOME_LOCATION as Location);
                    setEndPoint(HOME_LOCATION as Location);
                    if (user) {
                      const q = query(
                        collection(db, `users/${user.uid}/plannedRoutes`),
                        where('date', '==', selectedDate)
                      );
                      const snapshot = await getDocs(q);
                      if (!snapshot.empty) {
                        await deleteDoc(doc(db, `users/${user.uid}/plannedRoutes`, snapshot.docs[0].id));
                      }
                    }
                  }
                }}
                className="p-1.5 bg-neutral-800 hover:bg-red-900/40 rounded-lg transition-all text-red-400"
                title="Clear Route"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <span className="bg-blue-600 px-2 py-0.5 rounded text-xs font-bold">
                {plannedRoute.length} STOPS
              </span>
            </div>
          </div>
          
          <div className="space-y-3 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
            <AnimatePresence mode="popLayout">
              {/* Start Point */}
              <motion.div 
                key="start-point"
                layout
                className="flex items-center gap-3 mb-2 p-2 bg-neutral-50 rounded-xl border border-neutral-100"
              >
                <div className="w-6 h-6 rounded-full bg-neutral-900 border border-neutral-700 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                  1
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">{startPoint?.address || 'Home'}</p>
                  <p className="text-[10px] text-neutral-500">{calculateETA(0).departure} Departure</p>
                </div>
                {startPoint?.id !== 'HOME' && (
                  <button onClick={() => setStartPoint(HOME_LOCATION as Location)} className="text-[10px] text-blue-600 font-bold hover:underline">Reset</button>
                )}
              </motion.div>

              {plannedRoute.filter(l => l && l?.id !== startPoint?.id && l?.id !== endPoint?.id).map((loc, index) => (
                <motion.div key={loc.id} layout>
                  {routeStats[index] && (
                    <div className="flex items-center gap-2 ml-3 py-1 border-l border-dashed border-neutral-700 pl-4">
                      <div className="flex flex-col text-[9px] text-neutral-500 font-bold uppercase tracking-tighter">
                        <span>{(routeStats[index].distance * 0.000621371).toFixed(1)} mi</span>
                        <span>{Math.round(routeStats[index].duration / 60)} min drive</span>
                      </div>
                    </div>
                  )}
                  <motion.div 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="flex items-center gap-3 group p-2 hover:bg-neutral-50 rounded-xl transition-all"
                  >
                    <div className="w-6 h-6 rounded-full bg-blue-500/20 border border-blue-500/50 flex items-center justify-center text-[10px] font-bold text-blue-400 shrink-0">
                      {index + 2}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{loc.address}</p>
                      <div className={cn(
                        "flex items-center gap-2 text-[10px]",
                        calculateETA(index + 1).isOverdue ? "text-red-400 font-bold" : "text-neutral-500"
                      )}>
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>Arr: {calculateETA(index + 1).arrival}</span>
                        </div>
                        <div className="w-1 h-1 rounded-full bg-neutral-300" />
                        <div className="flex items-center gap-1">
                          <span>Dep: {calculateETA(index + 1).departure}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                      <button 
                        onClick={() => moveInRoute(index, 'up')}
                        disabled={index === 0}
                        className="p-1 text-neutral-400 hover:text-blue-500 disabled:opacity-30"
                      >
                        <ChevronUp className="w-3 h-3" />
                      </button>
                      <button 
                        onClick={() => moveInRoute(index, 'down')}
                        disabled={index === plannedRoute.length - 1}
                        className="p-1 text-neutral-400 hover:text-blue-500 disabled:opacity-30"
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                      <button 
                        onClick={() => setStartPoint(loc)}
                        className="p-1 text-neutral-400 hover:text-green-500"
                        title="Set as Start"
                      >
                        <Navigation className="w-3 h-3" />
                      </button>
                      <button 
                        onClick={() => setEndPoint(loc)}
                        className="p-1 text-neutral-400 hover:text-red-500"
                        title="Set as End"
                      >
                        <MapPin className="w-3 h-3" />
                      </button>
                      <button 
                        onClick={() => removeFromRoute(loc.id)}
                        className="p-1 text-neutral-400 hover:text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              ))}

              {/* End Point */}
              {plannedRoute.length > 0 && (
                <motion.div key="end-point" layout>
                  {routeStats[plannedRoute.length] && (
                    <div className="flex items-center gap-2 ml-3 py-1 border-l border-dashed border-neutral-700 pl-4">
                      <div className="flex flex-col text-[9px] text-neutral-500 font-bold uppercase tracking-tighter">
                        <span>{(routeStats[plannedRoute.length].distance * 0.000621371).toFixed(1)} mi</span>
                        <span>{Math.round(routeStats[plannedRoute.length].duration / 60)} min drive</span>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-3 mt-2 p-2 bg-neutral-50 rounded-xl border border-neutral-100">
                    <div className="w-6 h-6 rounded-full bg-neutral-900 border border-neutral-700 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                      {plannedRoute.length + 2}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate">{endPoint?.address}</p>
                      <p className={cn(
                        "text-[10px]",
                        calculateETA(plannedRoute.length + 1).isOverdue ? "text-red-400 font-bold" : "text-neutral-500"
                      )}>
                        Arrival: {calculateETA(plannedRoute.length + 1).arrival}
                      </p>
                    </div>
                    {endPoint?.id !== 'HOME' && (
                      <button onClick={() => setEndPoint(HOME_LOCATION as Location)} className="text-[10px] text-blue-600 font-bold hover:underline">Reset</button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {plannedRoute.length === 0 && (
              <p className="text-xs text-neutral-500 italic py-4 text-center">No locations added to route yet.</p>
            )}
          </div>

          {plannedRoute.length > 0 && (
            <div className="flex gap-2 mt-6">
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
        </div>
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
        <MapContainer 
          center={centerPosition} 
          zoom={12} 
          className="h-full w-full"
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
          <MapUpdater center={centerPosition} zoom={mapZoom} />

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
              
              let color = '#ef4444'; // Default red
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
                />
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

        {/* Floating Controls */}
        <div className="absolute top-6 right-6 flex flex-col gap-2 z-[1000]">
          <div className="bg-white p-2 rounded-2xl shadow-xl border border-neutral-200 flex flex-col gap-1">
            <button className="p-3 hover:bg-neutral-100 rounded-xl transition-all text-neutral-600">
              <Plus className="w-5 h-5" />
            </button>
            <div className="h-px bg-neutral-100 mx-2" />
            <button className="p-3 hover:bg-neutral-100 rounded-xl transition-all text-neutral-600">
              <Circle className="w-5 h-5" />
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

                  <div className="max-h-48 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                    <div className="flex items-center gap-3 p-2 bg-blue-50 rounded-xl">
                      <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center text-[10px] font-bold text-white">1</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{startPoint?.address || 'Home'}</p>
                        <p className="text-[9px] text-blue-600 font-bold">Dep: {calculateETA(0).departure}</p>
                      </div>
                    </div>
                    {plannedRoute.filter(l => l?.id !== startPoint?.id && l?.id !== endPoint?.id).map((loc, i) => (
                      <div key={loc.id} className="flex items-center gap-3 p-2 bg-neutral-50 rounded-xl">
                        <div className="w-5 h-5 rounded-full bg-neutral-200 flex items-center justify-center text-[10px] font-bold text-neutral-600">{i + 2}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{loc.address}</p>
                          <p className="text-[9px] text-neutral-500">
                            Arr: {calculateETA(i + 1).arrival} • Dep: {calculateETA(i + 1).departure}
                          </p>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center gap-3 p-2 bg-blue-50 rounded-xl">
                      <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center text-[10px] font-bold text-white">{plannedRoute.length + 2}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{endPoint.address}</p>
                        <p className="text-[9px] text-blue-600 font-bold">Arr: {calculateETA(plannedRoute.length + 1).arrival}</p>
                      </div>
                    </div>
                  </div>
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
