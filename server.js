// server.js

const DEFAULT_CONFIG = {
    CORS: {
        ALLOWED_ORIGINS: [
            'https://img.bibica.net',
        ]
    },
    RATE_LIMIT: {
        MAX_REQUESTS: 20,
        TIME_WINDOW_MINUTES: 5,
    },
    FILE: {
        MAX_SIZE_MB: 10,
        ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff', 'image/webp']
    },
    PATH: {
        FOLDER_LENGTH: 0,
        FILENAME_LENGTH: 8,
    },
    ABUSE_PROTECTION: {
        MAX_FAILED_READS: 50,
        TIME_WINDOW_MINUTES: 1440,
        BLOCK_DURATION_HOURS: 24,
    },
};

// Hard-coded accounts array - format: [cloud_name, api_key, api_secret]
const CLOUDINARY_ACCOUNTS = [
    ["cloud_name_1", "api_key_1", "api_secret_1"], 
    ["cloud_name_2", "api_key_2", "api_secret_2"],

];


const CONFIG = {
    CORS: DEFAULT_CONFIG.CORS,
    RATE_LIMIT: {
        MAX_REQUESTS: DEFAULT_CONFIG.RATE_LIMIT.MAX_REQUESTS,
        TIME_WINDOW_MINUTES: DEFAULT_CONFIG.RATE_LIMIT.TIME_WINDOW_MINUTES,
        TIME_WINDOW_MS: DEFAULT_CONFIG.RATE_LIMIT.TIME_WINDOW_MINUTES * 60 * 1000
    },
    FILE: {
        MAX_SIZE_MB: DEFAULT_CONFIG.FILE.MAX_SIZE_MB,
        MAX_SIZE_BYTES: DEFAULT_CONFIG.FILE.MAX_SIZE_MB * 1024 * 1024,
        ALLOWED_TYPES: DEFAULT_CONFIG.FILE.ALLOWED_TYPES
    },
    PATH: DEFAULT_CONFIG.PATH,
    ABUSE_PROTECTION: {
        MAX_FAILED_READS: DEFAULT_CONFIG.ABUSE_PROTECTION.MAX_FAILED_READS,
        TIME_WINDOW_MINUTES: DEFAULT_CONFIG.ABUSE_PROTECTION.TIME_WINDOW_MINUTES,
        TIME_WINDOW_MS: DEFAULT_CONFIG.ABUSE_PROTECTION.TIME_WINDOW_MINUTES * 60 * 1000,
        BLOCK_DURATION_HOURS: DEFAULT_CONFIG.ABUSE_PROTECTION.BLOCK_DURATION_HOURS,
        BLOCK_DURATION_MS: DEFAULT_CONFIG.ABUSE_PROTECTION.BLOCK_DURATION_HOURS * 60 * 60 * 1000
    },
};

function getCorsHeaders(origin) {
    return CONFIG.CORS.ALLOWED_ORIGINS.includes(origin) ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin'
    } : {};
}

function getCloudinaryAccount(env, index) {
    const count = CLOUDINARY_ACCOUNTS.length;
    if (count === 0) throw new Error('No Cloudinary accounts configured');
    
    const id = Number(index);
    const safeIndex = (index == null || index === '' || isNaN(id) || id < 0 || id >= count) ? 
        Math.floor(Math.random() * count) : id;
    
    const [cloud_name, api_key, api_secret] = CLOUDINARY_ACCOUNTS[safeIndex];
    
    return {
        cloud_name,
        api_key,
        api_secret,
        index: safeIndex
    };
}

