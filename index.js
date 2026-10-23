const path = require('path');
const { Client, GatewayIntentBits, SlashCommandBuilder, AttachmentBuilder, EmbedBuilder, PermissionFlagsBits, AuditLogEvent } = require('discord.js');
const { token } = require('./config.json');
const { MAPS, findMaps } = require('./maps');
const { lastGame, PubgError } = require('./pubg');
const VAR_LINES = require('./var-cau');

// Lệnh chấm điểm vui: tag một người, bot đưa ra % ngẫu nhiên 0-100.
// ownerScore là điểm cố định khi tag chủ bot.
const RATINGS = {
  deptrai: { label: 'đẹp trai', ownerScore: 100 },
  gay: { label: 'gay', ownerScore: 0 },
};

// Discord xóa mọi ký tự vô hình nên không để mô tả trống được; dùng dấu chấm giữa cho gần như trống
const BLANK_DESC = '·';

const commands = [
  new SlashCommandBuilder()
    .setName('hambimat')
    .setDescription('Xem vị trí hầm bí mật của một map')
    .addStringOption(opt =>
      opt.setName('map')
        .setDescription('Tên map')
        .setRequired(true)
        .setAutocomplete(true)),
  ...Object.entries(RATINGS).map(([name, r]) =>
    new SlashCommandBuilder()
      .setName(name)
      .setDescription(`Đo độ ${r.label} của một người`)
      .addUserOption(opt =>
        opt.setName('nguoi')
          .setDescription('Tag người cần đo')
          .setRequired(true))),
  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Xóa các tin nhắn gần nhất của bot trong kênh (mặc định 10)')
    .addIntegerOption(opt =>
      opt.setName('so_luong')
        .setDescription('Số tin của bot cần xóa (0-9999)')
        .setMinValue(0)
        .setMaxValue(9999)),
  new SlashCommandBuilder()
    .setName('gamegannhat')
    .setDescription('Xem thống kê trận PUBG gần nhất của một người (Steam)')
    .addStringOption(opt =>
      opt.setName('ten')
        .setDescription('Tên ingame, đúng hoa/thường')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('start')
    .setDescription(BLANK_DESC),//Bật lại bot sau khi tạm dừng (chỉ chủ bot)
  new SlashCommandBuilder()
    .setName('stop')
      .setDescription(BLANK_DESC),//Tạm dừng bot, không phản hồi gì nữa (chỉ chủ bot)
  new SlashCommandBuilder()
    .setName('var')
      .setDescription(BLANK_DESC)//Bot var 10 câu vào một người
    .addUserOption(opt =>
      opt.setName('nguoi')
        .setDescription(BLANK_DESC)//Tag người cần var
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('stopvar')
    .setDescription(BLANK_DESC),//Dừng các lượt var đang chạy (ai cũng dùng được)
];

// Xáo kho câu var rồi lấy lần lượt, dùng hết kho mới xáo lại nên ít khi lặp
let varDeck = [];
function nextVarLines(n) {
  const picked = [];
  while (picked.length < n) {
    if (!varDeck.length) varDeck = shuffle(VAR_LINES.filter(l => !picked.includes(l)));
    picked.push(varDeck.pop());
  }
  return picked;
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildModeration] });
let ownerId = null;
// /stop bật cờ này: bot vẫn online nhưng bỏ qua mọi lệnh và sự kiện. Khởi động lại bot thì về hoạt động.
let paused = false;
// Mỗi lần /stop tăng số này. Lệnh đang chạy dở so với số lúc bắt đầu, khác thì dừng ngay.
let stopCount = 0;
// Giống stopCount nhưng chỉ dừng /var, do /stopvar tăng
let varStopCount = 0;

// Đăng ký lệnh riêng cho từng server để lệnh hiện ngay, không phải chờ
async function registerCommand(guild) {
  try {
    await guild.commands.set(commands.map(c => c.toJSON()));
    console.log(`Đã đăng ký lệnh ở server: ${guild.name}`);
  } catch (err) {
    console.error(`Không đăng ký được lệnh ở ${guild.name}:`, err.message);
  }
}

