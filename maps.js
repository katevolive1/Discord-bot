// Danh sách map và cách tìm map gần đúng theo tên gõ vào
const MAPS = [
  { name: 'Erangel', files: ['erangel.jpg'], aliases: ['erangel', 'erangle', 'erage', 'eragel'] },
  { name: 'Miramar', files: ['miramar.jpg'], aliases: ['miramar', 'mirama', 'mirarmar', 'samac'] },
  { name: 'Taego', files: ['taego.jpg'], aliases: ['taego', 'tego', 'taigo'] },
  { name: 'Rondo', files: ['rondo.jpg'], aliases: ['rondo', 'rodo', 'jadena'] },
  { name: 'Vikendi', files: ['vikendi.jpg'], aliases: ['vikendi', 'vikedi', 'vikenji', 'tuyet'],
    note: 'Đỏ: phòng bảo mật (cần thẻ khóa). Xanh dương: phòng phá bằng xà beng (có thẻ khóa). Xanh lá: trại.' },
  { name: 'Deston', files: ['deston.jpg', 'deston-ripton.jpg'], aliases: ['deston', 'destion', 'ripton'],
    note: 'Đỏ: chỗ có thẻ khóa. Xanh lá: phòng bảo mật. Ảnh 2 là thành phố Ripton.' },
  { name: 'Paramo', files: ['paramo.jpg'], aliases: ['paramo', 'paramon', 'nuilua'],
    note: 'Ô vuông đỏ: chỗ có thể có hầm. Mỗi trận chỉ mở một vài chỗ, đổi ngẫu nhiên.' },
];

// Bỏ dấu, chữ hoa, khoảng trắng: "Mira Mar" -> "miramar"
function normalize(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

// Điểm càng nhỏ càng giống. Gõ đúng phần đầu tên (vd "mir") được 0 điểm.
function score(query, map) {
  const q = normalize(query);
  if (!q) return 0;
  let best = Infinity;
  for (const alias of map.aliases) {
    if (alias.startsWith(q)) return 0;
    best = Math.min(best, levenshtein(q, alias), levenshtein(q, alias.slice(0, q.length)) + 1);
  }
  return best;
}

// Các map khớp, xếp từ giống nhất. Sai tối đa 1/3 số ký tự (ít nhất 2).
function findMaps(query) {
  const limit = Math.max(2, Math.floor(normalize(query).length / 3));
  return MAPS
    .map(m => ({ map: m, s: score(query, m) }))
    .filter(x => x.s <= limit)
    .sort((a, b) => a.s - b.s)
    .map(x => x.map);
}

module.exports = { MAPS, findMaps };
