var CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept'
};

function jsonResponse(body, status) {
    return new Response(JSON.stringify(body), {
        status: status || 200,
        headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS)
    });
}

export async function onRequest(context) {
    if (context.request.method === 'OPTIONS') {
        return onRequestOptions();
    }

    var url = new URL(context.request.url);
    var path = url.searchParams.get('path') || '';
    if (!path || path.indexOf('/gists') !== 0) {
        return jsonResponse({ error: 'invalid_path', error_description: 'path must start with /gists' }, 400);
    }

    var targetUrl = 'https://api.github.com' + path;
    var headers = {
        'Accept': context.request.headers.get('Accept') || 'application/vnd.github+json',
        'User-Agent': 'vietphrase-sync'
    };
    var authHeader = context.request.headers.get('Authorization');
    if (authHeader) headers['Authorization'] = authHeader;
    var contentType = context.request.headers.get('Content-Type');
    if (contentType) headers['Content-Type'] = contentType;

    var init = {
        method: context.request.method,
        headers: headers
    };
    if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
        init.body = await context.request.text();
    }

    var resp = await fetch(targetUrl, init);
    var data = await resp.text();
    return new Response(data, {
        status: resp.status,
        headers: Object.assign(
            {
                'Content-Type': resp.headers.get('Content-Type') || 'application/json'
            },
            CORS_HEADERS
        )
    });
}

export async function onRequestOptions() {
    return new Response(null, { headers: CORS_HEADERS });
}
