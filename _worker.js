const STALYI_ID = 'd14bd0e0-9ade-4824-aa96-03bbe680b4db'; // рекомендовано змінити на власний стандартизований ідентифікатор, якщо не потрібно — залишити порожнім

let zvorotnaIP = '',
  uvisknenoTunel5 = null,
  globalnyiTunel5 = false,
  miyTunel5Oblik = '',
  rozibranaTunel5Adresa = {};

export default {
  async fetch(request) {
    try {
      const url = new URL(request.url);

      const upgradeHeader = request.headers.get('Upgrade');

      if (upgradeHeader !== 'websocket') {
        return new Response('Hello World!', { status: 200 });
      } else {
        zvorotnaIP = zvorotnaIP
          ? zvorotnaIP
          : request.cf.colo + '.relayIP.cmliuSSSS.NET';

        await otrimatyParametryZvorotu(request);

        const [ipAdres, ipPort] = await rozibratyAdresuIPort(zvorotnaIP);

        return await obrobytySPESSWebSocket(request, {
          rozibranaTunel5Adresa,
          enableTunnel: uvisknenoTunel5,
          globalTunnel: globalnyiTunel5,
          relayIP: ipAdres,
          relayPort: ipPort
        });
      }
    } catch (err) {
      return new Response(err && err.stack ? err.stack : String(err), {
        status: 500
      });
    }
  }
};

async function obrobytySPESSWebSocket(request, config) {
  const {
    rozibranaTunel5Adresa,
    enableTunnel,
    globalTunnel,
    relayIP,
    relayPort
  } = config;

  const paraWS = new WebSocketPair();
  const [clientWS, serverWS] = Object.values(paraWS);

  serverWS.accept();

  let heartbeatInterval = setInterval(() => {
    if (serverWS.readyState === WS_READY_STATE_OPEN) {
      try {
        serverWS.send(new Uint8Array(0));
      } catch {}
    }
  }, 30000);

  function clearHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  serverWS.addEventListener('close', clearHeartbeat);
  serverWS.addEventListener('error', clearHeartbeat);

  const earlyDataHeader =
    request.headers.get('sec-websocket-protocol') || '';

  const wsReadable = stvorytyWSReadable(serverWS, earlyDataHeader);

  let remoteSocket = null;
  let udpWriter = null;
  let isDns = false;

  wsReadable
    .pipeTo(
      new WritableStream({
        async write(chunk) {
          if (isDns && udpWriter) return udpWriter(chunk);

          if (remoteSocket) {
            try {
              const writer = remoteSocket.writable.getWriter();
              await writer.write(chunk);
              writer.releaseLock();
            } catch (err) {
              zakrytySocket(remoteSocket);
              throw err;
            }
            return;
          }

          const result = rozibratyVLESSZagolovok(chunk);
          if (result.hasError) throw new Error(result.message);

          if (
            result.addressRemote.includes(
              atob('c3BlZWQuY2xvdWRmbGFyZS5jb20=')
            )
          )
            throw new Error('Access');

          const vlessRespHeader = new Uint8Array([
            result.vlessVersion[0],
            0
          ]);

          const rawClientData = chunk.slice(result.rawDataIndex);

          if (result.isUDP) {
            if (result.portRemote === 53) {
              isDns = true;
              const { write } = await obrobytyUDP(
                serverWS,
                vlessRespHeader
              );
              udpWriter = write;
              udpWriter(rawClientData);
              return;
            } else {
              throw new Error('UDP лише DNS 53');
            }
          }

          async function connectAndWrite(address, port) {
            const tcpSocket = await connect(
              { hostname: address, port },
              { allowHalfOpen: true }
            );
            remoteSocket = tcpSocket;
            const writer = tcpSocket.writable.getWriter();
            await writer.write(rawClientData);
            writer.releaseLock();
            return tcpSocket;
          }

          async function connectViaTunnel(address, port) {
            const tcpSocket =
              enableTunnel === 't5'
                ? await pidklTunel5(
                    result.addressType,
                    address,
                    port,
                    rozibranaTunel5Adresa
                  )
                : await httpTunel(
                    result.addressType,
                    address,
                    port,
                    rozibranaTunel5Adresa
                  );

            remoteSocket = tcpSocket;
            const writer = tcpSocket.writable.getWriter();
            await writer.write(rawClientData);
            writer.releaseLock();
            return tcpSocket;
          }

          async function retry() {
            try {
              let tcpSocket;

              if (enableTunnel === 't5') {
                tcpSocket = await pidklTunel5(
                  result.addressType,
                  result.addressRemote,
                  result.portRemote,
                  rozibranaTunel5Adresa
                );
              } else if (enableTunnel === 'http') {
                tcpSocket = await httpTunel(
                  result.addressType,
                  result.addressRemote,
                  result.portRemote,
                  rozibranaTunel5Adresa
                );
              } else {
                tcpSocket = await connect(
                  { hostname: relayIP, port: relayPort },
                  { allowHalfOpen: true }
                );
              }

              remoteSocket = tcpSocket;

              const writer = tcpSocket.writable.getWriter();
              await writer.write(rawClientData);
              writer.releaseLock();

              tcpSocket.closed.catch(() => {}).finally(() => {
                if (serverWS.readyState === WS_READY_STATE_OPEN) {
                  serverWS.close(1000, 'зʼєднання закрито');
                }
              });

              pipeRemoteToWebSocket(
                tcpSocket,
                serverWS,
                vlessRespHeader,
                null
              );
            } catch (err) {
              zakrytySocket(remoteSocket);
              serverWS.close(
                1011,
                'помилка підключення: ' +
                  (err?.message || err)
              );
            }
          }

          try {
            if (globalTunnel) {
              const tcpSocket = await connectViaTunnel(
                result.addressRemote,
                result.portRemote
              );
              pipeRemoteToWebSocket(
                tcpSocket,
                serverWS,
                vlessRespHeader,
                retry
              );
            } else {
              const tcpSocket = await connectAndWrite(
                result.addressRemote,
                result.portRemote
              );
              pipeRemoteToWebSocket(
                tcpSocket,
                serverWS,
                vlessRespHeader,
                retry
              );
            }
          } catch (err) {
            zakrytySocket(remoteSocket);
            serverWS.close(
              1011,
              'помилка: ' + (err?.message || err)
            );
          }
        },
        close() {
          if (remoteSocket) zakrytySocket(remoteSocket);
        }
      })
    )
    .catch(err => {
      zakrytySocket(remoteSocket);
      serverWS.close(
        1011,
        'внутрішня помилка: ' + (err?.message || err)
      );
    });

  return new Response(null, {
    status: 101,
    webSocket: clientWS
  });
}

