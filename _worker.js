const ФІКСОВАНИЙ_ІДЕНТИФІКАТОР = 'd14bd0e0-9ade-4824-aa96-03bbe680b4db';
let зворотній_сервер = 'yx1.9898981.xyz:8443';

export default {
    async fetch(запит) {
        try {
            const адреса = new URL(запит.url);
            const заголовокОновлення = запит.headers.get('Upgrade');
            if (заголовокОновлення !== 'websocket') {
                return new Response('Привіт Світ!', { status: 200 });
            } else {
                зворотній_сервер = зворотній_сервер ? зворотній_сервер : запит.cf.colo + '.proxyIP.cmliuSSSS.NET';
                await оновленняЗворотньогоСервера(запит);
                const [адресаЗворотньогоСервера, портЗворотньогоСервера] = await визначенняАдресиПорту(зворотній_сервер);
                return await обробкаВебСокету(запит, {
                    серверПеренаправлення: адресаЗворотньогоСервера,
                    портПеренаправлення: портЗворотньогоСервера
                });
            }
        } catch (помилка) {
            return new Response(помилка && помилка.stack ? помилка.stack : String(помилка), { status: 500 });
        }
    },
};

async function обробкаВебСокету(запит, налаштування) {
    const { серверПеренаправлення, портПеренаправлення } = налаштування;
    const вебСокетПара = new WebSocketPair();
    const [клієнтськийВебСокет, сервернийВебСокет] = Object.values(вебСокетПара);
    
    сервернийВебСокет.accept();
    
    let інтервалСерцебиття = setInterval(() => {
        if (сервернийВебСокет.readyState === СТАН_ВІДКРИТОГО_ВЕБСОКЕТУ) {
            try {
                сервернийВебСокет.send(new Uint8Array(0));
            } catch (e) {}
        }
    }, 30000);
    
    function очищенняСерцебиття() {
        if (інтервалСерцебиття) {
            clearInterval(інтервалСерцебиття);
            інтервалСерцебиття = null;
        }
    }
    
    сервернийВебСокет.addEventListener('close', (ev) => {
    очищенняСерцебиття();
    
    сервернийВебСокет.close(1000, 'Normal closure'); 
});
сервернийВебСокет.addEventListener('error', (ev) => {
    очищенняСерцебиття();
    сервернийВебСокет.close(1011, 'Internal error'); 
});
    
    const ранніДаніЗаголовка = запит.headers.get('sec-websocket-protocol') || '';
    const читабельнийВебСокет = створенняЧитабельногоПотокуВебСокет(сервернийВебСокет, ранніДаніЗаголовка);
    let віддаленийСокет = null;
    let записUdpПотоку = null;
    let цеDns = false;
    
    читабельнийВебСокет.pipeTo(new WritableStream({
        async write(фрагмент) {
            if (цеDns && записUdpПотоку) {
                return записUdpПотоку(фрагмент);
            }
            
            if (віддаленийСокет) {
                try {
                    const записувач = віддаленийСокет.writable.getWriter();
                    await записувач.write(фрагмент);
                    записувач.releaseLock();
                } catch (помилка) {
                    закриттяСокета(віддаленийСокет);
                    throw помилка;
                }
                return;
            }
            
            const результат = аналізЗаголовкаVLESS(фрагмент);
            if (результат.єПомилка) throw new Error(результат.повідомлення);
            if (результат.адресаВіддаленого.includes(atob('c3BlZWQuY2xvdWRmbGFyZS5jb20='))) throw new Error('Доступ заборонено');
            
            const відповідьVless = new Uint8Array([результат.версіяVless[0], 0]);
            const сиріДаніКлієнта = фрагмент.slice(результат.індексСиріхДаних);
            
            if (результат.цеUDP) {
                if (результат.портВіддаленого === 53) {
                    цеDns = true;
                    const { write } = await обробкаUdpВиходу(сервернийВебСокет, відповідьVless);
                    записUdpПотоку = write;
                    записUdpПотоку(сиріДаніКлієнта);
                    return;
                } else {
                    throw new Error('UDP підтримує лише DNS (порт 53)');
                }
            }
            
            async function зєднанняТаЗапис(адреса, порт) {
                try {
                    const tcpСокет = await connect({ hostname: адреса, port: порт }, { allowHalfOpen: true });
                    віддаленийСокет = tcpСокет;
                    const записувач = tcpСокет.writable.getWriter();
                    await записувач.write(сиріДаніКлієнта);
                    записувач.releaseLock();
                    return tcpСокет;
                } catch (помилка) {
                    throw помилка;
                }
            }
            
            try {
                const tcpСокет = await зєднанняТаЗапис(результат.адресаВіддаленого, результат.портВіддаленого);
                передачаДанихДоВебСокету(tcpСокет, сервернийВебСокет, відповідьVless, {
                    типАдреси: результат.типАдреси,
                    адреса: результат.адресаВіддаленого,
                    порт: результат.портВіддаленого,
                    дані: сиріДаніКлієнта,
                    серверПеренаправлення,
                    портПеренаправлення
                });
            } catch (помилка) {
                закриттяСокета(віддаленийСокет);
                сервернийВебСокет.close(1011, 'Помилка з\'єднання: ' + (помилка && помилка.message ? помилка.message : помилка));
            }
        },
        close() {
            if (віддаленийСокет) {
                закриттяСокета(віддаленийСокет);
            }
        }
    })).catch(помилка => {
        закриттяСокета(віддаленийСокет);
        if (сервернийВебСокет.readyState === СТАН_ВІДКРИТОГО_ВЕБСОКЕТУ) {
            сервернийВебСокет.close(1011, 'Внутрішня помилка: ' + (помилка && помилка.message ? помилка.message : помилка));
        }
    });
    
    return new Response(null, {
        status: 101,
        webSocket: клієнтськийВебСокет,
    });
}

