// server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const https = require('https');

// --- [PENTING] Konfigurasi untuk Deployment ---
// [FIXED] Menambahkan URL Vercel Anda ke daftar yang diizinkan
const allowedOrigins = [
    'https://webtopup-aa4adg6lt-akuzamilyts-projects.vercel.app'
];
// [FIXED] Menggunakan URL Vercel Anda untuk link di notifikasi
const DEPLOYED_URL = 'https://webtopup-aa4adg6lt-akuzamilyts-projects.vercel.app'; 

// --- Konfigurasi Admin & Sesi ---
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'zaprime123';
const sessions = {}; 

// --- Konfigurasi VIPayment ---
const VIPAYMENT_API_KEY = '3qVmk9JCZ5BtVJJPoWskWKcvyntIRCc8zAONwPYLZtJS0euLKVFMX4nuzYVtr4AF';
const VIPAYMENT_API_ID = 'EYk2PiRY';
const pendingOrders = []; 

// --- Konfigurasi Notifikasi ---
const NTFY_TOPIC = 'zaprime-pesanan-baru-abcdef123'; 

// --- Fungsi Helper ---
function generateVipaymentSign() { return crypto.createHash('md5').update(VIPAYMENT_API_ID + VIPAYMENT_API_KEY).digest('hex'); }
function parseCookies(cookieHeader = '') { const list = {}; cookieHeader.split(';').forEach(c => { let [n, ...r] = c.split('='); n = n?.trim(); if(n){ list[n] = decodeURIComponent(r.join('=').trim()); }}); return list; }
function sendNtfyNotification(title, message, clickUrl) {
    const options = { hostname: 'ntfy.sh', path: `/${NTFY_TOPIC}`, method: 'POST', headers: { 'Title': title, 'Click': clickUrl, 'Tags': 'tada' }};
    const req = https.request(options, res => console.log(`[NOTIFIKASI] Status pengiriman: ${res.statusCode}`));
    req.on('error', error => console.error('[NOTIFIKASI] Gagal mengirim notifikasi:', error));
    req.write(message);
    req.end();
}

const hostname = '0.0.0.0'; // Diubah untuk kompatibilitas hosting
const port = process.env.PORT || 3000;

// === SERVER UTAMA ===
const server = http.createServer((req, res) => {
    // Penanganan CORS
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    let cookies = parseCookies(req.headers.cookie);

    if (!cookies.userSessionId) {
        const userSessionId = crypto.randomBytes(16).toString('hex');
        res.setHeader('Set-Cookie', `userSessionId=${userSessionId}; HttpOnly; Path=/; Max-Age=2592000; SameSite=None; Secure`);
        cookies.userSessionId = userSessionId;
    }

    // ... Sisa logika server tetap sama (rute-rute) ...
    // 1. RUTE API PUBLIK
    if (pathname === '/api/pulsa-harga' && req.method === 'POST') { handleGetHarga(req, res); return; }
    if (pathname === '/api/pending-order-notification' && req.method === 'POST') { handleNewOrderNotification(req, res, cookies.userSessionId); return; }
    if (pathname === '/api/my-orders' && req.method === 'GET') { handleGetMyOrders(req, res, cookies.userSessionId); return; }
    if (pathname === '/api/game-products' && req.method === 'POST') { handleGetGameProducts(req, res); return; }


    // 2. RUTE LOGIN ADMIN
    if (pathname === '/admin-login-page') { serveStaticFile(path.join(__dirname, 'pages', 'admin-login.html'), res); return; }
    if (pathname === '/api/admin-login' && req.method === 'POST') { handleAdminLogin(req, res); return; }
    
    // 3. PROTEKSI ADMIN
    if (pathname.startsWith('/admin-orders') || pathname.startsWith('/api/admin/')) {
        const adminSession = sessions[cookies.adminSessionId];
        if (!adminSession || !adminSession.loggedIn) {
            res.writeHead(302, { 'Location': '/admin-login-page' });
            res.end();
            return;
        }
    }
    
    // 4. RUTE ADMIN TERPROTEKSI
    if (pathname === '/admin-orders') { serveStaticFile(path.join(__dirname, 'pages', 'admin-panel.html'), res); return; }
    if (pathname === '/api/admin/get-orders' && req.method === 'GET') { handleGetAdminOrders(req, res); return; }
    if (pathname === '/api/admin/process-order' && req.method === 'POST') { handleProcessAdminOrder(req, res); return; }
    if (pathname === '/api/admin/update-note' && req.method === 'POST') { handleUpdateNote(req, res); return; }
    if (pathname === '/api/admin/process-all-pending' && req.method === 'POST') { handleProcessAllPending(req, res); return; }

    // 5. FILE STATIS LAINNYA
    let safePath = pathname === '/' ? 'index.html' : pathname.substring(1);
    try { safePath = decodeURIComponent(safePath); } catch (e) { res.writeHead(400, { 'Content-Type': 'text/html' }); res.end('<h1>400 Bad Request</h1>'); return; }
    const filePath = path.join(__dirname, safePath);
    if (!filePath.startsWith(__dirname)) { res.writeHead(403, { 'Content-Type': 'text/html' }); res.end('<h1>403 Forbidden</h1>'); return; }
    serveStaticFile(filePath, res);
});


