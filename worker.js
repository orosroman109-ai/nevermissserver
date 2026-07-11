// Cloudflare Worker — Discord OAuth2 token exchange
// Deploy: wrangler deploy

const CLIENT_ID = '1525497038094209164';
const CLIENT_SECRET = 'gQ89d9Qjy5G6HhxjgD4WcAkRMv_m-uhH';
const REDIRECT_URI = 'https://orosroman109-ai.github.io/nevermissserver/callback.html';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    try {
      const { code } = await request.json();
      if (!code) {
        return new Response(JSON.stringify({ error: 'Missing code' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // Exchange code for access token
      const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: REDIRECT_URI,
        }),
      });

      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) {
        return new Response(JSON.stringify({ error: 'Token exchange failed', details: tokenData }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // Fetch user info
      const userRes = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      const userData = await userRes.json();
      if (!userRes.ok) {
        return new Response(JSON.stringify({ error: 'Failed to fetch user' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // Build avatar URL
      let avatarUrl = `https://cdn.discordapp.com/embed/avatars/${userData.discriminator === '0' ? (BigInt(userData.id) >> 22n) % 6n : userData.discriminator % 5n}.png`;
      if (userData.avatar) {
        const ext = userData.avatar.startsWith('a_') ? 'gif' : 'png';
        avatarUrl = `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.${ext}`;
      }

      return new Response(JSON.stringify({
        id: userData.id,
        username: userData.username,
        global_name: userData.global_name || userData.username,
        avatar: avatarUrl,
        discriminator: userData.discriminator,
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: 'Internal error', message: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },
};
