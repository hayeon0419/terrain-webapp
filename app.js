/* 지형모델러 edu — 범위 선택 & 데이터 수집 도구
 * 지도: Leaflet + OpenStreetMap (키 불필요)
 * 지오코딩: OpenStreetMap Nominatim (키 불필요)
 * DEM: OpenTopography Global DEM API (API 키 필요)
 * 건물: VWorld WFS (API 키 필요)
 */

(function () {
  const DEFAULT_CENTER = [37.5665, 126.9780]; // 서울시청
  const DEFAULT_RADIUS = 300;

  const el = (id) => document.getElementById(id);

  const els = {
    addressInput: el('address-input'),
    searchBtn: el('search-btn'),
    searchResults: el('search-results'),
    circleFields: el('circle-fields'),
    rectFields: el('rect-fields'),
    radiusInput: el('radius-input'),
    bboxReadout: el('bbox-readout'),
    layerContour: el('layer-contour'),
    layerBuilding: el('layer-building'),
    intervalInput: el('interval-input'),
    demSelect: el('dem-select'),
    otKey: el('ot-key'),
    vwKey: el('vw-key'),
    vwLayer: el('vw-layer'),
    collectBtn: el('collect-btn'),
    configJson: el('config-json'),
    downloadConfigBtn: el('download-config-btn'),
    logArea: el('log-area'),
  };

  // ---------- map setup ----------
  const map = L.map('map', { zoomControl: true }).setView(DEFAULT_CENTER, 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  function handleIcon(extraClass) {
    return L.divIcon({
      className: '',
      html: `<div class="handle-icon ${extraClass || ''}"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
  }

  function destPoint(latlng, distanceM, bearingDeg) {
    const R = 6378137;
    const brng = (bearingDeg * Math.PI) / 180;
    const lat1 = (latlng.lat * Math.PI) / 180;
    const lng1 = (latlng.lng * Math.PI) / 180;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(distanceM / R) +
        Math.cos(lat1) * Math.sin(distanceM / R) * Math.cos(brng)
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(brng) * Math.sin(distanceM / R) * Math.cos(lat1),
        Math.cos(distanceM / R) - Math.sin(lat1) * Math.sin(lat2)
      );
    return L.latLng((lat2 * 180) / Math.PI, (lng2 * 180) / Math.PI);
  }

  function boundsFromCenterRadius(latlng, radiusM) {
    const n = destPoint(latlng, radiusM, 0);
    const s = destPoint(latlng, radiusM, 180);
    const e = destPoint(latlng, radiusM, 90);
    const w = destPoint(latlng, radiusM, 270);
    return L.latLngBounds([s.lat, w.lng], [n.lat, e.lng]);
  }

  // ---------- state ----------
  let mode = 'circle';

  // circle mode objects
  const circleLayer = L.circle(DEFAULT_CENTER, {
    radius: DEFAULT_RADIUS,
    color: '#f2994a',
    weight: 2,
    fillColor: '#f2994a',
    fillOpacity: 0.12,
  }).addTo(map);

  const centerHandle = L.marker(DEFAULT_CENTER, {
    icon: handleIcon('center'),
    draggable: true,
  }).addTo(map);

  const edgeHandle = L.marker(
    destPoint(L.latLng(DEFAULT_CENTER), DEFAULT_RADIUS, 90),
    { icon: handleIcon(''), draggable: true }
  ).addTo(map);

  centerHandle.on('drag', () => {
    const c = centerHandle.getLatLng();
    circleLayer.setLatLng(c);
    edgeHandle.setLatLng(destPoint(c, circleLayer.getRadius(), 90));
    updateConfigPreview();
  });

  edgeHandle.on('drag', () => {
    const c = centerHandle.getLatLng();
    const r = Math.round(c.distanceTo(edgeHandle.getLatLng()));
    circleLayer.setRadius(r);
    els.radiusInput.value = r;
    updateConfigPreview();
  });

  els.radiusInput.addEventListener('input', () => {
    const r = Number(els.radiusInput.value) || 0;
    circleLayer.setRadius(r);
    const c = centerHandle.getLatLng();
    edgeHandle.setLatLng(destPoint(c, r, 90));
    updateConfigPreview();
  });

  // rect mode objects
  let rectBounds = boundsFromCenterRadius(L.latLng(DEFAULT_CENTER), DEFAULT_RADIUS);
  const rectLayer = L.rectangle(rectBounds, {
    color: '#5ec9b8',
    weight: 2,
    fillColor: '#5ec9b8',
    fillOpacity: 0.1,
  });

  const corners = {
    nw: L.marker([0, 0], { icon: handleIcon(''), draggable: true }),
    ne: L.marker([0, 0], { icon: handleIcon(''), draggable: true }),
    sw: L.marker([0, 0], { icon: handleIcon(''), draggable: true }),
    se: L.marker([0, 0], { icon: handleIcon(''), draggable: true }),
  };

  function syncCornerMarkers() {
    corners.nw.setLatLng([rectBounds.getNorth(), rectBounds.getWest()]);
    corners.ne.setLatLng([rectBounds.getNorth(), rectBounds.getEast()]);
    corners.sw.setLatLng([rectBounds.getSouth(), rectBounds.getWest()]);
    corners.se.setLatLng([rectBounds.getSouth(), rectBounds.getEast()]);
    rectLayer.setBounds(rectBounds);
  }

  function onCornerDrag(key) {
    return () => {
      const p = corners[key].getLatLng();
      let north = rectBounds.getNorth();
      let south = rectBounds.getSouth();
      let west = rectBounds.getWest();
      let east = rectBounds.getEast();
      if (key === 'nw') { north = p.lat; west = p.lng; }
      if (key === 'ne') { north = p.lat; east = p.lng; }
      if (key === 'sw') { south = p.lat; west = p.lng; }
      if (key === 'se') { south = p.lat; east = p.lng; }
      rectBounds = L.latLngBounds([south, west], [north, east]);
      syncCornerMarkers();
      updateBboxReadout();
      updateConfigPreview();
    };
  }

  Object.keys(corners).forEach((key) => {
    corners[key].on('drag', onCornerDrag(key));
  });

  function updateBboxReadout() {
    els.bboxReadout.textContent =
      `west: ${rectBounds.getWest().toFixed(5)}\n` +
      `south: ${rectBounds.getSouth().toFixed(5)}\n` +
      `east: ${rectBounds.getEast().toFixed(5)}\n` +
      `north: ${rectBounds.getNorth().toFixed(5)}`;
  }

  // ---------- mode toggle ----------
  document.querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.toggle-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      mode = btn.dataset.mode;
      setMode(mode);
    });
  });

  function setMode(next) {
    if (next === 'circle') {
      els.circleFields.classList.remove('hidden');
      els.rectFields.classList.add('hidden');
      map.removeLayer(rectLayer);
      Object.values(corners).forEach((m) => map.removeLayer(m));
      circleLayer.addTo(map);
      centerHandle.addTo(map);
      edgeHandle.addTo(map);
    } else {
      els.circleFields.classList.add('hidden');
      els.rectFields.classList.remove('hidden');
      rectBounds = boundsFromCenterRadius(centerHandle.getLatLng(), circleLayer.getRadius());
      map.removeLayer(circleLayer);
      map.removeLayer(centerHandle);
      map.removeLayer(edgeHandle);
      syncCornerMarkers();
      rectLayer.addTo(map);
      Object.values(corners).forEach((m) => m.addTo(map));
      updateBboxReadout();
    }
    updateConfigPreview();
  }

  // ---------- geocoding (Nominatim) ----------
  els.searchBtn.addEventListener('click', runSearch);
  els.addressInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runSearch();
  });

  async function runSearch() {
    const q = els.addressInput.value.trim();
    if (!q) return;
    els.searchResults.innerHTML = '<li>검색 중…</li>';
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=kr&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      if (!data.length) {
        els.searchResults.innerHTML = '<li>검색 결과가 없습니다.</li>';
        return;
      }
      els.searchResults.innerHTML = '';
      data.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item.display_name;
        li.addEventListener('click', () => {
          const latlng = L.latLng(parseFloat(item.lat), parseFloat(item.lon));
          map.setView(latlng, 16);
          if (mode === 'circle') {
            centerHandle.setLatLng(latlng);
            circleLayer.setLatLng(latlng);
            edgeHandle.setLatLng(destPoint(latlng, circleLayer.getRadius(), 90));
          } else {
            const r = Number(els.radiusInput.value) || DEFAULT_RADIUS;
            rectBounds = boundsFromCenterRadius(latlng, r);
            syncCornerMarkers();
            updateBboxReadout();
          }
          els.searchResults.innerHTML = '';
          els.addressInput.value = item.display_name;
          updateConfigPreview();
        });
        els.searchResults.appendChild(li);
      });
    } catch (err) {
      els.searchResults.innerHTML = '<li>검색 중 오류가 발생했습니다.</li>';
    }
  }

  // ---------- config preview ----------
  function currentBBox() {
    const b = mode === 'circle' ? boundsFromCenterRadius(centerHandle.getLatLng(), circleLayer.getRadius()) : rectBounds;
    return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
  }

  function buildConfig() {
    const layers = [];
    if (els.layerContour.checked) layers.push('contour');
    if (els.layerBuilding.checked) layers.push('building');
    const formats = Array.from(document.querySelectorAll('input[name="fmt"]:checked')).map((i) => i.value);

    const area =
      mode === 'circle'
        ? {
            type: 'circle',
            center: [round(centerHandle.getLatLng().lat, 6), round(centerHandle.getLatLng().lng, 6)],
            radius_m: Number(els.radiusInput.value) || 0,
          }
        : {
            type: 'rect',
            bbox: [
              round(rectBounds.getWest(), 6),
              round(rectBounds.getSouth(), 6),
              round(rectBounds.getEast(), 6),
              round(rectBounds.getNorth(), 6),
            ],
          };

    return {
      area,
      layers,
      contourInterval: Number(els.intervalInput.value) || 1,
      formats,
    };
  }

  function round(n, d) {
    const f = Math.pow(10, d);
    return Math.round(n * f) / f;
  }

  function updateConfigPreview() {
    els.configJson.textContent = JSON.stringify(buildConfig(), null, 2);
  }

  [els.layerContour, els.layerBuilding, els.intervalInput].forEach((n) =>
    n.addEventListener('change', updateConfigPreview)
  );
  document.querySelectorAll('input[name="fmt"]').forEach((n) => n.addEventListener('change', updateConfigPreview));

  // ---------- logging ----------
  function log(msg, type) {
    const line = document.createElement('div');
    const time = new Date().toISOString().substr(11, 8);
    line.textContent = `[${time}] ${msg}`;
    if (type) line.classList.add(`log-${type}`);
    els.logArea.appendChild(line);
    els.logArea.scrollTop = els.logArea.scrollHeight;
  }

  function clearLog() {
    els.logArea.innerHTML = '';
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- config download ----------
  els.downloadConfigBtn.addEventListener('click', () => {
    downloadBlob(new Blob([JSON.stringify(buildConfig(), null, 2)], { type: 'application/json' }), 'config.json');
  });

  // ---------- data collection ----------
  els.collectBtn.addEventListener('click', collectData);

  async function collectData() {
    clearLog();
    els.collectBtn.disabled = true;
    els.collectBtn.textContent = '수집 중…';

    const config = buildConfig();
    const bbox = currentBBox();
    log('선택 범위 확인 완료.');
    log(`bbox → west:${bbox.west.toFixed(5)} south:${bbox.south.toFixed(5)} east:${bbox.east.toFixed(5)} north:${bbox.north.toFixed(5)}`);

    if (config.layers.includes('contour')) {
      await fetchDem(bbox);
    } else {
      log('등고선 레이어가 선택되지 않아 DEM 조회를 건너뜁니다.', 'warn');
    }

    if (config.layers.includes('building')) {
      await fetchBuildings(bbox);
    } else {
      log('건물 레이어가 선택되지 않아 건물 조회를 건너뜁니다.', 'warn');
    }

    log('데이터 수집 단계 완료. 다음 단계(지오프로세싱)는 Python 백엔드에서 이어집니다.', 'ok');
    els.collectBtn.disabled = false;
    els.collectBtn.textContent = '데이터 수집 시작';
  }

  async function fetchDem(bbox) {
    const key = els.otKey.value.trim();
    const demtype = els.demSelect.value;
    if (!key) {
      log('OpenTopography API 키가 없어 DEM 조회를 건너뜁니다. 무료 키 발급: https://portal.opentopography.org/', 'warn');
      return;
    }
    log(`OpenTopography(${demtype}) DEM 조회 중…`);
    try {
      const url =
        `https://portal.opentopography.org/API/globaldem?demtype=${demtype}` +
        `&south=${bbox.south}&north=${bbox.north}&west=${bbox.west}&east=${bbox.east}` +
        `&outputFormat=GTiff&API_Key=${encodeURIComponent(key)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        log(`DEM 조회 실패 (HTTP ${res.status}). ${text.slice(0, 200)}`, 'err');
        return;
      }
      const blob = await res.blob();
      log(`DEM 조회 성공 — GeoTIFF ${(blob.size / 1024).toFixed(1)} KB`, 'ok');
      const btn = document.createElement('button');
      btn.className = 'btn btn-outline btn-sm';
      btn.style.marginTop = '4px';
      btn.textContent = 'dem.tif 다운로드';
      btn.addEventListener('click', () => downloadBlob(blob, `dem_${demtype}.tif`));
      els.logArea.appendChild(btn);
    } catch (err) {
      log(`DEM 조회 중 네트워크 오류: ${err.message}`, 'err');
    }
  }

  async function fetchBuildings(bbox) {
    const key = els.vwKey.value.trim();
    const typename = els.vwLayer.value.trim() || 'lt_c_spbd';
    if (!key) {
      log('VWorld API 키가 없어 건물 조회를 건너뜁니다. 무료 키 발급: https://www.vworld.kr/', 'warn');
      return;
    }
    log(`VWorld WFS(${typename}) 건물 조회 중…`);
    try {
      // WFS 2.0.0 + EPSG:4326 uses lat,lon axis order (south,west,north,east), not lon,lat.
      const bboxParam = `${bbox.south},${bbox.west},${bbox.north},${bbox.east},EPSG:4326`;
      const url =
        `https://api.vworld.kr/req/wfs?service=WFS&version=2.0.0&request=GetFeature` +
        `&typename=${encodeURIComponent(typename)}&bbox=${encodeURIComponent(bboxParam)}` +
        `&srsName=EPSG:4326&output=application/json&key=${encodeURIComponent(key)}` +
        `&domain=${encodeURIComponent(location.hostname || 'localhost')}`;
      const res = await fetch(url);
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        log('VWorld 응답이 JSON이 아닙니다 (도메인 미등록 또는 레이어명 오류 가능성). 응답 일부: ' + text.slice(0, 200), 'err');
        return;
      }
      const count = data.features ? data.features.length : 0;
      log(`건물 조회 성공 — ${count}개 피처`, 'ok');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const btn = document.createElement('button');
      btn.className = 'btn btn-outline btn-sm';
      btn.style.marginTop = '4px';
      btn.textContent = 'buildings.geojson 다운로드';
      btn.addEventListener('click', () => downloadBlob(blob, 'buildings.geojson'));
      els.logArea.appendChild(btn);
    } catch (err) {
      log(`건물 조회 중 오류: ${err.message} (브라우저 직접 호출 시 CORS로 차단될 수 있습니다. 실서비스에서는 백엔드 프록시가 필요합니다.)`, 'err');
    }
  }

  // ---------- init ----------
  setMode('circle');
  updateBboxReadout();
  updateConfigPreview();
})();
