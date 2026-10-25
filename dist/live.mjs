// Live feed from the Wokwi ESP32 (hardware/wokwi/sketch.ino) over MQTT.
// The simulated board publishes to a public broker through Wokwi-GUEST Wi-Fi; this
// minimal MQTT 3.1.1 client (QoS 0, over a secure WebSocket) follows the same topics:
//   transitsense/live/<junction|priority|counter|parking>  board -> website
//   transitsense/live/cmd/<system>                         website -> board

export const LIVE_BROKER = 'wss://broker.hivemq.com:8884/mqtt';
export const LIVE_PREFIX = 'transitsense/live/';

const encoder = new TextEncoder(), decoder = new TextDecoder();
const utf8 = text => { const bytes = encoder.encode(text); return [bytes.length >> 8, bytes.length & 255, ...bytes]; };
function remainingLength(n) {
  const out = [];
  do { let byte = n % 128; n = Math.floor(n / 128); if (n > 0) byte |= 128; out.push(byte); } while (n > 0);
  return out;
}
const packet = (type, flags, body) => new Uint8Array([(type << 4) | flags, ...remainingLength(body.length), ...body]);

export function createLiveFeed({url = LIVE_BROKER, prefix = LIVE_PREFIX, onMessage, onStatus}) {
  let socket = null, buffer = new Uint8Array(0), wanted = false, connected = false, pinger = null, retry = null, nextId = 1;

  function handle(type, flags, body) {
    if (type === 2) {  // CONNACK
      if (body[1] !== 0) { onStatus('refused'); socket.close(); return; }
      connected = true;
      const id = nextId++;
      socket.send(packet(8, 2, [id >> 8, id & 255, ...utf8(prefix + '+'), 0]));  // SUBSCRIBE, QoS 0
      pinger = setInterval(() => socket && socket.readyState === 1 && socket.send(new Uint8Array([0xC0, 0])), 30000);
      onStatus('connected');
    } else if (type === 3) {  // PUBLISH
      const topicLength = (body[0] << 8) | body[1], qos = (flags >> 1) & 3;
      const topic = decoder.decode(body.subarray(2, 2 + topicLength));
      const payload = decoder.decode(body.subarray(2 + topicLength + (qos ? 2 : 0)));
      onMessage(topic.slice(prefix.length), payload);
    }
  }

  function receive(data) {
    const merged = new Uint8Array(buffer.length + data.length);
    merged.set(buffer);
    merged.set(data, buffer.length);
    buffer = merged;
    while (buffer.length >= 2) {
      let length = 0, multiplier = 1, i = 1, byte;
      do {
        if (i >= buffer.length) return;  // length bytes not all here yet
        byte = buffer[i++];
        length += (byte & 127) * multiplier;
        multiplier *= 128;
      } while (byte & 128);
      if (buffer.length < i + length) return;
      handle(buffer[0] >> 4, buffer[0] & 15, buffer.subarray(i, i + length));
      buffer = buffer.slice(i + length);
    }
  }

  function open() {
    onStatus('connecting');
    buffer = new Uint8Array(0);
    try { socket = new WebSocket(url, 'mqtt'); }
    catch { onStatus('failed'); return; }
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      const clientId = 'transitsense-web-' + Math.random().toString(16).slice(2, 10);
      socket.send(packet(1, 0, [...utf8('MQTT'), 4, 0x02, 0, 60, ...utf8(clientId)]));  // CONNECT, clean session, 60 s keep-alive
    };
    socket.onmessage = event => receive(new Uint8Array(event.data));
    socket.onclose = () => {
      clearInterval(pinger);
      socket = null;
      connected = false;
      if (wanted) { onStatus('reconnecting'); retry = setTimeout(open, 3000); }
      else onStatus('disconnected');
    };
  }

  return {
    url, prefix,
    connect() { if (wanted) return; wanted = true; open(); },
    disconnect() {
      wanted = false;
      clearTimeout(retry);
      if (socket) { try { socket.send(new Uint8Array([0xE0, 0])); } catch {} socket.close(); }
    },
    publish(subtopic, message) {
      if (!connected) return false;
      socket.send(packet(3, 0, [...utf8(prefix + subtopic), ...encoder.encode(JSON.stringify(message))]));
      return true;
    },
    get connected() { return connected; },
  };
}