function stvorytyWSReadable(ws, earlyDataHeader) {
  return new ReadableStream({
    start(controller) {
      ws.addEventListener('message', e =>
        controller.enqueue(e.data)
      );
      ws.addEventListener('close', () => controller.close());
      ws.addEventListener('error', e =>
        controller.error(e)
      );

      if (earlyDataHeader) {
        try {
          const decoded = atob(
            earlyDataHeader
              .replace(/-/g, '+')
              .replace(/_/g, '/')
          );
          const data = Uint8Array.from(decoded, c =>
            c.charCodeAt(0)
          );
          controller.enqueue(data.buffer);
        } catch {}
      }
    }
  });
}

function rozibratyVLESSZagolovok(buffer) {
  if (buffer.byteLength < 24)
    return { hasError: true, message: 'некоректний заголовок' };

  const view = new DataView(buffer);
  const version = new Uint8Array(buffer.slice(0, 1));

  const id = formatID(new Uint8Array(buffer.slice(1, 17)));

  if (STALYI_ID && id !== STALYI_ID)
    return { hasError: true, message: 'невірний користувач' };

  const optionsLength = view.getUint8(17);
  const command = view.getUint8(18 + optionsLength);

  let isUDP = false;
  if (command === 2) isUDP = true;
  else if (command !== 1)
    return {
      hasError: true,
      message: 'підтримується TCP або UDP'
    };

  let offset = 19 + optionsLength;

  const port = view.getUint16(offset);
  offset += 2;

  const addressType = view.getUint8(offset++);
  let address = '';

  if (addressType === 1) {
    address = Array.from(
      new Uint8Array(buffer.slice(offset, offset + 4))
    ).join('.');
    offset += 4;
  } else if (addressType === 2) {
    const len = view.getUint8(offset++);
    address = new TextDecoder().decode(
      buffer.slice(offset, offset + len)
    );
    offset += len;
  } else if (addressType === 3) {
    const ipv6 = [];
    for (let i = 0; i < 8; i++) {
      ipv6.push(
        view
          .getUint16(offset)
          .toString(16)
          .padStart(4, '0')
      );
      offset += 2;
    }
    address = ipv6.join(':').replace(/(^|:)0+(\w)/g, '$1$2');
  } else {
    return {
      hasError: true,
      message: 'тип адреси не підтримується'
    };
  }

  return {
    hasError: false,
    addressRemote: address,
    portRemote: port,
    rawDataIndex: offset,
    vlessVersion: version,
    isUDP,
    addressType
  };
}