function створенняЧитабельногоПотокуВебСокет(вебСокет, ранніДаніЗаголовка) {
    return new ReadableStream({
        start(контролер) {
            вебСокет.addEventListener('message', подія => {
                контролер.enqueue(подія.data);
            });
            
            вебСокет.addEventListener('close', () => {
                контролер.close();
            });
            
            вебСокет.addEventListener('error', помилка => {
                контролер.error(помилка);
            });
            
            if (ранніДаніЗаголовка) {
                try {
                    const розкодовано = atob(ранніДаніЗаголовка.replace(/-/g, '+').replace(/_/g, '/'));
                    const дані = Uint8Array.from(розкодовано, с => с.charCodeAt(0));
                    контролер.enqueue(дані.buffer);
                } catch (e) {}
            }
        }
    });
}

function аналізЗаголовкаVLESS(буфер) {
    if (буфер.byteLength < 24) {
        return { єПомилка: true, повідомлення: 'Недійсна довжина заголовка' };
    }
    
    const переглядач = new DataView(буфер);
    const версія = new Uint8Array(буфер.slice(0, 1));
    const ідентифікатор = форматуванняІдентифікатора(new Uint8Array(буфер.slice(1, 17)));
    
    if (ФІКСОВАНИЙ_ІДЕНТИФІКАТОР && ідентифікатор !== ФІКСОВАНИЙ_ІДЕНТИФІКАТОР) {
        return { єПомилка: true, повідомлення: 'Недійсний користувач' };
    }
    
    const довжинаОпцій = переглядач.getUint8(17);
    const команда = переглядач.getUint8(18 + довжинаОпцій);
    let цеUDP = false;
    
    if (команда === 2) {
        цеUDP = true;
    } else if (команда !== 1) {
        return { єПомилка: true, повідомлення: 'Непідтримувана команда, підтримується лише TCP(01) та UDP(02)' };
    }
    
    let зміщення = 19 + довжинаОпцій;
    const порт = переглядач.getUint16(зміщення);
    зміщення += 2;
    
    const типАдреси = переглядач.getUint8(зміщення++);
    let адреса = '';
    
    switch (типАдреси) {
        case 1:
            адреса = Array.from(new Uint8Array(буфер.slice(зміщення, зміщення + 4))).join('.');
            зміщення += 4;
            break;
        case 2:
            const довжинаДомена = переглядач.getUint8(зміщення++);
            адреса = new TextDecoder().decode(буфер.slice(зміщення, зміщення + довжинаДомена));
            зміщення += довжинаДомена;
            break;
        case 3:
            const ipv6 = [];
            for (let i = 0; i < 8; i++) {
                ipv6.push(переглядач.getUint16(зміщення).toString(16).padStart(4, '0'));
                зміщення += 2;
            }
            адреса = ipv6.join(':').replace(/(^|:)0+(\w)/g, '$1$2');
            break;
        default:
            return { єПомилка: true, повідомлення: 'Непідтримуваний тип адреси' };
    }
    
    return {
        єПомилка: false,
        адресаВіддаленого: адреса,
        портВіддаленого: порт,
        індексСиріхДаних: зміщення,
        версіяVless: версія,
        цеUDP,
        типАдреси
    };
}

