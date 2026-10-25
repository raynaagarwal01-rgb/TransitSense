// Live link to an ESP32 running hardware/website_bridge, over USB through the Web Serial API
// (Chrome or Edge on a computer). Messages are one JSON object per line at 115200 baud.

export function createEsp32Link({onMessage, onStatus}) {
  const supported = typeof navigator !== 'undefined' && 'serial' in navigator;
  const encoder = new TextEncoder();
  let port = null, reader = null, writer = null, reading = null, connected = false, device = null, lastSeen = 0;

  async function readLoop() {
    const decoder = new TextDecoder();
    let buffer = '';
    while (connected && port && port.readable) {
      reader = port.readable.getReader();
      try {
        while (true) {
          const {value, done} = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, {stream: true});
          let end;
          while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end).trim();
            buffer = buffer.slice(end + 1);
            if (!line) continue;
            lastSeen = Date.now();
            let message;
            try { message = JSON.parse(line); }
            catch { onMessage({type: 'text', text: line}); continue; }
            if (message.type === 'hello') device = message;
            onMessage(message);
          }
        }
      } catch {
        break;  // the board was unplugged or the port failed
      } finally {
        reader.releaseLock();
        reader = null;
      }
    }
    if (connected) await close('lost', true);
  }

  async function close(reason, fromReader = false) {
    if (!port) return;
    connected = false;
    try { if (reader) await reader.cancel(); } catch {}
    if (!fromReader && reading) await reading;
    try { if (writer) writer.releaseLock(); } catch {}
    writer = null;
    try { await port.close(); } catch {}
    port = null;
    device = null;
    onStatus(reason);
  }

  async function connect() {
    if (!supported) throw new Error('Web Serial is not available in this browser');
    if (connected) return;
    const chosen = await navigator.serial.requestPort();
    await chosen.open({baudRate: 115200});
    // Release DTR/RTS so the board's auto-reset circuit lets the sketch run.
    try { await chosen.setSignals({dataTerminalReady: false, requestToSend: false}); } catch {}
    port = chosen;
    writer = port.writable.getWriter();
    connected = true;
    lastSeen = 0;
    onStatus('connected');
    reading = readLoop();
    setTimeout(() => send({cmd: 'hello'}), 700);  // in case the board was already running
  }

  async function send(message) {
    if (!writer) return;
    try { await writer.write(encoder.encode(JSON.stringify(message) + '\n')); } catch {}
  }

  if (supported) navigator.serial.addEventListener('disconnect', event => { if (port && event.target === port) close('lost'); });

  return {
    supported, connect, send,
    disconnect: () => close('disconnected'),
    get connected() { return connected; },
    get device() { return device; },
    get lastSeen() { return lastSeen; },
  };
}
