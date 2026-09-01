/**
 * Chicago neighborhood reference for the Home Search sweep + location filter.
 * `name` drives the discovery query; `zips` tag/scope; `cluster` groups the
 * Wicker-Park-area neighborhoods (swept first). Broad city coverage so the tab can
 * search Chicago throughout — the sweep just prioritizes the WP cluster.
 */
export interface ChicagoArea {
  name: string;
  zips: string[];
  cluster?: string;
  priority: number; // 1 = swept first (Wicker Park area), 2 = rest of the city
  lat?: number;
  lng?: number;
}

export const CHICAGO_AREAS: ChicagoArea[] = [
  // ── Wicker Park cluster (priority 1) ──
  { name: "Wicker Park", zips: ["60622"], cluster: "wicker-park", priority: 1, lat: 41.9088, lng: -87.6796 },
  { name: "Bucktown", zips: ["60647"], cluster: "wicker-park", priority: 1, lat: 41.9209, lng: -87.6790 },
  { name: "Ukrainian Village", zips: ["60622"], cluster: "wicker-park", priority: 1, lat: 41.8990, lng: -87.6866 },
  { name: "East Village", zips: ["60622"], cluster: "wicker-park", priority: 1, lat: 41.9016, lng: -87.6690 },
  { name: "West Town", zips: ["60622"], cluster: "wicker-park", priority: 1, lat: 41.8963, lng: -87.6699 },
  { name: "Noble Square", zips: ["60622"], cluster: "wicker-park", priority: 1, lat: 41.9020, lng: -87.6620 },
  { name: "Logan Square", zips: ["60647"], cluster: "wicker-park", priority: 1, lat: 41.9270, lng: -87.7069 },
  { name: "Humboldt Park", zips: ["60622", "60647", "60651"], cluster: "wicker-park", priority: 1, lat: 41.9016, lng: -87.7010 },
  { name: "Avondale", zips: ["60618"], cluster: "wicker-park", priority: 1, lat: 41.9390, lng: -87.7110 },
  // ── Rest of Chicago (priority 2) ──
  { name: "Lincoln Park", zips: ["60614"], priority: 2 },
  { name: "Lakeview", zips: ["60657"], priority: 2 },
  { name: "Uptown", zips: ["60640"], priority: 2 },
  { name: "Andersonville", zips: ["60640"], priority: 2 },
  { name: "Edgewater", zips: ["60660"], priority: 2 },
  { name: "Rogers Park", zips: ["60626"], priority: 2 },
  { name: "West Loop", zips: ["60607"], priority: 2 },
  { name: "River North", zips: ["60654"], priority: 2 },
  { name: "Gold Coast", zips: ["60610"], priority: 2 },
  { name: "Old Town", zips: ["60610"], priority: 2 },
  { name: "South Loop", zips: ["60605"], priority: 2 },
  { name: "The Loop", zips: ["60601", "60602", "60603", "60604"], priority: 2 },
  { name: "Pilsen", zips: ["60608"], priority: 2 },
  { name: "Little Village", zips: ["60623"], priority: 2 },
  { name: "Bridgeport", zips: ["60608", "60609"], priority: 2 },
  { name: "Bronzeville", zips: ["60653"], priority: 2 },
  { name: "Hyde Park", zips: ["60615"], priority: 2 },
  { name: "Woodlawn", zips: ["60637"], priority: 2 },
  { name: "Irving Park", zips: ["60618", "60641"], priority: 2 },
  { name: "Albany Park", zips: ["60625"], priority: 2 },
  { name: "Lincoln Square", zips: ["60625"], priority: 2 },
  { name: "North Center", zips: ["60618"], priority: 2 },
  { name: "Roscoe Village", zips: ["60618"], priority: 2 },
  { name: "Portage Park", zips: ["60641"], priority: 2 },
  { name: "Jefferson Park", zips: ["60630"], priority: 2 },
  { name: "Beverly", zips: ["60643"], priority: 2 },
  { name: "Chatham", zips: ["60619"], priority: 2 },
  { name: "Austin", zips: ["60644"], priority: 2 },
  { name: "Belmont Cragin", zips: ["60639"], priority: 2 },
  { name: "Hermosa", zips: ["60639"], priority: 2 },
];

/** Names of the Wicker-Park-area neighborhoods (the default first sweep). */
export const WICKER_PARK_CLUSTER = CHICAGO_AREAS.filter((a) => a.cluster === "wicker-park").map((a) => a.name);

/** All neighborhood names, WP cluster first — the location-filter options. */
export const ALL_AREA_NAMES = [...CHICAGO_AREAS].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name)).map((a) => a.name);

export function areaByName(name: string): ChicagoArea | undefined {
  return CHICAGO_AREAS.find((a) => a.name.toLowerCase() === name.toLowerCase());
}
