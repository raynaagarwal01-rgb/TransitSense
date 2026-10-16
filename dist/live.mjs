// Live events from the Wokwi simulations in wokwi/.
// Each simulated ESP32 publishes small JSON messages over MQTT to a public broker; the site
// subscribes over MQTT-on-WebSockets. This is a minimal MQTT 3.1.1 client (QoS 0 only),
// so the site stays a single file with no dependencies.

export const DEFAULT_BROKER = 'wss://broker.hivemq.com:8884/mqtt';
export const DEFAULT_TOPIC = 'transitsense/live';
export const SIMS = ['junction', 'priority', 'counter', 'parking'];

const encoder = new TextEncoder(), decoder = new TextDecoder();
const str = s => {const b = encoder.encode(s); return [b.length >> 8, b.length & 255, ...b]};
function packet(type, body) {
  const length = [];
  let n = body.length;
  do {let digit = n % 128; n = Math.floor(n / 128); if (n > 0) digit |= 128; length.push(digit)} while (n > 0);
  return new Uint8Array([type, ...length, ...body]);
}
export const connectPacket = (clientId, keepAlive = 60) => packet(0x10, [...str('MQTT'), 4, 2, keepAlive >> 8, keepAlive & 255, ...str(clientId)]);
export const subscribePacket = (topic, id = 1) => packet(0x82, [id >> 8, id & 255, ...str(topic), 0]);
export const publishPacket = (topic, payload) => packet(0x30, [...str(topic), ...encoder.encode(payload)]);
const PING = new Uint8Array([0xc0, 0]);

// Splits a byte stream into MQTT packets. Returns {packets, rest}.
export function readPackets(bytes) {
  const packets = [];
  let i = 0;
  while (i + 2 <= bytes.length) {
    let length = 0, multiplier = 1, j = i + 1, complete = false;
    while (j < bytes.length && j < i + 5) {
      const digit = bytes[j++];
      length += (digit & 127) * multiplier;
      multiplier *= 128;
      if (!(digit & 128)) {complete = true; break}
    }
    if (!complete || j + length > bytes.length) break;
    packets.push({type: bytes[i] >> 4, flags: bytes[i] & 15, body: bytes.subarray(j, j + length)});
    i = j + length;
  }
  return {packets, rest: bytes.slice(i)};
}

export function readPublish({flags, body}) {
  const topicLength = (body[0] << 8) | body[1];
  const topic = decoder.decode(body.subarray(2, 2 + topicLength));
  const offset = 2 + topicLength + ((flags >> 1) & 3 ? 2 : 0);
  return {topic, payload: decoder.decode(body.subarray(offset)), retained: !!(flags & 1)};
}

// Turns a raw message into a checked event, or null. Anyone can publish to a public broker,
// so only known simulations and fields get through.
export function parseEvent(prefix, topic, payload) {
  if (!topic.startsWith(prefix + '/')) return null;
  const sim = topic.slice(prefix.length + 1);
  if (!SIMS.includes(sim) || payload.length > 512) return null;
  let data;
  try {data = JSON.parse(payload)} catch {return null}
  if (!data || typeof data !== 'object' || typeof data.state !== 'string') return null;
  const number = (v, max) => Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : null;
  const allowed = {
    junction: ['online', 'clear', 'pending', 'warning', 'fault'],
    priority: ['online', 'active', 'ended'],
    counter: ['online', 'detected'],
    parking: ['online', 'available', 'predicted', 'occupied', 'error'],
  }[sim];
  if (!allowed.includes(data.state)) return null;
  const event = {sim, state: data.state};
  if (sim === 'counter' && data.state === 'detected') {
    if (!['bike', 'car', 'heavy'].includes(data.vehicle)) return null;
    Object.assign(event, {vehicle: data.vehicle, bikes: number(data.bikes, 1e6), cars: number(data.cars, 1e6), heavy: number(data.heavy, 1e6), total: number(data.total, 1e6)});
  }
  if (sim === 'parking') Object.assign(event, {eta: number(data.eta, 60), distance: number(data.distance, 1000)});
  return event;
}

// Connects, subscribes to prefix/#, and reconnects with backoff. onStatus gets
// 'connecting' | 'live' | 'offline'; onEvent gets events from parseEvent.
export function connectLive({broker = DEFAULT_BROKER, prefix = DEFAULT_TOPIC, onEvent, onStatus}) {
  let socket, ping, retry = 1000, stopped = false;
  const open = () => {
    onStatus('connecting');
    try {socket = new WebSocket(broker, ['mqtt'])} catch {return schedule()}
    socket.binaryType = 'arraybuffer';
    let buffer = new Uint8Array(0);
    socket.onopen = () => socket.send(connectPacket('transitsense-web-' + Math.random().toString(16).slice(2, 10)));
    socket.onmessage = message => {
      const merged = new Uint8Array(buffer.length + message.data.byteLength);
      merged.set(buffer); merged.set(new Uint8Array(message.data), buffer.length);
      const {packets, rest} = readPackets(merged);
      buffer = rest;
      for (const p of packets) {
        if (p.type === 2) {
          if (p.body[1] !== 0) return socket.close();
          socket.send(subscribePacket(prefix + '/#'));
          ping = setInterval(() => socket.readyState === 1 && socket.send(PING), 30000);
        }
        if (p.type === 9) {
          retry = 1000;
          onStatus('live');
        }
        if (p.type === 3) {
          const {topic, payload, retained} = readPublish(p);
          const event = parseEvent(prefix, topic, payload);
          if (event && !retained) onEvent(event);
        }
      }
    };
    socket.onclose = () => {clearInterval(ping); schedule()};
  };
  const schedule = () => {
    if (stopped) return;
    onStatus('offline');
    setTimeout(open, retry);
    retry = Math.min(retry * 2, 30000);
  };
  open();
  return {
    publish: (sim, data) => socket?.readyState === 1 && socket.send(publishPacket(prefix + '/' + sim, JSON.stringify(data))),
    close: () => {stopped = true; socket?.close()},
  };
}
