// CF Pages Function: proxy GitHub Device Flow code request (CORS)
var ALLOWED_CLIENT_ID = 'Ov23li7UFjZu0LQmc1Xu';

export async function onRequestPost(context) {
    const body = await context.request.json();
    if (body.client_id !== ALLOWED_CLIENT_ID) {
        return new Response(JSON.stringify({ error: 'invalid_client' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }
    const resp = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    const data = await resp.text();
    return new Response(data, {
        status: resp.status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
    });
}

export async function onRequestOptions() {
    return new Response(null, {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
    });
}
