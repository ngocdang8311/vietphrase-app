// CF Pages Function: proxy GitHub Device Flow token poll (CORS + inject client_secret)
export async function onRequestPost(context) {
    if (!context.env.GITHUB_CLIENT_SECRET) {
        return new Response(JSON.stringify({ error: 'server_misconfigured', error_description: 'GITHUB_CLIENT_SECRET not set' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }

    const reqBody = await context.request.json();
    reqBody.client_secret = context.env.GITHUB_CLIENT_SECRET;

    const resp = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(reqBody)
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
