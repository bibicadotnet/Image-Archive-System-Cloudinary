// Cloudflare Workers Cron Job - Quota Monitor

const TELEGRAM_BOT_TOKEN = 'xxxxx';
const TELEGRAM_CHAT_ID = 'xxxxx';
const QUOTA_LIMIT_GB = 15;

async function checkQuotaAndAlert(env) {
    try {
        // Query tổng dung lượng theo cloud_name
        const results = await env.DB.prepare(`
            SELECT 
                cloud_name,
                SUM(file_size) as total_bytes,
                COUNT(*) as file_count
            FROM images 
            GROUP BY cloud_name
            ORDER BY total_bytes DESC
        `).all();
        
        const alerts = [];
        
        for (const row of results.results) {
            const totalGB = row.total_bytes / (1024 * 1024 * 1024);
            
            if (totalGB > QUOTA_LIMIT_GB) {
                alerts.push(`⚠️ ${row.cloud_name}: ${totalGB.toFixed(2)}GB (${row.file_count} files)`);
            }
        }
        
        if (alerts.length > 0) {
            const message = `🚨 Cloudinary Quota Alert:\n\n${alerts.join('\n')}\n\n⚡ Limit: ${QUOTA_LIMIT_GB}GB per account`;
            await sendTelegramAlert(message);
        } else {
            console.log('All accounts within quota limits');
        }
        
    } catch (error) {
        console.error('Quota check error:', error);
        await sendTelegramAlert(`❌ Quota check failed: ${error.message}`);
    }
}

async function sendTelegramAlert(message) {
    try {
        const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message
            })
        });
        
        if (!response.ok) {
            console.error('Telegram API error:', await response.text());
        }
    } catch (error) {
        console.error('Failed to send Telegram alert:', error);
    }
}

export default {
    // Cron trigger handler
    async scheduled(event, env, ctx) {
        console.log('Running quota check...');
        await checkQuotaAndAlert(env);
    },
    
    async fetch(request, env, ctx) {
        return new Response('Quota Monitor Cron Job', { 
            status: 200,
            headers: { 'Content-Type': 'text/plain' }
        });
    }
};
