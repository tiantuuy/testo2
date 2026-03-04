const FIXED_UUID = '64c6e2fe-e7a8-4118-b3bc-a1ecd5b9553a'; 
const SECRET_PATH = '/your-secret-path'; 

// 固定反代配置
let 反代IP = 'yx1.9898981.xyz:8443';

export default {
    async fetch(request) {
        try {
            const url = new URL(request.url);
            if (url.pathname !== SECRET_PATH) {
                return new Response('Not Found', { status: 404 });
            }

            const upgradeHeader = request.headers.get('Upgrade');
            if (upgradeHeader !== 'websocket') {
                return new Response(JSON.stringify({ status: "UP", fallback_node: 反代IP }), { status: 200 });
            }

            return await handleSPESSWebSocket(request);
        } catch (err) {
            return new Response(err.message, { status: 500 });
        }
    },
};

async function handleSPESSWebSocket(request) {
    const wsPair = new WebSocketPair();
    const [clientWS, serverWS] = Object.values(wsPair);
    serverWS.accept();

    const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';
    const wsReadable = createWebSocketReadableStream(serverWS, earlyDataHeader);
    let remoteSocket = null;
    let udpStreamWrite = null;
    let isDns = false;

    wsReadable.pipeTo(new WritableStream({
        async write(chunk) {
            if (isDns && udpStreamWrite) return udpStreamWrite(chunk);
            if (remoteSocket) {
                const writer = remoteSocket.writable.getWriter();
                await writer.write(chunk);
                writer.releaseLock();
                return;
            }
            
            const result = parseVLESSHeader(chunk);
            if (result.hasError) throw new Error(result.message);
            
            const vlessRespHeader = new Uint8Array([result.vlessVersion[0], 0]);
            const rawClientData = chunk.slice(result.rawDataIndex);
            
            // DNS 处理
            if (result.isUDP && result.portRemote === 53) {
                isDns = true;
                const { write } = await handleUDPOutBound(serverWS, vlessRespHeader);
                udpStreamWrite = write;
                udpStreamWrite(rawClientData);
                return;
            }

            // TCP 连接策略：先直连，失败则走 Fallback HTTP 代理
            try {
                remoteSocket = await smartConnect(result.addressRemote, result.portRemote);
                const writer = remoteSocket.writable.getWriter();
                await writer.write(rawClientData);
                writer.releaseLock();
                pipeRemoteToWebSocket(remoteSocket, serverWS, vlessRespHeader);
            } catch (err) {
                serverWS.close(1011, 'All connection attempts failed');
            }
        },
        close() { if (remoteSocket) remoteSocket.close(); }
    })).catch(() => {
        if (remoteSocket) remoteSocket.close();
        if (serverWS.readyState === 1) serverWS.close();
    });

    return new Response(null, { status: 101, webSocket: clientWS });
}

/**
 * 智能连接逻辑
 * 1. 尝试直连
 * 2. 如果直连抛出错误（如访问 CF 域名被阻断），则自动切换 HTTP CONNECT 代理
 */
async function smartConnect(host, port) {
    try {
        // 尝试直连
        return await connect({ hostname: host, port: port });
    } catch (directError) {
        console.log(`Direct connect failed for ${host}, trying fallback via ${反代IP}`);
        
        // 自动解析反代IP和端口
        const [proxyHost, proxyPortStr] = 反代IP.split(':');
        const proxyPort = parseInt(proxyPortStr) || 8443;

        // 通过 HTTP CONNECT 隧道连接
        const sock = await connect({ hostname: proxyHost, port: proxyPort });
        const req = `CONNECT ${host}:${port} HTTP/1.1\r\n` +
                    `Host: ${host}:${port}\r\n` +
                    `Proxy-Connection: Keep-Alive\r\n\r\n`;

        const writer = sock.writable.getWriter();
        await writer.write(new TextEncoder().encode(req));
        writer.releaseLock();

        const reader = sock.readable.getReader();
        const { value } = await reader.read();
        const resp = new TextDecoder().decode(value);
        reader.releaseLock();

        if (resp.includes(' 200')) {
            return sock;
        } else {
            sock.close();
            throw new Error('Fallback proxy failed');
        }
    }
}