// === HANDLER UNTUK SETIAP RUTE ===
function handleNewOrderNotification(req, res, userSessionId) {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
        try {
            const orderDetails = JSON.parse(body);
            orderDetails.id = Date.now().toString() + Math.random().toString(36).substring(2, 9);
            orderDetails.timestamp = Date.now();
            orderDetails.statusInternal = 'menunggu_verifikasi';
            orderDetails.userSessionId = userSessionId;
            orderDetails.adminErrorMessage = '';
            orderDetails.customerErrorMessage = '';
            orderDetails.customAdminNote = '';
            pendingOrders.push(orderDetails);
            
            const title = "Pesanan Baru Masuk!";
            const message = `${orderDetails.nominal} untuk ${orderDetails.phoneNumber || orderDetails.userId || 'Pelanggan'}`;
            const clickUrl = `${DEPLOYED_URL}/admin-orders`;
            sendNtfyNotification(title, message, clickUrl);
            
            console.log(`[BACKEND] Pesanan ${orderDetails.code} diterima dari sesi ${userSessionId}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, orderId: orderDetails.id }));
        } catch (error) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: 'Format data tidak valid.' })); }
    });
}
// ... Sisa fungsi handler tidak berubah ...
// Fungsi-fungsi lain (handleGetHarga, handleGetGameProducts, dll) disalin dari versi sebelumnya
// Pastikan semua fungsi handler ada di sini.

function handleGetMyOrders(req, res, userSessionId) {
    if (!userSessionId) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify([])); return; }
    const userOrders = pendingOrders.filter(order => order.userSessionId === userSessionId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(userOrders));
}

function handleAdminLogin(req, res) {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
        const { username, password } = JSON.parse(body);
        if (username === ADMIN_USER && password === ADMIN_PASS) {
            const adminSessionId = crypto.randomBytes(16).toString('hex');
            sessions[adminSessionId] = { loggedIn: true, user: username };
            res.setHeader('Set-Cookie', `adminSessionId=${adminSessionId}; HttpOnly; Path=/; Max-Age=3600; SameSite=None; Secure`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, redirectTo: '/admin-orders' }));
        } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Username atau password salah.' }));
        }
    });
}

function handleGetHarga(req, res) {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
        try {
            const { provider } = JSON.parse(body);
            const vipaymentBrandMapping = { 'Telkomsel': 'TELKOMSEL', 'XL Axiata': 'XL', 'Smartfren': 'SMARTFREN', 'Indosat': 'INDOSAT', 'Axis': 'AXIS', 'Three': 'TRI' };
            const vipaymentBrand = vipaymentBrandMapping[provider];
            if (!vipaymentBrand) throw new Error('Provider tidak dikenali.');
            const vipaymentApiParams = { key: VIPAYMENT_API_KEY, sign: generateVipaymentSign(), type: 'services', filter_type: 'brand', filter_value: vipaymentBrand };
            const requestBody = new URLSearchParams(vipaymentApiParams).toString();
            const options = { hostname: 'vip-reseller.co.id', port: 443, path: '/api/prepaid', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(requestBody) }, timeout: 15000 };
            const vipReq = https.request(options, (vipRes) => {
                let vipaymentApiResponse = '';
                vipRes.on('data', (d) => { vipaymentApiResponse += d; });
                vipRes.on('end', () => {
                    try {
                        const apiResponse = JSON.parse(vipaymentApiResponse);
                        if (apiResponse.result === true && apiResponse.data) {
                            const pulsaNominalList = [], paketDataList = [];
                            apiResponse.data.forEach(service => {
                                const isPulsa = !/gb|paket|data|internet|kuota|voucher|masa aktif|play|sms|telepon|telpon/i.test(service.name.toLowerCase());
                                const formattedService = { nominal: service.name, harga: `Rp ${service.price.basic.toLocaleString('id-ID')}`, code: service.code, status: service.status };
                                if (isPulsa) pulsaNominalList.push(formattedService);
                                else paketDataList.push(formattedService);
                            });
                            const responseData = {};
                            if (pulsaNominalList.length > 0) responseData.pulsaNominal = pulsaNominalList;
                            if (paketDataList.length > 0) responseData.paketData = paketDataList;
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify(responseData));
                        } else { throw new Error(apiResponse.message || 'Respons tidak valid dari VIPayment.'); }
                    } catch (e) { if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Gagal memproses respons dari penyedia.' })); } }
                });
            });
            vipReq.on('error', (e) => { if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: `Gagal terhubung ke server penyedia: ${e.message}` })); } });
            vipReq.on('timeout', () => { vipReq.destroy(); });
            vipReq.write(requestBody);
            vipReq.end();
        } catch (error) { if (!res.headersSent) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); } }
    });
}
function handleGetGameProducts(req, res) {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
        try {
            const { gameCode } = JSON.parse(body);
            const gameBrandMapping = {
                'MLBB': 'MOBILE LEGENDS', 'FREEFIRE': 'FREE FIRE', 'FFMAX': 'FREE FIRE',
                'PUBGM': 'PUBG MOBILE', 'HOK': 'HONOR OF KINGS', 'GENSHIN': 'GENSHIN IMPACT',
                'VALORANT': 'VALORANT', 'TOF': 'TOWER OF FANTASY', 'ZEPETO': 'ZEPETO'
            };
            const vipaymentBrand = gameBrandMapping[gameCode];
            if (!vipaymentBrand) throw new Error(`Game dengan kode '${gameCode}' tidak ditemukan.`);

            const vipaymentApiParams = { key: VIPAYMENT_API_KEY, sign: generateVipaymentSign(), type: 'services', filter_type: 'brand', filter_value: vipaymentBrand };
            const requestBody = new URLSearchParams(vipaymentApiParams).toString();
            const options = { hostname: 'vip-reseller.co.id', port: 443, path: '/api/prepaid', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(requestBody) }, timeout: 15000 };
            const vipReq = https.request(options, (vipRes) => {
                let vipaymentApiResponse = '';
                vipRes.on('data', (d) => { vipaymentApiResponse += d; });
                vipRes.on('end', () => {
                    try {
                        const apiResponse = JSON.parse(vipaymentApiResponse);
                        if (apiResponse.result === true && apiResponse.data) {
                            const products = apiResponse.data.map(s => ({ nominal: s.name, harga: `Rp ${s.price.basic.toLocaleString('id-ID')}`, code: s.code, status: s.status }));
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify(products));
                        } else { throw new Error(apiResponse.message || 'Respons tidak valid.'); }
                    } catch (e) { if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Gagal memproses respons.' })); } }
                });
            });
            vipReq.on('error', (e) => { if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: `Gagal terhubung ke penyedia.` })); } });
            vipReq.write(requestBody);
            vipReq.end();
        } catch (error) { if (!res.headersSent) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); } }
    });
}
function handleGetAdminOrders(req, res) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(pendingOrders)); }
function handleProcessAdminOrder(req, res) {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
        let orderIndex = -1;
        try {
            const { id } = JSON.parse(body);
            orderIndex = pendingOrders.findIndex(o => o.id === id);
            if (orderIndex === -1) throw new Error(`Pesanan ID ${id} tidak ditemukan.`);
            const { phoneNumber, code, userId, zoneId, gameCode } = pendingOrders[orderIndex];
            let data_no;
            if(gameCode) {
                switch(gameCode) {
                    case 'MLBB': data_no = `${userId}(${zoneId})`; break;
                    case 'GENSHIN': data_no = `${userId}&zone=${order.server}`; break;
                    case 'VALORANT': data_no = order.riotId; break;
                    default: data_no = userId; break;
                }
            } else { data_no = phoneNumber; }
            if (!code) throw new Error(`Kode Layanan kosong untuk pesanan ID ${id}.`);
            if (!data_no) return reject(new Error(`Data nomor/ID kosong untuk pesanan ID ${orderId}.`));

            pendingOrders[orderIndex].statusInternal = 'memproses';
            const vipaymentOrderParams = { key: VIPAYMENT_API_KEY, sign: generateVipaymentSign(), type: 'order', service: code, data_no: data_no };
            const requestBody = new URLSearchParams(vipaymentOrderParams).toString();
            console.log('[BACKEND ADMIN] Mengirim permintaan:', vipaymentOrderParams);
            const options = { hostname: 'vip-reseller.co.id', port: 443, path: '/api/prepaid', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(requestBody) }, timeout: 20000 };
            const vipReq = https.request(options, (vipRes) => {
                let apiResponseData = '';
                vipRes.on('data', (d) => { apiResponseData += d; });
                vipRes.on('end', () => {
                    try {
                        const apiResponse = JSON.parse(apiResponseData);
                        console.log('[BACKEND ADMIN] Respons VIPayment:', apiResponse);
                        if (apiResponse.result === true && apiResponse.data) {
                            pendingOrders[orderIndex].statusInternal = apiResponse.data.status || 'sukses';
                            pendingOrders[orderIndex].adminErrorMessage = '';
                            pendingOrders[orderIndex].customerErrorMessage = '';
                        } else {
                            pendingOrders[orderIndex].statusInternal = 'error';
                            pendingOrders[orderIndex].adminErrorMessage = apiResponse.message || 'Proses di VIPayment gagal.';
                            pendingOrders[orderIndex].customerErrorMessage = 'Pesanan ditolak oleh sistem.';
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, data: pendingOrders[orderIndex] }));
                    } catch (e) {
                        pendingOrders[orderIndex].statusInternal = 'error';
                        pendingOrders[orderIndex].adminErrorMessage = e.message;
                        pendingOrders[orderIndex].customerErrorMessage = 'Terjadi kesalahan sistem internal.';
                        if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
                    }
                });
            });
            vipReq.on('error', (e) => { throw e; });
            vipReq.setTimeout(options.timeout, () => vipReq.destroy(new Error('Request timeout')));
            vipReq.write(requestBody);
            vipReq.end();
        } catch (error) {
            if (orderIndex !== -1) {
                pendingOrders[orderIndex].statusInternal = 'error';
                pendingOrders[orderIndex].fullErrorMessage = error.message;
            }
            if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: `Kesalahan server: ${error.message}` })); }
        }
    });
}
function handleUpdateNote(req, res) {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
        try {
            const { orderId, note } = JSON.parse(body);
            const orderIndex = pendingOrders.findIndex(o => o.id === orderId);
            if (orderIndex === -1) throw new Error('Pesanan tidak ditemukan.');
            pendingOrders[orderIndex].customAdminNote = note;
            console.log(`[BACKEND ADMIN] Catatan untuk pesanan ${orderId} disimpan: "${note}"`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Catatan berhasil disimpan.'}));
        } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: error.message }));
        }
    });
}
function serveStaticFile(filePath, res) {
    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') { res.writeHead(404, { 'Content-Type': 'text/html' }); res.end(`<h1>404 Not Found</h1><p>File tidak ditemukan: ${path.basename(filePath)}</p>`); }
            else { res.writeHead(500); res.end('Server Error: ' + error.code); }
        } else {
            res.writeHead(200, { 'Content-Type': mimeTypes[extname] || 'application/octet-stream' });
            res.end(content, 'utf-8');
        }
    });
}

// === MULAI SERVER ===
server.listen(port, hostname, () => {
    console.log(`Server berjalan di port ${port}`);
    console.log(`Halaman Login Admin: http://${hostname}:${port}/admin-login-page`);
    console.log(`===================================`);
    console.log(`Username: ${ADMIN_USER}`);
    console.log(`Password: ${ADMIN_PASS}`);
    console.log(`===================================`);
});
