// 落雪查分器（maimai.lxns.net）中二节奏数据连通性检查。
// 公共 API 不需要密钥；个人 API、开发者 API 的密钥从项目根目录的 .env 读取，不会打印出来。
// 用法：npm run check:lxns
'use strict';

const path = require('node:path');

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // 没有 .env 时只检查公共 API
}

const API = 'https://maimai.lxns.net/api/v0';
const ASSETS = 'https://assets2.lxns.net/chunithm';
const DIFFICULTIES = ['BASIC', 'ADVANCED', 'EXPERT', 'MASTER', 'ULTIMA', "WORLD'S END"];

let failures = 0;

async function request(url, headers) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    const body = Buffer.from(await res.arrayBuffer());
    let json = null;
    try {
      json = JSON.parse(body.toString('utf8'));
    } catch {
      // 图片等非 JSON 响应
    }
    // 个人 / 开发者 API 外面包一层 { success, code, data }，公共 API 直接返回数据
    const data = json && typeof json === 'object' && 'success' in json ? json.data : json;
    return { ok: res.ok, status: res.status, seconds: (Date.now() - started) / 1000, bytes: body.length, data, message: json?.message };
  } catch (err) {
    return { ok: false, status: 0, seconds: (Date.now() - started) / 1000, bytes: 0, data: null, message: err.cause?.code || err.message };
  }
}

function hint(status) {
  if (status === 401) return ' —— 密钥无效，或者已在网页上重新生成过';
  if (status === 403) return ' —— 没有权限，可能是玩家关闭了「允许第三方读取」';
  if (status === 404) return ' —— 找不到玩家，或者还没同步过中二节奏数据';
  if (status === 429) return ' —— 请求太频繁，等一会儿再试';
  return '';
}

async function check(label, url, headers, describe) {
  const res = await request(url, headers);
  if (!res.ok) {
    failures++;
    console.log(`  ✗ ${label}：HTTP ${res.status || '无响应'} ${res.message || ''}${hint(res.status)}`);
    return null;
  }
  console.log(`  ✓ ${label}：${describe(res.data, res)}（${res.seconds.toFixed(1)}s）`);
  return res.data;
}

function beijing(utc) {
  return utc ? new Date(utc).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '未知';
}

// 玩家 Rating = 旧版本 Best 30 与新曲 Best 20 共 50 首的平均值，截到两位小数
function describeBests(b, rating) {
  const counted = [...b.bests, ...(b.new_bests ?? [])];
  if (!counted.length) return '还没有成绩';
  const average = Math.floor((counted.reduce((sum, s) => sum + s.rating, 0) / counted.length) * 100 + 1e-6) / 100;
  const mismatch = rating !== undefined && average !== rating ? `（玩家信息里是 ${rating}，数据可能没同步完）` : '';
  const top = [...counted].sort((x, y) => y.rating - x.rating)[0];
  return `Best 30 ${b.bests.length} 首 + 新曲 ${b.new_bests?.length ?? 0} 首 + 候选 ${b.selections?.length ?? 0} 首，`
    + `算出 Rating ${average.toFixed(2)}${mismatch}；单曲最高 ${top.song_name} ${DIFFICULTIES[top.level_index]} ${top.score}（${top.rating}）`;
}

async function checkPublic() {
  console.log('公共 API（不需要密钥）');
  const list = await check('曲目列表', `${API}/chunithm/song/list`, {}, (d) => {
    const worldsEnd = d.songs.filter((s) => s.difficulties.some((x) => x.difficulty === 5)).length;
    const latest = Math.max(...d.songs.map((s) => s.version));
    const title = d.versions.find((v) => v.version === latest)?.title ?? latest;
    return `${d.songs.length} 首（含 WORLD'S END ${worldsEnd} 首），收录到 ${title}`;
  });
  await check('别名列表', `${API}/chunithm/alias/list`, {}, (d) => `${d.aliases.length} 首曲目有别名`);
  await check('名牌版列表', `${API}/chunithm/plate/list`, {}, (d) => `${d.plates.length} 个`);
  const songId = list?.songs[0]?.id ?? 3;
  await check('曲绘素材', `${ASSETS}/jacket/${songId}.png`, {}, (_, res) => `${Math.round(res.bytes / 1024)} KB`);
}

async function checkUser(token) {
  console.log('\n个人 API（X-User-Token，只能看密钥主人自己的数据）');
  const headers = { 'X-User-Token': token };
  const player = await check('玩家信息', `${API}/user/chunithm/player`, headers, (p) =>
    `${p.name}，Rating ${p.rating.toFixed(2)}，好友码 ${p.friend_code}，上次同步 ${beijing(p.upload_time)}`);
  await check('Rating 构成', `${API}/user/chunithm/player/bests`, headers, (b) => describeBests(b, player?.rating));
  await check('全部成绩', `${API}/user/chunithm/player/scores`, headers, (scores) => {
    const counts = DIFFICULTIES
      .map((name, i) => [name, scores.filter((s) => s.level_index === i).length])
      .filter(([, n]) => n > 0)
      .map(([name, n]) => `${name} ${n}`);
    return `${scores.length} 条（${counts.join('，')}）`;
  });
  return player;
}

async function checkDeveloper(token, friendCode) {
  console.log('\n开发者 API（Authorization，按好友码查询任意玩家）');
  const headers = { Authorization: token };
  const player = await check('玩家信息', `${API}/chunithm/player/${friendCode}`, headers, (p) =>
    `${p.name}，Rating ${p.rating.toFixed(2)}，上次同步 ${beijing(p.upload_time)}`);
  await check('Rating 构成', `${API}/chunithm/player/${friendCode}/bests`, headers, (b) => describeBests(b, player?.rating));
}

(async () => {
  await checkPublic();

  const userToken = process.env.LXNS_USER_TOKEN?.trim();
  const devToken = process.env.LXNS_DEV_TOKEN?.trim();
  const player = userToken ? await checkUser(userToken) : null;
  if (!userToken) console.log('\n个人 API：跳过（.env 里没有 LXNS_USER_TOKEN）');

  const friendCode = process.env.LXNS_FRIEND_CODE?.trim() || player?.friend_code;
  if (devToken && friendCode) await checkDeveloper(devToken, friendCode);
  else if (devToken) console.log('\n开发者 API：跳过（需要 LXNS_FRIEND_CODE，或者先配好个人 API 密钥）');
  else console.log('\n开发者 API：跳过（.env 里没有 LXNS_DEV_TOKEN）');

  console.log(failures ? `\n${failures} 项失败` : '\n全部通过');
  process.exitCode = failures ? 1 : 0;
})();
