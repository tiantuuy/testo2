const ttuu = 'd14bd0e0-9ade-4824-aa96-03bbe680b4db';

let вузолПроміжний = '',
    режим5 = null,
    режимГлобальний5 = false,
    облікові5 = '',
    розбір5 = {};

export default {
    async fetch(req) {
        try {
            const u = new URL(req.url);
            const up = req.headers.get('Upgrade');

            if (up !== 'websocket') {
                return new Response('OK', { status: 200 });
            }

            вузолПроміжний = вузолПроміжний
                ? вузолПроміжний
                : req.cf.colo + '.edge.node.local';

            await отриматиПараметри(req);
            const [ip, prt] = await розібратиАдресу(vузолПроміжний);

            return await обробитиWS(req, {
                addr: розбір5,
                mode: режим5,
                gmode: режимГлобальний5,
                ip,
                prt
            });

        } catch (e) {
            return new Response(String(e), { status: 500 });
        }
    }
};

async function обробитиWS(req, cfg) {
    const pair = new WebSocketPair();
    const cli = pair[0];
    const srv = pair[1];
    srv.accept();

    let t = setInterval(() => {
        if (srv.readyState === 1) {
            try { srv.send(new Uint8Array(0)); } catch {}
        }
    }, 30000);

    function stop() {
        if (t) clearInterval(t);
        t = null;
    }

    srv.addEventListener('close', stop);
    srv.addEventListener('error', stop);

    const early = req.headers.get('sec-websocket-protocol') || '';
    const rd = wsReadable(srv, early);

    let out = null;

    rd.pipeTo(new WritableStream({
        async write(chunk) {

            if (out) {
                const w = out.writable.getWriter();
                await w.write(chunk);
                w.releaseLock();
                return;
            }

            const r = parseHead(chunk);
            if (r.err) throw new Error(r.msg);

            const data = chunk.slice(r.idx);

            async function dialDirect(a, p) {
                const o = {};
                o["hostname"] = a;
                o["port"] = p;
                const s = await connect(o, { allowHalfOpen: true });
                out = s;
                const w = s.writable.getWriter();
                await w.write(data);
                w.releaseLock();
                return s;
            }

            async function retry() {
                try {
                    const o = {};
                    o["hostname"] = cfg.ip;
                    o["port"] = cfg.prt;
                    const s = await connect(o, { allowHalfOpen: true });
                    out = s;
                    const w = s.writable.getWriter();
                    await w.write(data);
                    w.releaseLock();
                    pipe(s, srv, r.ver);
                } catch {
                    srv.close();
                }
            }

            try {
                const s = await dialDirect(r.addr, r.p);
                pipe(s, srv, r.ver, retry);
            } catch {
                srv.close();
            }
        },
        close() {
            if (out) try { out.close(); } catch {}
        }
    }));

    return new Response(null, { status: 101, webSocket: cli });
}

function wsReadable(ws, early) {
    return new ReadableStream({
        start(c) {
            ws.addEventListener('message', e => c.enqueue(e.data));
            ws.addEventListener('close', () => c.close());
            ws.addEventListener('error', e => c.error(e));

            if (early) {
                try {
                    const d = atob(early.replace(/-/g,'+').replace(/_/g,'/'));
                    const arr = Uint8Array.from(d, x=>x.charCodeAt(0));
                    c.enqueue(arr.buffer);
                } catch {}
            }
        }
    });
}

function parseHead(buf) {
    if (buf.byteLength < 24)
        return { err:true, msg:'bad' };

    const v = new Uint8Array(buf.slice(0,1));
    const id = uuidFmt(new Uint8Array(buf.slice(1,17)));

    if (ttuu && id !== ttuu)
        return { err:true, msg:'id' };

    const dv = new DataView(buf);
    const opt = dv.getUint8(17);
    const cmd = dv.getUint8(18+opt);

    if (cmd !== 1)
        return { err:true, msg:'cmd' };

    let off = 19+opt;
    const p = dv.getUint16(off); off+=2;
    const typ = dv.getUint8(off++);

    let addr='';

    if (typ===1){
        addr = Array.from(new Uint8Array(buf.slice(off,off+4))).join('.');
    } else if (typ===2){
        const l = dv.getUint8(off++);
        addr = new TextDecoder().decode(buf.slice(off,off+l));
    } else {
        return { err:true, msg:'atype' };
    }

    return {
        err:false,
        addr,
        p,
        idx:off,
        ver:v
    };
}

async function pipe(sock, ws, head, retry=null){
    const rd = sock.readable.getReader();
    let sent=false;

    try{
        while(true){
            const {done,val}=await rd.read();
            if(done) break;
            if(ws.readyState!==1) break;

            if(!sent){
                const m=new Uint8Array(head.byteLength+val.byteLength);
                m.set(new Uint8Array(head),0);
                m.set(val,head.byteLength);
                ws.send(m);
                sent=true;
            } else ws.send(val);
        }

        rd.releaseLock();
        if(ws.readyState===1) ws.close();

    } catch{
        rd.releaseLock();
        if(retry) await retry();
    }
}

function uuidFmt(b){
    const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

async function розібратиАдресу(v){
    v=v.toLowerCase();
    let a=v, p=443;

    if(v.includes(':')){
        const i=v.lastIndexOf(':');
        a=v.slice(0,i);
        p=parseInt(v.slice(i+1))||443;
    }
    return [a,p];
}

async function отриматиПараметри(req){
    const u=new URL(req.url);
    const sp=u.searchParams;

    облікові5 = sp.get('p')||null;
    режимГлобальний5 = sp.has('g');

    if(sp.has('n')){
        вузолПроміжний = sp.get('n');
    }
}

const WS_READY_STATE_OPEN = 1;
import { connect } from 'cloudflare:sockets';