async function передачаДанихДоВебСокету(віддаленийСокет, вебСокет, заголовокVless, даніДляПовтору = null, лічильникСпроб = 0) {
    const МАКС_СПРОБ = 3;
    const МАКС_РОЗМІР_ФРАГМЕНТА = 128 * 1024;
    const МАКС_РОЗМІР_БУФЕРА = 2 * 1024 * 1024;
    const ІНТЕРВАЛ_ОЧИЩЕННЯ = 10;
    
    let заголовокНадіслано = false;
    let чергаБуфера = [];
    let байтівУБуфері = 0;
    
    const обєднанняМасивів = (фрагменти) => {
        if (фрагменти.length === 1) return фрагменти[0];
        let загальнийРозмір = 0;
        for (const ф of фрагменти) загальнийРозмір += ф.byteLength;
        const обєднаний = new Uint8Array(загальнийРозмір);
        let зміщення = 0;
        for (const ф of фрагменти) {
            обєднаний.set(ф, зміщення);
            зміщення += ф.byteLength;
        }
        return обєднаний;
    };
    
    const надсиланняФрагментами = (дані) => {
        let зміщення = 0;
        while (зміщення < дані.byteLength) {
            const кінець = Math.min(зміщення + МАКС_РОЗМІР_ФРАГМЕНТА, дані.byteLength);
            вебСокет.send(дані.slice(зміщення, кінець));
            зміщення = кінець;
        }
    };
    
    const очищенняЧергиБуфера = () => {
        if (вебСокет.readyState !== СТАН_ВІДКРИТОГО_ВЕБСОКЕТУ || чергаБуфера.length === 0) return;
        const обєднаний = обєднанняМасивів(чергаБуфера);
        чергаБуфера = [];
        байтівУБуфері = 0;
        надсиланняФрагментами(обєднаний);
    };
    
    const таймерОчищення = setInterval(очищенняЧергиБуфера, ІНТЕРВАЛ_ОЧИЩЕННЯ);
    
    try {
        const читач = віддаленийСокет.readable.getReader();
        let отриманіДані = false;
        
        while (true) {
            const { done, value } = await читач.read();
            if (done) break;
            
            отриманіДані = true;
            
            if (вебСокет.readyState !== СТАН_ВІДКРИТОГО_ВЕБСОКЕТУ) break;
            
            if (!заголовокНадіслано) {
                const обєднаний = new Uint8Array(заголовокVless.byteLength + value.byteLength);
                обєднаний.set(new Uint8Array(заголовокVless), 0);
                обєднаний.set(value, заголовокVless.byteLength);
                чергаБуфера.push(обєднаний);
                байтівУБуфері += обєднаний.byteLength;
                заголовокНадіслано = true;
            } else {
                чергаБуфера.push(value);
                байтівУБуфері += value.byteLength;
            }
            
            if (байтівУБуфері >= МАКС_РОЗМІР_БУФЕРА) {
                очищенняЧергиБуфера();
            }
        }
        
        читач.releaseLock();
        очищенняЧергиБуфера();
        clearInterval(таймерОчищення);
        
        if (!отриманіДані && даніДляПовтору && лічильникСпроб < МАКС_СПРОБ) {
            const затримка = 200 * Math.pow(2, лічильникСпроб);
            await new Promise(r => setTimeout(r, затримка));
            
            try {
                const новийСокет = await connect({ hostname: даніДляПовтору.серверПеренаправлення, port: даніДляПовтору.портПеренаправлення }, { allowHalfOpen: true });
                
                const записувач = новийСокет.writable.getWriter();
                await записувач.write(даніДляПовтору.дані);
                записувач.releaseLock();
                
                await передачаДанихДоВебСокету(новийСокет, вебСокет, заголовокVless, даніДляПовтору, лічильникСпроб + 1);
            } catch (помилка) {
                закриттяСокета(віддаленийСокет);
                if (вебСокет.readyState === СТАН_ВІДКРИТОГО_ВЕБСОКЕТУ) {
                    вебСокет.close(1011, 'Помилка повторної спроби');
                }
            }
            return;
        }
        
        if (вебСокет.readyState === СТАН_ВІДКРИТОГО_ВЕБСОКЕТУ) {
            вебСокет.close(1000, 'Нормальне закриття');
        }
    } catch (помилка) {
        clearInterval(таймерОчищення);
        закриттяСокета(віддаленийСокет);
        if (вебСокет.readyState === СТАН_ВІДКРИТОГО_ВЕБСОКЕТУ) {
            вебСокет.close(1011, 'Помилка передачі даних');
        }
    }
}

function закриттяСокета(сокет) {
    if (сокет) {
        try {
            сокет.close();
        } catch (e) {}
    }
}