client.once('ready', async () => {
  console.log(`Bot đã online: ${client.user.tag}`);
  // Chủ bot = tài khoản sở hữu app trong Developer Portal
  const app = await client.application.fetch();
  ownerId = app.owner?.ownerId ?? app.owner?.id;
  for (const guild of client.guilds.cache.values()) await registerCommand(guild);
});

client.on('guildCreate', registerCommand);

// Discord không báo ai xóa tin, phải đọc Nhật ký kiểm tra (bot cần quyền Xem Nhật Ký Kiểm Tra).
// Nhật ký chỉ ghi khi xóa tin của người khác, tự xóa tin mình thì không có.
const WATCH_DELETER_ID = '1174424714505093185';
client.on('guildAuditLogEntryCreate', entry => {
  if (paused || entry.action !== AuditLogEvent.MessageDelete || entry.executorId !== WATCH_DELETER_ID) return;
  const channel = entry.extra?.channel;
  if (!channel?.isTextBased?.()) return;
  // Hiện tên người bị xóa nhưng không ping họ; xóa tin của chủ bot thì gọi là "Đại ca tao"
  const victim = entry.targetId === ownerId ? 'Đại ca tao' : `<@${entry.targetId}>`;
  channel.send({ content: `Chó Quang chan vừa xóa tin nhắn của ${victim}`, allowedMentions: { parse: [] } })
    .catch(err => console.error('Không gửi được thông báo xóa tin:', err.message));
});

client.on('interactionCreate', interaction => {
  handleInteraction(interaction).catch(err => {
    // Bot thiếu quyền (50013) hoặc không vào được kênh (50001) thì báo người gõ, lỗi khác chỉ ghi ra console
    if (err.code !== 50013 && err.code !== 50001) return console.error('Lỗi xử lý lệnh:', err);
    if (!interaction.isRepliable()) return;
    const msg = { content: 'Bot không có quyền.', ephemeral: true };
    (interaction.deferred || interaction.replied ? interaction.followUp(msg) : interaction.reply(msg)).catch(() => {});
  });
});

