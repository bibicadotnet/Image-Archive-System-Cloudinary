// functions/[folder]/[filename].js - Folder-based file proxy

const ABUSE_PROTECTION = {
    MAX_FAILED_READS: 10,
    TIME_WINDOW_MINUTES: 1440,
    BLOCK_DURATION_HOURS: 24,
    get TIME_WINDOW_MS() { return this.TIME_WINDOW_MINUTES * 60 * 1000; },
    get BLOCK_DURATION_MS() { return this.BLOCK_DURATION_HOURS * 60 * 60 * 1000; }
};

async function checkIfBlocked(env, ip) {
    const currentTime = Date.now();
    const record = await env.DB.prepare(`SELECT block_until FROM abuse_blocks WHERE ip = ?`).bind(ip).first();
    return record && currentTime < record.block_until;
}

async function recordFailedRead(env, ip) {
    const currentTime = Date.now();
    const record = await env.DB.prepare(`SELECT failed_count, block_until, last_attempt FROM abuse_blocks WHERE ip = ?`).bind(ip).first();
    
    if (!record) {
        const newCount = 1;
        const blockUntil = newCount >= ABUSE_PROTECTION.MAX_FAILED_READS ? 
            currentTime + ABUSE_PROTECTION.BLOCK_DURATION_MS : 0;
        await env.DB.prepare(`INSERT INTO abuse_blocks (ip, failed_count, block_until, last_attempt) VALUES (?, ?, ?, ?)`).bind(ip, newCount, blockUntil, currentTime).run();
        return;
    }
    
    if (record.block_until > 0 && currentTime > record.block_until) {
        const newCount = 1;
        const blockUntil = newCount >= ABUSE_PROTECTION.MAX_FAILED_READS ? 
            currentTime + ABUSE_PROTECTION.BLOCK_DURATION_MS : 0;
        await env.DB.prepare(`UPDATE abuse_blocks SET failed_count = ?, block_until = ?, last_attempt = ? WHERE ip = ?`).bind(newCount, blockUntil, currentTime, ip).run();
        return;
    }
    
    if (currentTime > (record.last_attempt + ABUSE_PROTECTION.TIME_WINDOW_MS)) {
        const newCount = 1;
        const blockUntil = newCount >= ABUSE_PROTECTION.MAX_FAILED_READS ? 
            currentTime + ABUSE_PROTECTION.BLOCK_DURATION_MS : 0;
        await env.DB.prepare(`UPDATE abuse_blocks SET failed_count = ?, block_until = ?, last_attempt = ? WHERE ip = ?`).bind(newCount, blockUntil, currentTime, ip).run();
        return;
    }
    
    const newCount = record.failed_count + 1;
    const blockUntil = newCount >= ABUSE_PROTECTION.MAX_FAILED_READS ? 
        currentTime + ABUSE_PROTECTION.BLOCK_DURATION_MS : 0;
    await env.DB.prepare(`UPDATE abuse_blocks SET failed_count = ?, block_until = ?, last_attempt = ? WHERE ip = ?`).bind(newCount, blockUntil, currentTime, ip).run();
}

async function recordBlockedAccess(env, ip) {
    const currentTime = Date.now();
    await env.DB.prepare(`UPDATE abuse_blocks SET last_attempt = ? WHERE ip = ?`).bind(currentTime, ip).run();
}

export async function onRequestGet(context) {
    const { params, env, request } = context;
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    
    if (await checkIfBlocked(env, ip)) {
        await recordBlockedAccess(env, ip);
        return new Response(JSON.stringify({
            error: 'IP blocked due to abuse',
            retry_after: ABUSE_PROTECTION.BLOCK_DURATION_HOURS + ' hours'
        }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const folder = params.folder;
    
    if (folder === 'upload' || folder === 'api') {
        await recordFailedRead(env, ip);
        return new Response(JSON.stringify({ error: 'Not Found' }), { 
            status: 404,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    
    const filename = params.filename.split('?')[0];
    
    if (!filename.includes('.')) {
        await recordFailedRead(env, ip);
        return new Response(JSON.stringify({ error: 'Not Found' }), { 
            status: 404,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const image = await env.DB.prepare(`
            SELECT cloudinary_url FROM images WHERE folder = ? AND filename = ?
        `).bind(folder, filename).first();

        if (!image) {
            await recordFailedRead(env, ip);
            return new Response(JSON.stringify({ error: 'Image not found' }), { 
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const optimizedUrl = `https://i0.wp.com/${image.cloudinary_url.replace('https://', '')}`;
        const imageResponse = await fetch(optimizedUrl, {
            headers: {
                'User-Agent': 'Image-Archive-System/v2'
            }
        });

        return new Response(imageResponse.body, {
            headers: {
                'Content-Type': imageResponse.headers.get('Content-Type') || 'image/jpeg',
                'Cache-Control': 'public, max-age=31536000',
                'Access-Control-Allow-Origin': '*'
            }
        });

    } catch (error) {
        console.error('Folder image proxy error:', error);
        await recordFailedRead(env, ip);
        return new Response(JSON.stringify({ error: 'Server error: ' + error.message }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