function форматуванняІдентифікатора(байти) {
    const шістнадцятковий = Array.from(байти, б => б.toString(16).padStart(2, '0')).join('');
    return `${шістнадцятковий.slice(0, 8)}-${шістнадцятковий.slice(8, 12)}-${шістнадцятковий.slice(12, 16)}-${шістнадцятковий.slice(16, 20)}-${шістнадцятковий.slice(20)}`;
}

async function обробкаUdpВиходу(вебСокет, заголовокВідповіді) {
    let заголовокVlessНадіслано = false;
    
    const потікПеретворення = new TransformStream({
        transform(фрагмент, контролер) {
            for (let індекс = 0; індекс < фрагмент.byteLength;) {
                const довжинаUdpПакета = new DataView(фрагмент.slice(індекс, індекс + 2)).getUint16(0);
                const udpДані = new Uint8Array(фрагмент.slice(індекс + 2, індекс + 2 + довжинаUdpПакета));
                індекс = індекс + 2 + довжинаUdpПакета;
                контролер.enqueue(udpДані);
            }
        }
    });
    
    потікПеретворення.readable.pipeTo(new WritableStream({
        async write(фрагмент) {
            try {
                const відповідь = await fetch('https://1.1.1.1/dns-query', {
                    method: 'POST',
                    headers: { 'content-type': 'application/dns-message' },
                    body: фрагмент,
                });
                
                const результатDns = await відповідь.arrayBuffer();
                const розмірUdp = результатDns.byteLength;
                const буферРозміруUdp = new Uint8Array([(розмірUdp >> 8) & 0xff, розмірUdp & 0xff]);
                
                if (вебСокет.readyState === СТАН_ВІДКРИТОГО_ВЕБСОКЕТУ) {
                    if (заголовокVlessНадіслано) {
                        вебСокет.send(await new Blob([буферРозміруUdp, результатDns]).arrayBuffer());
                    } else {
                        вебСокет.send(await new Blob([заголовокВідповіді, буферРозміруUdp, результатDns]).arrayBuffer());
                        заголовокVlessНадіслано = true;
                    }
                }
            } catch (помилка) {}
        }
    })).catch(() => {});
    
    const записувач = потікПеретворення.writable.getWriter();
    
    return {
        write(фрагмент) {
            записувач.write(фрагмент).catch(() => {});
        }
    };
}

const СТАН_ВІДКРИТОГО_ВЕБСОКЕТУ = 1;
import { connect } from 'cloudflare:sockets';

async function визначенняАдресиПорту(зворотнійСервер) {
    зворотнійСервер = зворотнійСервер.toLowerCase();
    let адреса = зворотнійСервер, порт = 443;
    
    if (зворотнійСервер.includes('.tp')) {
        const tpЗбіг = зворотнійСервер.match(/.tp(\d+)/);
        if (tpЗбіг) порт = parseInt(tpЗбіг[1], 10);
        return [адреса, порт];
    }
    
    if (зворотнійСервер.includes(']:')) {
        const частини = зворотнійСервер.split(']:');
        адреса = частини[0] + ']';
        порт = parseInt(частини[1], 10) || порт;
    } else if (зворотнійСервер.includes(':') && !зворотнійСервер.startsWith('[')) {
        const позиціяДвокрапки = зворотнійСервер.lastIndexOf(':');
        адреса = зворотнійСервер.slice(0, позиціяДвокрапки);
        порт = parseInt(зворотнійСервер.slice(позиціяДвокрапки + 1), 10) || порт;
    }
    
    return [адреса, порт];
}

async function оновленняЗворотньогоСервера(запит) {
    const адреса = new URL(запит.url);
    const { pathname, searchParams } = адреса;
    const шляхНижній = pathname.toLowerCase();
    
    const збігПеренаправлення = шляхНижній.match(/\/(proxyip[.=]|pyip=|ip=)(.+)/);
    
    if (searchParams.has('proxyip')) {
        const параметрIP = searchParams.get('proxyip');
        зворотній_сервер = параметрIP.includes(',') 
            ? параметрIP.split(',')[Math.floor(Math.random() * параметрIP.split(',').length)] 
            : параметрIP;
        return;
    } else if (збігПеренаправлення) {
        const параметрIP = збігПеренаправлення[1] === 'proxyip.' 
            ? `proxyip.${збігПеренаправлення[2]}` 
            : збігПеренаправлення[2];
        зворотній_сервер = параметрIP.includes(',') 
            ? параметрIP.split(',')[Math.floor(Math.random() * параметрIP.split(',').length)] 
            : параметрIP;
        return;
    }
}