async function checkRateLimit(env, ip) {
    const currentTime = Date.now();
    const resetTime = currentTime + CONFIG.RATE_LIMIT.TIME_WINDOW_MS;
    
    try {
        const result = await env.DB.prepare(`
            INSERT INTO rate_limits (ip, count, reset_time) 
            VALUES (?, 1, ?)
            ON CONFLICT(ip) DO UPDATE SET
                count = CASE 
                    WHEN reset_time <= ? THEN 1
                    WHEN count < ? THEN count + 1
                    ELSE count
                END,
                reset_time = CASE
                    WHEN reset_time <= ? THEN ?
                    ELSE reset_time
                END
            WHERE reset_time <= ? OR count < ?
            RETURNING count, reset_time
        `).bind(
            ip, resetTime, 
            currentTime, CONFIG.RATE_LIMIT.MAX_REQUESTS,
            currentTime, resetTime,
            currentTime, CONFIG.RATE_LIMIT.MAX_REQUESTS
        ).first();
        
        if (!result) {
            return { allowed: false };
        }
        
        return { allowed: true };
        
    } catch (error) {
        console.error('Rate limit check error:', error);
        
        try {
            const current = await env.DB.prepare(`
                SELECT count, reset_time FROM rate_limits WHERE ip = ?
            `).bind(ip).first();
            
            if (!current || currentTime > current.reset_time) {
                await env.DB.prepare(`
                    INSERT OR REPLACE INTO rate_limits (ip, count, reset_time) VALUES (?, 1, ?)
                `).bind(ip, resetTime).run();
                return { allowed: true };
            }
            
            if (current.count >= CONFIG.RATE_LIMIT.MAX_REQUESTS) {
                return { allowed: false };
            }
            
            const updateResult = await env.DB.prepare(`
                UPDATE rate_limits 
                SET count = count + 1 
                WHERE ip = ? AND count = ? AND count < ?
            `).bind(ip, current.count, CONFIG.RATE_LIMIT.MAX_REQUESTS).run();
            
            return { allowed: updateResult.changes > 0 };
            
        } catch (fallbackError) {
            console.error('Fallback error:', fallbackError);
            return { allowed: false };
        }
    }
}

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
        const blockUntil = newCount >= CONFIG.ABUSE_PROTECTION.MAX_FAILED_READS ? 
            currentTime + CONFIG.ABUSE_PROTECTION.BLOCK_DURATION_MS : 0;
        await env.DB.prepare(`INSERT INTO abuse_blocks (ip, failed_count, block_until, last_attempt) VALUES (?, ?, ?, ?)`).bind(ip, newCount, blockUntil, currentTime).run();
        return;
    }
    
    if (record.block_until > 0 && currentTime > record.block_until) {
        const newCount = 1;
        const blockUntil = newCount >= CONFIG.ABUSE_PROTECTION.MAX_FAILED_READS ? 
            currentTime + CONFIG.ABUSE_PROTECTION.BLOCK_DURATION_MS : 0;
        await env.DB.prepare(`UPDATE abuse_blocks SET failed_count = ?, block_until = ?, last_attempt = ? WHERE ip = ?`).bind(newCount, blockUntil, currentTime, ip).run();
        return;
    }
    
    if (currentTime > (record.last_attempt + CONFIG.ABUSE_PROTECTION.TIME_WINDOW_MS)) {
        const newCount = 1;
        const blockUntil = newCount >= CONFIG.ABUSE_PROTECTION.MAX_FAILED_READS ? 
            currentTime + CONFIG.ABUSE_PROTECTION.BLOCK_DURATION_MS : 0;
        await env.DB.prepare(`UPDATE abuse_blocks SET failed_count = ?, block_until = ?, last_attempt = ? WHERE ip = ?`).bind(newCount, blockUntil, currentTime, ip).run();
        return;
    }
    
    const newCount = record.failed_count + 1;
    const blockUntil = newCount >= CONFIG.ABUSE_PROTECTION.MAX_FAILED_READS ? 
        currentTime + CONFIG.ABUSE_PROTECTION.BLOCK_DURATION_MS : 0;
    await env.DB.prepare(`UPDATE abuse_blocks SET failed_count = ?, block_until = ?, last_attempt = ? WHERE ip = ?`).bind(newCount, blockUntil, currentTime, ip).run();
}

