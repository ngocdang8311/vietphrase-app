var CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept'
};

function jsonResponse(body, status) {
    return new Response(JSON.stringify(body), {
        status: status || 200,
        headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS)
    });
}

function isAllowedRawUrl(rawUrl) {
    return /^https:\/\/(?:gist\.githubusercontent\.com|raw\.githubusercontent\.com)\//.test(rawUrl);
}

export async function onRequest(context) {
    if (context.request.method === 'OPTIONS') {
        return onRequestOptions();
    }
    if (context.request.method !== 'GET') {
        return jsonResponse({ error: 'method_not_allowed' }, 405);
    }

    var reqUrl = new URL(context.request.url);
    var rawUrl = reqUrl.searchParams.get('url') || '';
    if (!rawUrl || !isAllowedRawUrl(rawUrl)) {
        return jsonResponse({ error: 'invalid_url', error_description: 'url must be a githubusercontent raw URL' }, 400);
    }

    var headers = {};
    var authHeader = context.request.headers.get('Authorization');
    if (authHeader) headers['Authorization'] = authHeader;

    var resp = await fetch(rawUrl, { method: 'GET', headers: headers });
    var text = await resp.text();
    return new Response(text, {
        status: resp.status,
        headers: Object.assign(
            {
                'Content-Type': resp.headers.get('Content-Type') || 'text/plain; charset=utf-8'
            },
            CORS_HEADERS
        )
    });
}

export async function onRequestOptions() {
    return new Response(null, { headers: CORS_HEADERS });
}
