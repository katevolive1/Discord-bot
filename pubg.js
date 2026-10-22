const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// Key PUBG API: đặt file api_BOT_Pubg.txt cạnh bot hoặc ở thư mục cha
const keyFile = [path.join(__dirname, 'api_BOT_Pubg.txt'), path.join(__dirname, '..', 'api_BOT_Pubg.txt')]
  .find(f => fs.existsSync(f));
const KEY = keyFile ? fs.readFileSync(keyFile, 'utf8').match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/)?.[0] : null;
const BASE = 'https://api.pubg.com/shards/steam';
const DICT = 'https://raw.githubusercontent.com/pubg/api-assets/master/dictionaries/telemetry/';

const MODES = { solo: 'Solo', duo: 'Duo', squad: 'Squad' };
const TYPES = { official: 'Normal', competitive: 'Ranked', custom: 'Custom', arcade: 'Arcade' };
const WEAPON_VI = { ProjGrenade_C: 'Lựu đạn', PlayerMale_A_C: 'Tay không', PlayerFemale_A_C: 'Tay không' };

class PubgError extends Error {}

function get(url, auth) {
  return new Promise((resolve, reject) => {
    const headers = { Accept: 'application/vnd.api+json', 'Accept-Encoding': 'gzip' };
    if (auth) headers.Authorization = 'Bearer ' + KEY;
    https.get(url, { headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          let buf = Buffer.concat(chunks);
          if (res.headers['content-encoding'] === 'gzip') buf = zlib.gunzipSync(buf);
          if (res.statusCode !== 200) return reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode }));
          resolve(JSON.parse(buf.toString('utf8')));
        } catch (err) { reject(err); }
      });
    }).on('error', reject);
  });
}

// Từ điển tên súng/map của PUBG, tải một lần rồi giữ lại
let dict = null;
async function loadDict() {
  if (!dict) {
    const [weapons, maps] = await Promise.all([get(DICT + 'damageCauserName.json'), get(DICT + 'mapName.json')]);
    dict = { weapons, maps };
  }
  return dict;
}

// Giờ API là UTC, cộng 7 tiếng ra giờ Việt Nam
function vnTime(iso, withDate) {
  const d = new Date(new Date(iso).getTime() + 7 * 3600 * 1000);
  const p = n => String(n).padStart(2, '0');
  const hm = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  return withDate ? `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${hm}` : hm;
}

async function lastGame(name) {
  if (!KEY) throw new PubgError('Bot chưa có PUBG API key (file api_BOT_Pubg.txt).');
  let player;
  try {
    player = (await get(`${BASE}/players?filter[playerNames]=${encodeURIComponent(name)}`, true)).data[0];
  } catch (err) {
    if (err.status === 404) throw new PubgError(`Không tìm thấy người chơi "${name}" trên Steam (tên phân biệt hoa/thường).`);
    if (err.status === 429) throw new PubgError('Hỏi nhiều quá, đợi tí coi. Quang chan đuổi hay gì mà vội!');
    throw err;
  }
  name = player.attributes.name;
  const matchId = player.relationships.matches.data[0]?.id;
  if (!matchId) throw new PubgError(`${name} chưa có trận nào trong 14 ngày gần đây.`);

  const [match, { weapons, maps }] = await Promise.all([get(`${BASE}/matches/${matchId}`, true), loadDict()]);
  const a = match.data.attributes;
  const parts = match.included.filter(x => x.type === 'participant');
  const rosters = match.included.filter(x => x.type === 'roster');
  const me = parts.find(x => x.attributes.stats.name === name);
  const s = me.attributes.stats;
  const roster = rosters.find(r => r.relationships.participants.data.some(d => d.id === me.id));
  const team = roster.relationships.participants.data.map(d => parts.find(x => x.id === d.id).attributes.stats.name);

  const mapName = (maps[a.mapName] || a.mapName).replace(/\s*\(.*\)$/, '');
  const mode = MODES[a.gameMode.replace('-fpp', '')] || a.gameMode;
  const fpp = a.gameMode.endsWith('-fpp') ? ' FPP' : '';
  const survived = `${Math.floor(s.timeSurvived / 60)} phút ${s.timeSurvived % 60} giây`;
  const humans = parts.map(x => x.attributes.stats).filter(p => !p.playerId.startsWith('ai.'));

  const embed = {
    color: 0xf5c518,
    title: `🎮 Trận gần nhất của ${name}`,
    description: `${mapName} · ${mode}${fpp} · ${TYPES[a.matchType] || a.matchType} · ${vnTime(a.createdAt, true)} · ${Math.round(a.duration / 60)} phút`,
    fields: [
      { name: '🏆 Hạng', value: `#${s.winPlace} / ${rosters.length} đội`, inline: true },
      { name: '⚔️ Kill', value: `${s.kills} kill · ${s.DBNOs} knock · ${s.assists} assist`, inline: true },
      { name: '🎯 Headshot', value: `${s.headshotKills}`, inline: true },
      { name: '💥 Sát thương', value: `${Math.round(s.damageDealt)}`, inline: true },
      { name: '📏 Kill xa nhất', value: `${Math.round(s.longestKill)}m`, inline: true },
      { name: '⏱️ Sống được', value: survived, inline: true },
      { name: '🏃 Di chuyển', value: `Bộ ${Math.round(s.walkDistance)}m · Xe ${Math.round(s.rideDistance)}m · Bơi ${Math.round(s.swimDistance)}m`, inline: true },
      { name: '❤️ Hồi phục', value: `Cứu ${s.revives} · Hồi máu ${s.heals} · Nước ${s.boosts}`, inline: true },
      { name: '🤖 Bot AI', value: `${parts.length - humans.length} / ${parts.length} người`, inline: true },
      { name: '👥 Đội', value: team.join(', ') },
    ],
  };

  // Danh sách kill lấy từ telemetry; lỗi thì vẫn gửi phần thống kê
  if (s.kills > 0) {
    try {
      const asset = match.included.find(x => x.type === 'asset');
      const tel = await get(asset.attributes.URL);
      const kills = tel.filter(e => e._T === 'LogPlayerKillV2' && e.killer?.name === name).map(e => {
        const info = e.killerDamageInfo || {};
        const weapon = WEAPON_VI[info.damageCauserName] || weapons[info.damageCauserName] || info.damageCauserName;
        // Bot AI có accountId dạng "ai.xxx"
        const victim = e.victim.name + (e.victim.accountId?.startsWith('ai.') ? ' (AI)' : '');
        return [vnTime(e._D), victim, weapon, `${Math.round((info.distance || 0) / 100)}m`];
      });
      const aiKills = kills.filter(k => k[1].endsWith(' (AI)')).length;
      if (aiKills) embed.fields.find(f => f.name === '⚔️ Kill').value = `${s.kills} kill (${aiKills} AI) · ${s.DBNOs} knock · ${s.assists} assist`;
      const w = [1, 2].map(i => Math.max(...kills.map(k => k[i].length)));
      const rows = kills.map(k => `${k[0]}  ${k[1].padEnd(w[0])} – ${k[2].padEnd(w[1])} – ${k[3]}`).slice(0, 15);
      if (rows.length) embed.fields.push({ name: '🔫 Các kill', value: '```\n' + rows.join('\n') + '\n```' });
    } catch (err) {
      console.error('Lỗi tải telemetry:', err.message);
      embed.fields.push({ name: '🔫 Các kill', value: 'Không tải được danh sách kill.' });
    }
  }
  return embed;
}

module.exports = { lastGame, PubgError };
