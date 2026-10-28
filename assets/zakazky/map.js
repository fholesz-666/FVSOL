// Mapa stavby: ortofoto ČÚZK, obrysy budov z katastru, výběr budovy kliknutím. Leaflet je hostovaný na webu.
import { CONFIG } from "./config.js";

export class SiteMap {
  constructor(el, { onPick } = {}) {
    this.el = el;
    this.onPick = onPick;
    this.map = null;
    this.layer = null;
  }

  ensure() {
    if (this.map || !window.L) return !!this.map;
    const L = window.L;
    this.map = L.map(this.el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, tap: true });
    const orto = L.tileLayer(CONFIG.tiles.ortofoto, { maxZoom: 21, maxNativeZoom: 20, attribution: "© ČÚZK" });
    const zakl = L.tileLayer(CONFIG.tiles.zakladni, { maxZoom: 21, maxNativeZoom: 18, attribution: "© ČÚZK" });
    orto.addTo(this.map);
    L.control.layers({ "Ortofoto": orto, "Základní mapa": zakl }, {}, { position: "topright" }).addTo(this.map);
    this.map.setView([49.8, 15.5], 7);
    return true;
  }

  show(site) {
    if (!this.ensure()) return;
    const L = window.L;
    if (this.layer) this.layer.remove();
    this.layer = L.layerGroup().addTo(this.map);
    const selected = site?.building?.id;
    let selBounds = null;
    for (const b of site?.buildings || []) {
      const isSel = String(b.id) === String(selected);
      const poly = L.polygon(b.ring.map(([lon, lat]) => [lat, lon]), {
        color: isSel ? "#d63447" : "#ffffff",
        weight: isSel ? 3 : 1.5,
        fillColor: isSel ? "#d63447" : "#ffffff",
        fillOpacity: isSel ? 0.25 : 0.06,
      }).addTo(this.layer);
      poly.on("click", () => this.onPick?.(b.id));
      if (isSel) selBounds = poly.getBounds();
    }
    if (Number.isFinite(site?.lat)) L.circleMarker([site.lat, site.lon], { radius: 5, color: "#000", weight: 2, fillColor: "#fff", fillOpacity: 1 }).addTo(this.layer);
    if (selBounds) this.map.fitBounds(selBounds.pad(1.2), { maxZoom: 19 });
    else if (Number.isFinite(site?.lat)) this.map.setView([site.lat, site.lon], 18);
    setTimeout(() => this.map.invalidateSize(), 50);
  }
}