async function handleInteraction(interaction) {
  if (interaction.isChatInputCommand() && ['start', 'stop'].includes(interaction.commandName)) {
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: 'Chỉ chủ bot dùng được lệnh này.', ephemeral: true });
      return;
    }
    paused = interaction.commandName === 'stop';
    if (paused) stopCount++;
    await interaction.reply({ content: paused ? 'Bot đã tạm dừng. Gõ /start để bật lại.' : 'Bot đã hoạt động lại.', ephemeral: true });
    return;
  }
  if (paused) {
    // Vẫn phải trả lời, không thì Discord báo "Ứng dụng không phản hồi"
    if (interaction.isAutocomplete()) await interaction.respond([]);
    else if (interaction.isRepliable()) await interaction.reply({ content: 'Bot đang tạm nghỉ.', ephemeral: true });
    return;
  }

  if (interaction.isAutocomplete() && interaction.commandName === 'hambimat') {
    const typed = interaction.options.getFocused();
    let list = findMaps(typed);
    if (list.length === 0) list = MAPS;
    await interaction.respond(list.map(m => ({ name: m.name, value: m.name })));
    return;
  }
  // độ đẹp chay hoặc gay
  const rating = RATINGS[interaction.commandName];
  if (interaction.isChatInputCommand() && rating) {
    const user = interaction.options.getUser('nguoi');
    const score = user.id === ownerId ? rating.ownerScore : Math.floor(Math.random() * 101);
    await interaction.reply(`Độ ${rating.label} của ${user} là **${score}%**`);
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'var') {
    const user = interaction.options.getUser('nguoi');
    if (user.id === ownerId) {
      await interaction.reply('Đại ca tao sao tao var được');
      return;
    }
    // Ghi tên dạng chữ thường (tên trong server), không dùng @
    const t = interaction.options.getMember('nguoi')?.displayName ?? user.globalName ?? user.username;
    const noPing = { allowedMentions: { parse: [] } };
    const run = stopCount;
    const varRun = varStopCount;
    // Câu 1 là tin trả lời lệnh (hiện "… đã sử dụng /var" như các lệnh khác), các câu sau là tin thường trong kênh.
    // Mỗi câu một tin, cách nhau 0,5 giây, /stop hoặc /stopvar cắt ngang được
    const lines = nextVarLines(5);
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) await sleep(500);
      if (run !== stopCount || varRun !== varStopCount) return;
      const msg = { content: `${i + 1}. ${lines[i].replaceAll('{t}', t)}`, ...noPing };
      await (i === 0 ? interaction.reply(msg) : interaction.channel.send(msg));
    }
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'stopvar') {
    varStopCount++;
    await interaction.reply({ content: 'Đã dừng.', ephemeral: true });
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'clear') {
    const want = interaction.options.getInteger('so_luong') ?? 10;
    await interaction.deferReply({ ephemeral: true });
    const channel = interaction.channel;
    // Xóa hàng loạt cần quyền Quản Lý Tin Nhắn và tin mới hơn 14 ngày; không thì xóa từng tin
    const canBulk = channel.permissionsFor(interaction.guild.members.me).has(PermissionFlagsBits.ManageMessages);
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000 + 60 * 1000;
    let deleted = 0;
    let before;
    const run = stopCount;
    const stopped = () => run !== stopCount;
    try {
      // Lật lịch sử kênh từng trang 100 tin, chỉ lấy tin do bot gửi
      while (deleted < want && !stopped()) {
        const page = await channel.messages.fetch({ limit: 100, before });
        if (page.size === 0) break;
        before = page.last().id;
        const mine = [...page.values()].filter(m => m.author.id === client.user.id).slice(0, want - deleted);
        const bulk = canBulk ? mine.filter(m => m.createdTimestamp > cutoff) : [];
        if (bulk.length) await channel.bulkDelete(bulk);
        deleted += bulk.length;
        for (const m of mine.filter(m => !bulk.includes(m))) {
          if (stopped()) break;
          await m.delete();
          deleted++;
        }
      }
    } catch (err) {
      if (err.code !== 50013 && err.code !== 50001) throw err;
      await interaction.editReply('Bot không có quyền.');
      return;
    }
    let msg = `Đã xóa ${deleted} tin nhắn của bot.`;
    if (stopped()) msg = `Đã dừng theo /stop, xóa được ${deleted} tin.`;
    else if (deleted < want) msg += ' Trong kênh không còn tin nào khác của bot.';
    await interaction.editReply(msg);
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'gamegannhat') {
    // Tải trận + telemetry mất vài giây, báo "đang xử lý" trước
    await interaction.deferReply();
    const run = stopCount;
    try {
      const embed = await lastGame(interaction.options.getString('ten').trim());
      // Bị /stop trong lúc tải thì xóa tin "đang suy nghĩ", không gửi kết quả
      if (run !== stopCount) return await interaction.deleteReply();
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      if (run !== stopCount) return await interaction.deleteReply();
      if (!(err instanceof PubgError)) console.error('Lỗi /gamegannhat:', err);
      await interaction.editReply(err instanceof PubgError ? err.message : 'Lỗi khi lấy dữ liệu PUBG, thử lại sau.');
    }
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'hambimat') {
    const typed = interaction.options.getString('map');
    const map = findMaps(typed)[0];
    if (!map) {
      await interaction.reply({
        content: `Không tìm thấy map "${typed}". Các map có: ${MAPS.map(m => m.name).join(', ')}`,
        ephemeral: true,
      });
      return;
    }
    // Báo "đang xử lý" ngay, vì gửi ảnh có thể lâu hơn hạn 3 giây của Discord
    await interaction.deferReply();
    if (paused) return await interaction.deleteReply();
    const files = map.files.map(f => new AttachmentBuilder(path.join(__dirname, 'images', f), { name: f }));
    const embeds = map.files.map((f, i) => {
      const embed = new EmbedBuilder().setImage(`attachment://${f}`).setColor(0xf5c518);
      if (i === 0) {
        embed.setTitle(`Hầm bí mật - ${map.name}`);
        if (map.note) embed.setDescription(map.note);
      }
      return embed;
    });
    try {
      await interaction.editReply({ embeds, files });
    } catch (err) {
      // Tin "đang suy nghĩ" đã bị xóa (lỗi 10008) thì gửi thành tin mới
      if (err.code !== 10008) throw err;
      await interaction.followUp({ embeds, files });
    }
  }
}

client.login(token);