async function generateCloudinarySignature(params, apiSecret) {
    const sortedParams = Object.keys(params)
        .filter(key => key !== 'api_key' && key !== 'file')
        .sort()
        .map(key => `${key}=${params[key]}`)
        .join('&');

    const encoder = new TextEncoder();
    const data = encoder.encode(sortedParams + apiSecret);
    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function uploadToCloudinary(account, file, folder, filename) {
    const timestamp = Math.round(Date.now() / 1000);
    const publicId = folder ? `${folder}/${filename}` : filename;
    const params = { public_id: publicId, timestamp, backup: false };
    const signature = await generateCloudinarySignature(params, account.api_secret);

    const formData = new FormData();
    formData.append('file', new Blob([await file.arrayBuffer()], { type: file.type }));
    formData.append('public_id', publicId);
    formData.append('timestamp', timestamp.toString());
    formData.append('api_key', account.api_key);
    formData.append('signature', signature);
    formData.append('backup', 'false');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
        const response = await fetch(`https://api.cloudinary.com/v1_1/${account.cloud_name}/image/upload`, {
            method: 'POST',
            body: formData,
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
        return await response.json();
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

async function uploadToCloudinaryWithRetry(account, file, folder, filename, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await uploadToCloudinary(account, file, folder, filename);
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
}

function generateRandomString(length) {
    if (length === 0) return '';
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    for (let i = 0; i < length; i++) {
        result += chars.charAt(array[i] % chars.length);
    }
    return result;
}

function getFileExtension(filename) {
    if (!filename) return 'bin';
    const parts = filename.toLowerCase().split('.');
    return parts.length > 1 ? parts.pop() : 'bin';
}

async function optimizeImage(account, folder, filename, cloudinaryUrl, contentType) {
    try {
        const jetpackUrl = `https://i0.wp.com/${cloudinaryUrl.replace('https://', '')}`;
        const optimizedResponse = await fetch(jetpackUrl, { signal: AbortSignal.timeout(60000) });
        
        if (!optimizedResponse.ok) return;
        
        const optimizedBuffer = await optimizedResponse.arrayBuffer();
        const timestamp = Math.round(Date.now() / 1000);
        const publicId = folder ? `${folder}/${filename}` : filename;
        const params = { public_id: publicId, timestamp, overwrite: true, backup: false };
        const signature = await generateCloudinarySignature(params, account.api_secret);
        
        const formData = new FormData();
        formData.append('file', new Blob([optimizedBuffer], { type: contentType }));
        formData.append('public_id', publicId);
        formData.append('timestamp', timestamp.toString());
        formData.append('api_key', account.api_key);
        formData.append('signature', signature);
        formData.append('overwrite', 'true');
        formData.append('backup', 'false');
        
        await fetch(`https://api.cloudinary.com/v1_1/${account.cloud_name}/image/upload`, {
            method: 'POST',
            body: formData,
            signal: AbortSignal.timeout(60000)
        });
    } catch (error) {
        console.error('Optimization failed:', error);
    }
}

export async function onRequest(context) {
    const { request } = context;
    const origin = request.headers.get('Origin');
    
    if (request.method === 'OPTIONS') {
        const corsHeaders = getCorsHeaders(origin);
        return Object.keys(corsHeaders).length === 0 ? 
            new Response('Forbidden', { status: 403 }) :
            new Response(null, { status: 200, headers: corsHeaders });
    }
    
    if (request.method === 'POST') {
        return onRequestPost(context);
    } else if (request.method === 'GET') {
        return onRequestGet(context);
    } else {
        const corsHeaders = getCorsHeaders(origin);
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { 
            status: 405,
            headers: { 'Content-Type': 'application/json', 'Allow': 'GET, POST', ...corsHeaders }
        });
    }
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const origin = request.headers.get('Origin');
    const corsHeaders = getCorsHeaders(origin);
    
    try {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        
        if (await checkIfBlocked(env, ip)) {
            // Calculate remaining block time
            const blockRecord = await env.DB.prepare(`SELECT block_until FROM abuse_blocks WHERE ip = ?`).bind(ip).first();
            const remainingTimeMs = blockRecord ? blockRecord.block_until - Date.now() : CONFIG.ABUSE_PROTECTION.BLOCK_DURATION_MS;
            const remainingHours = Math.ceil(remainingTimeMs / (60 * 60 * 1000));
            
            return new Response(JSON.stringify({
                error: `IP blocked due to abuse. You can try again after ${remainingHours} hours.`
            }), {
                status: 429,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
        }

        const rateLimitResult = await checkRateLimit(env, ip);
        if (!rateLimitResult.allowed) {
            // Calculate remaining time until rate limit reset
            const rateRecord = await env.DB.prepare(`SELECT reset_time FROM rate_limits WHERE ip = ?`).bind(ip).first();
            const resetTimeMs = rateRecord ? rateRecord.reset_time - Date.now() : CONFIG.RATE_LIMIT.TIME_WINDOW_MS;
            const resetMinutes = Math.ceil(resetTimeMs / (60 * 1000));
            
            return new Response(JSON.stringify({
                error: `Rate limit exceeded (${CONFIG.RATE_LIMIT.MAX_REQUESTS}/${CONFIG.RATE_LIMIT.MAX_REQUESTS}). You can try again after ${resetMinutes} minutes.`
            }), {
                status: 429,
                headers: { 
                    'Content-Type': 'application/json',
                    'Retry-After': String(Math.ceil(resetTimeMs / 1000)),
                    ...corsHeaders 
                }
            });
        }

        const contentLength = parseInt(request.headers.get('Content-Length') || '0');
        if (contentLength > CONFIG.FILE.MAX_SIZE_BYTES) {
            return new Response(JSON.stringify({
                error: `File too large (max ${CONFIG.FILE.MAX_SIZE_MB}MB)`
            }), {
                status: 413,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
        }

        const formData = await request.formData();
        const file = formData.get('file');

        if (!file || !(file instanceof File)) {
            return new Response(JSON.stringify({ error: 'No file provided' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
        }

        if (!CONFIG.FILE.ALLOWED_TYPES.includes(file.type)) {
            return new Response(JSON.stringify({ 
                error: 'Invalid file type. Only JPEG, PNG, GIF, BMP, TIFF, and WebP are allowed'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
        }

        const account = getCloudinaryAccount(env, null);
        const folder = generateRandomString(CONFIG.PATH.FOLDER_LENGTH);
        const filename = `${generateRandomString(CONFIG.PATH.FILENAME_LENGTH)}.${getFileExtension(file.name)}`;

        const cloudinaryResult = await uploadToCloudinaryWithRetry(account, file, folder, filename);
        
        await env.DB.prepare(
            `INSERT INTO images (folder, filename, cloudinary_url, file_size, cloud_name)
            VALUES (?, ?, ?, ?, ?)`
        ).bind(folder || '', filename, cloudinaryResult.secure_url, file.size, account.cloud_name).run();

        context.waitUntil(optimizeImage(account, folder, filename, cloudinaryResult.secure_url, file.type));

        return new Response(JSON.stringify({
            success: true,
            folder: folder || '',
            filename: filename,
        }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
    } catch (err) {
        console.error('Upload error:', err);
        
        if (err.name === 'TypeError' && err.message.includes('Failed to parse body')) {
            return new Response(JSON.stringify({ error: 'Request body too large or malformed' }), {
                status: 413,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
        }
        
        return new Response(JSON.stringify({ error: 'Server error: ' + err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
    }
}
