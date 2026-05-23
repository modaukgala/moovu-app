type LatLngLiteral = google.maps.LatLngLiteral;

function svgUrl(svg: string) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function gpsMarkerIcon(): google.maps.Icon {
  return {
    url: svgUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r="18" fill="#1f74c9" opacity=".16"/>
        <circle cx="22" cy="22" r="9" fill="#1f74c9"/>
        <circle cx="22" cy="22" r="4" fill="#fff"/>
      </svg>
    `),
    scaledSize: new window.google.maps.Size(44, 44),
    anchor: new window.google.maps.Point(22, 22),
  };
}

export function carMarkerIcon(): google.maps.Icon {
  return {
    url: svgUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" width="54" height="54" viewBox="0 0 54 54">
        <filter id="s" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#0f172a" flood-opacity=".26"/>
        </filter>
        <circle cx="27" cy="27" r="23" fill="#ffffff" filter="url(#s)"/>
        <path d="M16 30.5 19.2 21c.55-1.65 1.9-2.5 3.65-2.5h8.3c1.75 0 3.1.85 3.65 2.5l3.2 9.5v6.2c0 .95-.78 1.8-1.75 1.8h-1.4c-.98 0-1.75-.85-1.75-1.8v-1H20.9v1c0 .95-.78 1.8-1.75 1.8h-1.4c-.98 0-1.75-.85-1.75-1.8v-6.2Z" fill="#1f74c9"/>
        <path d="M21.3 21.5h11.4l1.8 5.2h-15l1.8-5.2Z" fill="#dff3ff"/>
        <circle cx="20.9" cy="31.5" r="2.2" fill="#fff"/>
        <circle cx="33.1" cy="31.5" r="2.2" fill="#fff"/>
      </svg>
    `),
    scaledSize: new window.google.maps.Size(54, 54),
    anchor: new window.google.maps.Point(27, 27),
  };
}

export function stopMarkerIcon(label: "P" | "D" | "1" | "2"): google.maps.Icon {
  const fill = label === "P" ? "#2bb5a0" : label === "D" ? "#0f172a" : "#1f74c9";
  return {
    url: svgUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42">
        <circle cx="21" cy="21" r="18" fill="${fill}"/>
        <circle cx="21" cy="21" r="11" fill="#fff" opacity=".18"/>
        <text x="21" y="26" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" font-weight="900" fill="#fff">${label}</text>
      </svg>
    `),
    scaledSize: new window.google.maps.Size(42, 42),
    anchor: new window.google.maps.Point(21, 21),
  };
}

export function createOrMoveMarker(params: {
  map: google.maps.Map;
  marker: google.maps.Marker | null;
  position: LatLngLiteral;
  title: string;
  icon: google.maps.Icon;
}) {
  if (params.marker) {
    params.marker.setPosition(params.position);
    params.marker.setIcon(params.icon);
    params.marker.setTitle(params.title);
    params.marker.setMap(params.map);
    return params.marker;
  }

  return new google.maps.Marker({
    map: params.map,
    position: params.position,
    title: params.title,
    icon: params.icon,
  });
}

export function makeRouteRenderer(map: google.maps.Map) {
  const renderer = new google.maps.DirectionsRenderer({
    suppressMarkers: true,
    preserveViewport: true,
    polylineOptions: {
      strokeColor: "#1f74c9",
      strokeOpacity: 0.95,
      strokeWeight: 6,
    },
  });
  renderer.setMap(map);
  return renderer;
}

export function fitBoundsToPoints(map: google.maps.Map, points: LatLngLiteral[]) {
  if (points.length === 0) return;
  const bounds = new google.maps.LatLngBounds();
  points.forEach((point) => bounds.extend(point));
  map.fitBounds(bounds);
  window.setTimeout(() => {
    const zoom = map.getZoom();
    if (zoom && zoom > 16) map.setZoom(16);
  }, 250);
}
