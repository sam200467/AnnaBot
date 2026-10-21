// 落雪查分器 OAuth 授权流程测试（无回调地址 + PKCE），用你自己的账号走一遍：
//   1. npm run check:oauth               生成授权链接
//   2. 浏览器打开链接并同意授权，页面会显示授权码
//   3. npm run check:oauth -- <授权码>   换取令牌、读取中二数据，再刷新一次令牌
// 应用 ID 和应用密钥从项目根目录的 .env 读取；令牌只在内存里用，不落盘也不打印。
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // 没有 .env，下面会提示缺少应用 ID
}

const SITE = 'https://maimai.lxns.net';
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob'; // 勾选「无回调地址」时登记的地址
const SCOPE = 'read_player';
const PENDING = path.join(__dirname, '..', '.oauth-pending.json');

const clientId = process.env.LXNS_OAUTH_CLIENT_ID?.trim();
const clientSecret = process.env.LXNS_OAUTH_CLIENT_SECRET?.trim();

function startAuthorization() {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  fs.writeFileSync(PENDING, JSON.stringify({ verifier, createdAt: new Date().toISOString() }));

  const url = new URL('/oauth/authorize', SITE);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  console.log('在浏览器里打开下面的链接并同意授权：\n');
  console.log(url.href);
  console.log('\n页面显示授权码后运行：npm run check:oauth -- <授权码>');
}

async function requestToken(params) {
  const res = await fetch(`${SITE}/api/v0/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`令牌接口 HTTP ${res.status} ${body.error ?? ''} ${body.error_description ?? ''}`.trim());
  }
  return body;
}

async function api(pathname, accessToken) {
  const res = await fetch(`${SITE}/api/v0${pathname}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${pathname} HTTP ${res.status} ${body?.message ?? ''}`.trim());
  return body.data;
}

async function finishAuthorization(code) {
  let pending;
  try {
    pending = JSON.parse(fs.readFileSync(PENDING, 'utf8'));
  } catch {
    console.log('找不到授权请求记录，先不带参数运行一次 npm run check:oauth 生成授权链接');
    process.exitCode = 1;
    return;
  }

  const first = await requestToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: pending.verifier,
  });
  fs.rmSync(PENDING); // 授权码只能兑换一次
  console.log(`  ✓ 换取令牌：${first.token_type}，有效期 ${first.expires_in} 秒，权限 ${first.scope}`);

  const player = await api('/user/chunithm/player', first.access_token);
  console.log(`  ✓ 玩家信息：${player.name}，Rating ${player.rating.toFixed(2)}，好友码 ${player.friend_code}`);
  const bests = await api('/user/chunithm/player/bests', first.access_token);
  console.log(`  ✓ Rating 构成：Best 30 ${bests.bests.length} 首 + 新曲 ${bests.new_bests?.length ?? 0} 首`);
  const scores = await api('/user/chunithm/player/scores', first.access_token);
  const withScore = scores.filter((s) => typeof s.score === 'number').length;
  console.log(`  ✓ 全部成绩：${scores.length} 条，其中 ${withScore} 条带具体分数`);

  const second = await requestToken({ grant_type: 'refresh_token', refresh_token: first.refresh_token });
  await api('/user/chunithm/player', second.access_token);
  const rotated = second.refresh_token !== first.refresh_token ? '，刷新令牌也换了新的' : '';
  console.log(`  ✓ 刷新令牌：新的访问令牌可用${rotated}`);

  // 别再提示去落雪「第三方应用」里撤销：那里是按应用撤销的，会把服务器上 Anna 的授权一起撤掉（2026-10-21 查落雪前端确认）。
  // 测试令牌没保存，放着不用，30 天后自己过期
  console.log('\nOAuth 流程全部通过。测试令牌没有保存，30 天不用会自己过期。' +
    '\n不要去落雪「第三方应用」里撤销：那里按应用撤销，会连服务器上 Anna 的授权一起撤掉。');
}

(async () => {
  if (!clientId || !clientSecret) {
    console.log('.env 里缺少 LXNS_OAUTH_CLIENT_ID 或 LXNS_OAUTH_CLIENT_SECRET（开发者面板 → OAuth 应用 → 创建应用后获得）');
    process.exitCode = 1;
    return;
  }
  const code = process.argv[2]?.trim();
  if (!code) {
    startAuthorization();
    return;
  }
  try {
    await finishAuthorization(code);
  } catch (err) {
    console.log(`  ✗ ${err.message}`);
    if (err.message.includes('invalid_grant')) {
      console.log('授权码过期、输错或已经用过：重新运行 npm run check:oauth 生成新链接再授权一次');
    }
    process.exitCode = 1;
  }
})();
