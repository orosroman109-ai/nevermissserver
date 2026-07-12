// Cloudflare Worker — Discord OAuth2 + User Registry API
// Deploy: wrangler deploy

const CLIENT_ID = '1525497038094209164';
const CLIENT_SECRET = 'gQ89d9Qjy5G6HhxjgD4WcAkRMv_m-uhH';
const REDIRECT_URI = 'https://orosroman109-ai.github.io/nevermissserver/callback.html';

const GITHUB_REPO = 'orosroman109-ai/nevermissserver';
const GITHUB_API = 'https://api.github.com';
const DATA_FILE = 'data.json';

const ADMIN_USERNAMES = ['nevermissserver_owner', 'nevermisssserver_owner', 'orosroman109'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ===== GitHub Data Store =====
async function getDataFile(token) {
  try {
    const res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/contents/${DATA_FILE}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'nevermiss-worker',
      },
    });
    if (!res.ok) return { content: { users: [], bannedIPs: [] }, sha: null };
    const file = await res.json();
    const decoded = atob(file.content.replace(/\n/g, ''));
    const content = JSON.parse(decoded);
    if (!content.bannedIPs) content.bannedIPs = [];
    return { content, sha: file.sha };
  } catch (e) {
    return { content: { users: [], bannedIPs: [] }, sha: null };
  }
}

async function saveDataFile(data, sha, token) {
  const body = {
    message: 'Update user registry',
    content: btoa(JSON.stringify(data, null, 2)),
  };
  if (sha) body.sha = sha;

  const res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/contents/${DATA_FILE}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'nevermiss-worker',
    },
    body: JSON.stringify(body),
  });
  return res.ok;
}

function isAdminUser(userId, username) {
  if (username) {
    const u = username.toLowerCase();
    for (const a of ADMIN_USERNAMES) {
      if (u === a.toLowerCase()) return true;
    }
  }
  return false;
}

function getClientIP(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
}

