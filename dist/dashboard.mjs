// Live dashboard for the Wokwi simulations: status of all four systems, parking rates learned
// from Wokwi, buttons that send commands back to Wokwi, and an event history with CSV export.

export const SYSTEMS = {
  junction: 'Junction warning',
  priority: 'Ambulance priority',
  counter: 'Vehicle counter',
  parking: 'Smart parking',
};
export const ONLINE_MS = 30000;   // The sketches send a heartbeat every 10 s.
export const HISTORY_LIMIT = 1000;
const PRIOR_MINUTES = 5;          // How much the default rates count before Wokwi data arrives.
const VEHICLES = {bike: 'Two-wheeler', car: 'Car', heavy: 'Heavy vehicle'};

// Each car the Wokwi bay sensor sees arrive (free → occupied) or leave (occupied → free) counts
// as one garage arrival or departure. Rates are per minute, blended with the default rates so a
// few events don't swing the forecast wildly. Returns null until a car has arrived or left.
// Only the last hour counts, so old sessions saved in the browser don't flatten the rates.
export function learnRates(history, prior, now = Date.now()) {
  const states = history.filter(e => e.sim === 'parking' && e.state !== 'error' && e.state !== 'ack' && e.state !== 'online' && now - e.t < 3600000);
  if (!states.length) return null;
  let arrivals = 0, departures = 0, occupied = null;
  for (const e of states) {
    const taken = e.state !== 'available';
    if (occupied !== null && taken !== occupied) taken ? arrivals++ : departures++;
    occupied = taken;
  }
  if (!arrivals && !departures) return null;
  const minutes = Math.max(1, (now - states[0].t) / 60000);
  const blend = (count, base) => Math.min(3, (count + base * PRIOR_MINUTES) / (minutes + PRIOR_MINUTES));
  return {arrive: blend(arrivals, prior.arrive), depart: blend(departures, prior.depart), arrivals, departures, minutes};
}

// Vehicles counted per minute over the last `minutes` minutes, oldest first.
export function perMinute(history, now = Date.now(), minutes = 30) {
  const buckets = Array.from({length: minutes}, () => ({bike: 0, car: 0, heavy: 0}));
  for (const e of history) {
    if (e.sim !== 'counter' || e.state !== 'detected') continue;
    const age = Math.floor((now - e.t) / 60000);
    if (age >= 0 && age < minutes) buckets[minutes - 1 - age][e.vehicle]++;
  }
  return buckets;
}

export function describe(e) {
  if (e.state === 'online') return 'Connected';
  if (e.state === 'ack') return e.cmd === 'priority' ? 'Priority request received' : 'Lights flashed on request';
  if (e.sim === 'junction') return {clear: 'Clear', pending: 'Movement · direction not confirmed', warning: 'Car approaching · warning on', fault: 'Sensor fault · all red'}[e.state];
  if (e.sim === 'priority') return e.state === 'active' ? 'Emergency vehicle · priority green' : 'Priority ended';
  if (e.sim === 'counter') return VEHICLES[e.vehicle] + ' detected';
  return {available: 'Bay free', predicted: 'Bay occupied · free by arrival', occupied: 'Bay occupied', error: 'Sensor error'}[e.state];
}

const csvCell = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
export function toCSV(history) {
  const rows = [['time', 'system', 'event', 'details', 'vehicle', 'bikes', 'cars', 'heavy', 'total', 'distance_cm', 'eta_min', 'sensor_a_cm', 'sensor_b_cm']];
  for (const e of history) {
    rows.push([new Date(e.t).toISOString(), SYSTEMS[e.sim], e.state, describe(e), e.vehicle ?? '', e.bikes ?? '', e.cars ?? '', e.heavy ?? '', e.total ?? '', e.distance ?? '', e.eta ?? '', e.a ?? '', e.b ?? '']);
  }
  return rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n';
}

const ago = ms => ms < 5000 ? 'just now' : ms < 60000 ? Math.round(ms / 1000) + ' s ago' : ms < 3600000 ? Math.round(ms / 60000) + ' min ago' : 'over 1 h ago';
const el = (tag, cls, text) => {const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n};