// 高效转发（YouTube 优化版）
async function pipeRemoteToWebSocket(remoteSocket, ws, vlessHeader) {
    const reader = remoteSocket.readable.getReader();
    let headerSent = false;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done || ws.readyState !== 1) break;
            if (!headerSent) {
                const combined = new Uint8Array(vlessHeader.byteLength + value.byteLength);
                combined.set(vlessHeader, 0);
                combined.set(value, vlessHeader.byteLength);
                ws.send(combined);
                headerSent = true;
            } else {
                ws.send(value);
            }
        }
    } catch (e) {} finally {
        reader.releaseLock();
        if (ws.readyState === 1) ws.close();
    }
}

// DNS DoH 处理
async function handleUDPOutBound(webSocket, vlessHeader) {
    let headerSent = false;
    const transformStream = new TransformStream({
        transform(chunk, controller) {
            for (let i = 0; i < chunk.byteLength;) {
                const len = new DataView(chunk.slice(i, i + 2).buffer).getUint16(0);
                controller.enqueue(chunk.slice(i + 2, i + 2 + len));
                i += 2 + len;
            }
        }
    });
    transformStream.readable.pipeTo(new WritableStream({
        async write(chunk) {
            const resp = await fetch('https://1.1.1.1/dns-query', {
                method: 'POST', headers: { 'content-type': 'application/dns-message' }, body: chunk,
            });
            const dnsResult = await resp.arrayBuffer();
            const udpLen = new Uint8Array([(dnsResult.byteLength >> 8) & 0xff, dnsResult.byteLength & 0xff]);
            if (webSocket.readyState === 1) {
                const out = headerSent ? [udpLen, dnsResult] : [vlessHeader, udpLen, dnsResult];
                webSocket.send(await new Blob(out).arrayBuffer());
                headerSent = true;
            }
        }
    }));
    const writer = transformStream.writable.getWriter();
    return { write(chunk) { writer.write(chunk); } };
}

// 辅助函数
import { connect } from 'cloudflare:sockets';

function createWebSocketReadableStream(ws, earlyDataHeader) {
    return new ReadableStream({
        start(controller) {
            ws.addEventListener('message', e => controller.enqueue(e.data));
            ws.addEventListener('close', () => controller.close());
            ws.addEventListener('error', e => controller.error(e));
            if (earlyDataHeader) {
                try {
                    const b64 = earlyDataHeader.replace(/-/g, '+').replace(/_/g, '/');
                    controller.enqueue(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
                } catch (e) {}
            }
        }
    });
}

function parseVLESSHeader(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength < 24) return { hasError: true };
    const uuid = Array.from(new Uint8Array(buffer.slice(1, 17)), b => b.toString(16).padStart(2, '0')).join('');
    const formattedUuid = `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
    if (formattedUuid !== FIXED_UUID) return { hasError: true };
    const optLen = view.getUint8(17);
    const cmd = view.getUint8(18 + optLen);
    let offset = 19 + optLen;
    const port = view.getUint16(offset); offset += 2;
    const type = view.getUint8(offset++);
    let address = '';
    if (type === 1) { address = Array.from(new Uint8Array(buffer.slice(offset, offset + 4))).join('.'); offset += 4; }
    else if (type === 2) { const len = view.getUint8(offset++); address = new TextDecoder().decode(buffer.slice(offset, offset + len)); offset += len; }
    return { hasError: false, addressRemote: address, portRemote: port, rawDataIndex: offset, vlessVersion: new Uint8Array([view.getUint8(0)]), isUDP: cmd === 2 };
}