const jsonResp = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const GITHUB_TOKEN = env.GITHUB_TOKEN;
    const url = new URL(request.url);

    // ===== GET /api/users =====
    if (request.method === 'GET' && url.pathname === '/api/users') {
      const { content } = await getDataFile(GITHUB_TOKEN);
      return jsonResp(content.users || []);
    }

    // ===== GET /api/bans — return banned users + banned IPs =====
    if (request.method === 'GET' && url.pathname === '/api/bans') {
      const { content } = await getDataFile(GITHUB_TOKEN);
      const bannedUsers = (content.users || []).filter(u => u.banned).map(u => ({
        id: u.id, username: u.username, global_name: u.global_name, ip: u.ip || null,
        banReason: u.banReason, bannedBy: u.bannedBy, bannedAt: u.bannedAt,
      }));
      return jsonResp({ bannedUsers, bannedIPs: content.bannedIPs || [] });
    }

    // ===== POST /api/register — captures IP automatically =====
    if (request.method === 'POST' && url.pathname === '/api/register') {
      try {
        const { user } = await request.json();
        if (!user || !user.id || !user.username) {
          return jsonResp({ error: 'Missing user data' }, 400);
        }

        const clientIP = getClientIP(request);
        const { content, sha } = await getDataFile(GITHUB_TOKEN);
        if (!content.users) content.users = [];
        if (!content.bannedIPs) content.bannedIPs = [];

        // Check IP ban
        if (content.bannedIPs.includes(clientIP)) {
          return jsonResp({ banned: true, banReason: 'Your IP address has been banned.', bannedBy: 'admin' }, 403);
        }

        const existing = content.users.find(u => u.id === user.id);
        if (existing) {
          // If user is banned, block them
          if (existing.banned) {
            return jsonResp({ banned: true, banReason: existing.banReason || 'You are banned.', bannedBy: existing.bannedBy || 'admin' }, 403);
          }
          existing.username = user.username;
          existing.global_name = user.global_name || '';
          existing.avatar = user.avatar || '';
          existing.ip = clientIP;
          existing.lastLogin = new Date().toISOString();
        } else {
          content.users.push({
            id: user.id,
            username: user.username,
            global_name: user.global_name || '',
            avatar: user.avatar || '',
            ip: clientIP,
            joinedAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            banned: false,
            banReason: '',
            bannedBy: '',
            bannedAt: '',
          });
        }

        await saveDataFile(content, sha, GITHUB_TOKEN);
        return jsonResp({ ok: true, total: content.users.length, ip: clientIP });
      } catch (e) {
        return jsonResp({ error: e.message }, 500);
      }
    }

    // ===== POST /api/ban — ban user by ID, also bans their IP =====
    if (request.method === 'POST' && url.pathname === '/api/ban') {
      try {
        const { userId, bannedBy, reason } = await request.json();
        if (!userId || !bannedBy) {
          return jsonResp({ error: 'Missing userId or bannedBy' }, 400);
        }

        if (!isAdminUser(null, bannedBy)) {
          return jsonResp({ error: 'Not authorized' }, 403);
        }

        const { content, sha } = await getDataFile(GITHUB_TOKEN);
        if (!content.users) content.users = [];
        if (!content.bannedIPs) content.bannedIPs = [];

        const user = content.users.find(u => u.id === userId);
        if (!user) return jsonResp({ error: 'User not found' }, 404);

        user.banned = true;
        user.banReason = reason || '';
        user.bannedBy = bannedBy;
        user.bannedAt = new Date().toISOString();

        // Also ban their IP if available
        if (user.ip && user.ip !== 'unknown') {
          if (!content.bannedIPs.includes(user.ip)) {
            content.bannedIPs.push(user.ip);
          }
        }

        await saveDataFile(content, sha, GITHUB_TOKEN);
        return jsonResp({ ok: true, bannedIP: user.ip || null });
      } catch (e) {
        return jsonResp({ error: e.message }, 500);
      }
    }

    // ===== POST /api/unban — unban user by ID, removes their IP from ban list =====
    if (request.method === 'POST' && url.pathname === '/api/unban') {
      try {
        const { userId, unbannedBy } = await request.json();
        if (!userId || !unbannedBy) {
          return jsonResp({ error: 'Missing userId or unbannedBy' }, 400);
        }

        if (!isAdminUser(null, unbannedBy)) {
          return jsonResp({ error: 'Not authorized' }, 403);
        }

        const { content, sha } = await getDataFile(GITHUB_TOKEN);
        if (!content.users) content.users = [];
        if (!content.bannedIPs) content.bannedIPs = [];

        const user = content.users.find(u => u.id === userId);
        if (!user) return jsonResp({ error: 'User not found' }, 404);

        // Remove user IP from banned list
        if (user.ip) {
          content.bannedIPs = content.bannedIPs.filter(ip => ip !== user.ip);
        }

        user.banned = false;
        user.banReason = '';
        user.bannedBy = '';
        user.bannedAt = '';

        await saveDataFile(content, sha, GITHUB_TOKEN);
        return jsonResp({ ok: true });
      } catch (e) {
        return jsonResp({ error: e.message }, 500);
      }
    }

    // ===== POST /api/ban-ip — manually ban an IP =====
    if (request.method === 'POST' && url.pathname === '/api/ban-ip') {
      try {
        const { ip, bannedBy, reason } = await request.json();
        if (!ip || !bannedBy) {
          return jsonResp({ error: 'Missing ip or bannedBy' }, 400);
        }

        if (!isAdminUser(null, bannedBy)) {
          return jsonResp({ error: 'Not authorized' }, 403);
        }

        const { content, sha } = await getDataFile(GITHUB_TOKEN);
        if (!content.bannedIPs) content.bannedIPs = [];

        if (!content.bannedIPs.includes(ip)) {
          content.bannedIPs.push(ip);
        }

        // Also ban any existing users with this IP
        if (content.users) {
          for (const u of content.users) {
            if (u.ip === ip && !u.banned) {
              u.banned = true;
              u.banReason = reason || 'IP banned';
              u.bannedBy = bannedBy;
              u.bannedAt = new Date().toISOString();
            }
          }
        }

        await saveDataFile(content, sha, GITHUB_TOKEN);
        return jsonResp({ ok: true, bannedIP: ip });
      } catch (e) {
        return jsonResp({ error: e.message }, 500);
      }
    }

    // ===== POST /api/unban-ip — manually unban an IP =====
    if (request.method === 'POST' && url.pathname === '/api/unban-ip') {
      try {
        const { ip, unbannedBy } = await request.json();
        if (!ip || !unbannedBy) {
          return jsonResp({ error: 'Missing ip or unbannedBy' }, 400);
        }

        if (!isAdminUser(null, unbannedBy)) {
          return jsonResp({ error: 'Not authorized' }, 403);
        }

        const { content, sha } = await getDataFile(GITHUB_TOKEN);
        if (!content.bannedIPs) content.bannedIPs = [];

        content.bannedIPs = content.bannedIPs.filter(b => b !== ip);

        // Also unban users with this IP
        if (content.users) {
          for (const u of content.users) {
            if (u.ip === ip && u.banned) {
              u.banned = false;
              u.banReason = '';
              u.bannedBy = '';
              u.bannedAt = '';
            }
          }
        }

        await saveDataFile(content, sha, GITHUB_TOKEN);
        return jsonResp({ ok: true });
      } catch (e) {
        return jsonResp({ error: e.message }, 500);
      }
    }

    // ===== POST /api/check-ban — check if user or IP is banned =====
    if (request.method === 'POST' && url.pathname === '/api/check-ban') {
      try {
        const { userId } = await request.json();
        const clientIP = getClientIP(request);
        const { content } = await getDataFile(GITHUB_TOKEN);

        // Check IP ban
        if ((content.bannedIPs || []).includes(clientIP)) {
          return jsonResp({ banned: true, reason: 'IP banned', ip: clientIP });
        }

        // Check user ban
        if (userId && content.users) {
          const user = content.users.find(u => u.id === userId);
          if (user && user.banned) {
            return jsonResp({ banned: true, reason: user.banReason || 'Account banned', ip: clientIP });
          }
        }

        return jsonResp({ banned: false, ip: clientIP });
      } catch (e) {
        return jsonResp({ banned: false, error: e.message });
      }
    }

    // ===== POST / (Discord OAuth) =====
    if (request.method === 'POST' && url.pathname === '/') {
      try {
        const { code } = await request.json();
        if (!code) {
          return jsonResp({ error: 'Missing code' }, 400);
        }

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
          return jsonResp({ error: 'Token exchange failed', details: tokenData }, 400);
        }

        const userRes = await fetch('https://discord.com/api/v10/users/@me', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });

        const userData = await userRes.json();
        if (!userRes.ok) {
          return jsonResp({ error: 'Failed to fetch user' }, 400);
        }

        let avatarUrl = `https://cdn.discordapp.com/embed/avatars/${userData.discriminator === '0' ? (BigInt(userData.id) >> 22n) % 6n : userData.discriminator % 5n}.png`;
        if (userData.avatar) {
          const ext = userData.avatar.startsWith('a_') ? 'gif' : 'png';
          avatarUrl = `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.${ext}`;
        }

        return jsonResp({
          id: userData.id,
          username: userData.username,
          global_name: userData.global_name || userData.username,
          avatar: avatarUrl,
          discriminator: userData.discriminator,
        });

      } catch (err) {
        return jsonResp({ error: 'Internal error', message: err.message }, 500);
      }
    }

    return jsonResp({ error: 'Not found' }, 404);
  },
};