// panel: the dashboard element · send(sim, cmd): publish a command · prior: default parking rates.
export function createDashboard({panel, send, prior, storageKey = 'transitsense-history'}) {
  let history = [];
  try {history = JSON.parse(localStorage.getItem(storageKey) || '[]').filter(e => e && SYSTEMS[e.sim] && Number.isFinite(e.t))} catch {}
  const lastSeen = {}, latest = {};
  for (const e of history) {lastSeen[e.sim] = e.t; latest[e.sim] = e}
  const save = () => {try {localStorage.setItem(storageKey, JSON.stringify(history))} catch {}};

  panel.innerHTML = '';
  const head = el('div', 'dash-head');
  head.append(el('div', 'eyebrow', 'LIVE FROM WOKWI'), el('h2', '', 'System dashboard'));
  const close = el('button', 'icon-btn close', '×'); close.setAttribute('aria-label', 'Close dashboard');
  close.addEventListener('click', () => toggle(false));
  head.append(close);
  const grid = el('div', 'dash-grid');
  const cards = {};
  for (const [sim, name] of Object.entries(SYSTEMS)) {
    const card = el('section', 'dash-card'), top = el('div', 'dash-card-top');
    const dot = el('i'), title = el('strong', '', name), seen = el('span', 'dash-seen');
    top.append(dot, title, seen);
    const last = el('p', 'dash-last'), extra = el('div', 'dash-extra'), actions = el('div', 'dash-actions');
    const command = (label, cmd) => {
      const b = el('button', '', label);
      b.addEventListener('click', () => {
        if (!send(sim, cmd)) {b.textContent = 'Not connected to Wokwi'; return setTimeout(() => b.textContent = label, 3000)}
        b.textContent = 'Sent · waiting for Wokwi…';
        clearTimeout(b.timer);
        b.timer = setTimeout(() => {b.textContent = 'No reply from Wokwi'; b.timer = setTimeout(() => b.textContent = label, 4000)}, 8000);
      });
      b.dataset.label = label;
      actions.append(b);
    };
    command('Flash lights in Wokwi', 'identify');
    if (sim === 'priority') command('Send ambulance from here', 'priority');
    card.append(top, last, extra, actions);
    grid.append(card);
    cards[sim] = {card, dot, seen, last, extra, actions};
  }
  const chartBox = el('section', 'dash-history');
  const chartHead = el('div', 'dash-history-head');
  const download = el('button', '', 'Download CSV'), clear = el('button', '', 'Clear');
  chartHead.append(el('strong', '', 'Vehicles counted per minute · last 30 min'), download, clear);
  const chart = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chart.setAttribute('viewBox', '0 0 300 96'); chart.setAttribute('class', 'dash-chart'); chart.setAttribute('role', 'img');
  const legend = el('div', 'dash-legend');
  for (const [k, name] of Object.entries(VEHICLES)) {const s = el('span', 'key-' + k); s.append(el('i'), document.createTextNode(name)); legend.append(s)}
  const log = el('ol', 'dash-log');
  chartBox.append(chartHead, chart, legend, el('strong', 'dash-log-title', 'Recent events'), log);
  panel.append(head, grid, chartBox);

  download.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([toCSV(history)], {type: 'text/csv'}));
    const a = el('a'); a.href = url; a.download = 'transitsense-wokwi-events.csv'; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  clear.addEventListener('click', () => {history = []; save(); render()});

  function renderChart(now) {
    const data = perMinute(history, now), max = Math.max(3, ...data.map(d => d.bike + d.car + d.heavy));
    const w = 300 / data.length, svgNS = 'http://www.w3.org/2000/svg';
    chart.innerHTML = '';
    for (const y of [0, .5, 1]) {
      const line = document.createElementNS(svgNS, 'path'); line.setAttribute('d', `M0 ${80 - y * 76}H300`); line.setAttribute('class', 'grid'); chart.append(line);
    }
    data.forEach((d, i) => {
      let base = 80;
      for (const k of ['bike', 'car', 'heavy']) {
        if (!d[k]) continue;
        const h = d[k] / max * 76, r = document.createElementNS(svgNS, 'rect');
        r.setAttribute('x', i * w + 1); r.setAttribute('width', w - 2); r.setAttribute('y', base - h); r.setAttribute('height', h); r.setAttribute('class', 'bar-' + k);
        const tip = document.createElementNS(svgNS, 'title'); tip.textContent = `${data.length - 1 - i} min ago: ${d[k]} ${VEHICLES[k].toLowerCase()}${d[k] > 1 ? 's' : ''}`; r.append(tip);
        chart.append(r); base -= h;
      }
    });
    for (const [x, text, anchor] of [[0, '30 min ago', 'start'], [300, 'now', 'end']]) {
      const t = document.createElementNS(svgNS, 'text'); t.setAttribute('x', x); t.setAttribute('y', 94); t.setAttribute('text-anchor', anchor); t.textContent = text; chart.append(t);
    }
    const peak = document.createElementNS(svgNS, 'text'); peak.setAttribute('x', 0); peak.setAttribute('y', 9); peak.textContent = max + ' / min'; chart.append(peak);
    const total = data.reduce((s, d) => s + d.bike + d.car + d.heavy, 0);
    chart.setAttribute('aria-label', total + ' vehicles counted in the last 30 minutes');
  }

  function render() {
    const now = Date.now();
    for (const [sim, c] of Object.entries(cards)) {
      const online = lastSeen[sim] && now - lastSeen[sim] < ONLINE_MS, e = latest[sim];
      c.card.classList.toggle('online', !!online);
      c.seen.textContent = online ? 'Online' : lastSeen[sim] ? 'Offline · seen ' + ago(now - lastSeen[sim]) : 'Not connected yet';
      c.last.textContent = e && e.state !== 'online' ? describe(e) + ' · ' + ago(now - e.t) : 'No events yet';
      c.extra.textContent = '';
      if (sim === 'junction' && e && Number.isFinite(e.a)) c.extra.textContent = `Last reading · Sensor A ${e.a} cm · Sensor B ${e.b} cm`;
      if (sim === 'priority') {
        const runs = history.filter(x => x.sim === 'priority' && x.state === 'active').length;
        c.extra.textContent = runs + ' emergency vehicle' + (runs === 1 ? '' : 's') + ' so far';
      }
      if (sim === 'counter') {
        const n = {bike: 0, car: 0, heavy: 0};
        for (const x of history) if (x.sim === 'counter' && x.state === 'detected') n[x.vehicle]++;
        c.extra.textContent = `Two-wheelers ${n.bike} · Cars ${n.car} · Heavy ${n.heavy} · Total ${n.bike + n.car + n.heavy}`;
      }
      if (sim === 'parking') {
        const r = learnRates(history, prior, now);
        c.extra.textContent = r
          ? `Learned: ${r.arrive.toFixed(2)} arrivals and ${r.depart.toFixed(2)} departures per min (${r.arrivals} in, ${r.departures} out over ${Math.round(r.minutes)} min)`
          : `Default rates: ${prior.arrive} arrivals and ${prior.depart} departures per min until Wokwi sees a car arrive or leave`;
      }
    }
    renderChart(now);
    log.innerHTML = '';
    for (const e of history.filter(e => e.state !== 'online').slice(-8).reverse()) {
      const li = el('li'); li.append(el('time', '', new Date(e.t).toLocaleTimeString()), el('b', '', SYSTEMS[e.sim]), document.createTextNode(describe(e))); log.append(li);
    }
    if (!log.children.length) log.append(el('li', 'empty', 'Events from Wokwi appear here.'));
  }

  function toggle(open = panel.hidden) {
    panel.hidden = !open;
    document.dispatchEvent(new CustomEvent('dashboard-toggle', {detail: open}));
    if (open) render();
  }
  setInterval(() => {if (!panel.hidden) render()}, 5000);

  return {
    // Records an event and returns true when the simulation has just come online.
    record(e) {
      const t = Date.now(), wasOnline = lastSeen[e.sim] && t - lastSeen[e.sim] < ONLINE_MS;
      lastSeen[e.sim] = t;
      if (e.state !== 'online') {
        const entry = {...e, t};
        if (e.state !== 'ack') latest[e.sim] = entry;
        history.push(entry);
        if (history.length > HISTORY_LIMIT) history = history.slice(-HISTORY_LIMIT);
        save();
        if (e.state === 'ack') for (const b of cards[e.sim].actions.querySelectorAll('button')) {clearTimeout(b.timer); b.textContent = b.dataset.label}
      } else if (!latest[e.sim]) latest[e.sim] = {...e, t};
      if (!panel.hidden) render();
      return !wasOnline;
    },
    rates: () => learnRates(history, prior),
    toggle,
  };
}
