// CF Pages Function: proxy fetch for crawler
// GET /api/fetch-page?url=<encoded_url>
// Fetches URL, detects charset, returns UTF-8 HTML with CORS headers

var CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

function jsonError(message, status) {
    return new Response(JSON.stringify({ error: true, message: message }), {
        status: status,
        headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS)
    });
}

// Block private/reserved IPs
function isPrivateUrl(urlStr) {
    try {
        var u = new URL(urlStr);
        var host = u.hostname;
        // Block non-HTTP schemes
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
        // Block localhost
        if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true;
        // Block private IP ranges
        var parts = host.split('.');
        if (parts.length === 4) {
            var a = parseInt(parts[0], 10);
            var b = parseInt(parts[1], 10);
            if (a === 10) return true;
            if (a === 172 && b >= 16 && b <= 31) return true;
            if (a === 192 && b === 168) return true;
            if (a === 169 && b === 254) return true;
            if (a === 0) return true;
        }
        return false;
    } catch (e) {
        return true;
    }
}

// Detect charset from Content-Type header or <meta> tags in first 2KB
function detectCharset(contentType, headBytes) {
    // 1. Content-Type header
    if (contentType) {
        var m = contentType.match(/charset=([^\s;]+)/i);
        if (m) return m[1].trim().toLowerCase();
    }
    // 2. Scan first bytes for <meta charset> or <meta http-equiv="content-type">
    var snippet = '';
    try {
        snippet = new TextDecoder('ascii', { fatal: false }).decode(headBytes).toLowerCase();
    } catch (e) {}
    // <meta charset="gbk">
    var m2 = snippet.match(/<meta[^>]+charset=["']?([^"'\s;>]+)/i);
    if (m2) return m2[1].trim();
    // <meta http-equiv="content-type" content="text/html; charset=gb2312">
    var m3 = snippet.match(/content=["'][^"']*charset=([^"'\s;]+)/i);
    if (m3) return m3[1].trim();
    // Default
    return 'utf-8';
}

export async function onRequest(context) {
    if (context.request.method === 'OPTIONS') {
        return new Response(null, { headers: CORS_HEADERS });
    }
    if (context.request.method !== 'GET') {
        return jsonError('Method not allowed', 405);
    }

    var reqUrl = new URL(context.request.url);
    var targetUrl = reqUrl.searchParams.get('url');

    if (!targetUrl) {
        return jsonError('Missing url parameter', 400);
    }

    // Ensure protocol
    if (!/^https?:\/\//i.test(targetUrl)) {
        targetUrl = 'http://' + targetUrl;
    }

    if (isPrivateUrl(targetUrl)) {
        return jsonError('URL not allowed', 400);
    }

    try {
        var resp = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,*/*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5'
            },
            redirect: 'follow',
            cf: { cacheTtl: 300 }
        });

        if (!resp.ok) {
            return jsonError('Upstream returned ' + resp.status, 502);
        }

        var buf = await resp.arrayBuffer();
        var headBytes = buf.slice(0, 2048);
        var ct = resp.headers.get('Content-Type') || '';
        var charset = detectCharset(ct, new Uint8Array(headBytes));

        var html;
        try {
            html = new TextDecoder(charset, { fatal: false }).decode(buf);
        } catch (e) {
            // Fallback to utf-8
            html = new TextDecoder('utf-8', { fatal: false }).decode(buf);
        }

        return new Response(html, {
            status: 200,
            headers: Object.assign({
                'Content-Type': 'text/html; charset=utf-8',
                'X-Source-Charset': charset,
                'X-Source-Url': targetUrl
            }, CORS_HEADERS)
        });
    } catch (err) {
        return jsonError('Fetch failed: ' + (err.message || 'unknown error'), 504);
    }
}