function zakrytySocket(socket) {
  if (socket)
    try {
      socket.close();
    } catch {}
}

function formatID(bytes) {
  const hex = Array.from(bytes, b =>
    b.toString(16).padStart(2, '0')
  ).join('');
  return `${hex.slice(0, 8)}-${hex.slice(
    8,
    12
  )}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20)}`;
}

// ===== UDP DNS =====
async function obrobytyUDP(ws, zag) {
  let sent = false;

  const transform = new TransformStream({
    transform(chunk, controller) {
      for (let i = 0; i < chunk.byteLength; ) {
        const len = new DataView(
          chunk.slice(i, i + 2)
        ).getUint16(0);
        const data = chunk.slice(i + 2, i + 2 + len);
        i += 2 + len;
        controller.enqueue(data);
      }
    }
  });

  transform.readable
    .pipeTo(
      new WritableStream({
        async write(chunk) {
          const resp = await fetch(
            'https://1.1.1.1/dns-query',
            {
              method: 'POST',
              headers: {
                'content-type': 'application/dns-message'
              },
              body: chunk
            }
          );

          const arr = await resp.arrayBuffer();
          const size = arr.byteLength;
          const sizeBuf = new Uint8Array([
            (size >> 8) & 255,
            size & 255
          ]);

          if (ws.readyState === WS_READY_STATE_OPEN) {
            if (sent)
              ws.send(
                await new Blob([sizeBuf, arr]).arrayBuffer()
              );
            else {
              ws.send(
                await new Blob([
                  zag,
                  sizeBuf,
                  arr
                ]).arrayBuffer()
              );
              sent = true;
            }
          }
        }
      })
    )
    .catch(() => {});

  const writer = transform.writable.getWriter();

  return {
    write(c) {
      writer.write(c);
    }
  };
}

// ===== IP parse =====
async function rozibratyAdresuIPort(ip) {
  ip = ip.toLowerCase();

  let addr = ip,
    port = 443;

  if (ip.includes('.tp')) {
    const m = ip.match(/.tp(\d+)/);
    if (m) port = parseInt(m[1], 10);
    return [addr, port];
  }

  if (ip.includes(']:')) {
    const p = ip.split(']:');
    addr = p[0] + ']';
    port = parseInt(p[1], 10) || port;
  } else if (ip.includes(':') && !ip.startsWith('[')) {
    const i = ip.lastIndexOf(':');
    addr = ip.slice(0, i);
    port = parseInt(ip.slice(i + 1), 10) || port;
  }

  return [addr, port];
}

async function otrimatyParametryZvorotu(request) {
  const url = new URL(request.url);
  const { pathname, searchParams } = url;

  miyTunel5Oblik =
    searchParams.get('t5') ||
    searchParams.get('http') ||
    null;

  globalnyiTunel5 = searchParams.has('global');

  if (miyTunel5Oblik) {
    try {
      rozibranaTunel5Adresa =
        await rozibratyTunel5(miyTunel5Oblik);
      uvisknenoTunel5 = searchParams.get('http')
        ? 'http'
        : 't5';
    } catch {
      uvisknenoTunel5 = null;
    }
  } else {
    uvisknenoTunel5 = null;
  }
}

async function rozibratyTunel5(addr) {
  const lastAt = addr.lastIndexOf('@');

  let hostPart = addr;
  let authPart;

  if (lastAt !== -1) {
    authPart = addr.substring(0, lastAt);
    hostPart = addr.substring(lastAt + 1);
  }

  let username, password;

  if (authPart) {
    const p = authPart.split(':');
    username = p[0];
    password = p[1];
  }

  const parts = hostPart.split(':');
  const hostname = parts[0];
  const port = Number(parts[1] || 80);

  return { username, password, hostname, port };
}

// ===== tunnel connect =====
async function pidklTunel5(type, host, port, cfg) {
  const socket = connect({
    hostname: cfg.hostname,
    port: cfg.port
  });

  return socket;
}

async function httpTunel(type, host, port, cfg) {
  const sock = await connect({
    hostname: cfg.hostname,
    port: cfg.port
  });

  const writer = sock.writable.getWriter();

  let req = `CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`;

  await writer.write(new TextEncoder().encode(req));
  writer.releaseLock();

  return sock;
}

const WS_READY_STATE_OPEN = 1;
import { connect } from 'cloudflare:sockets';
