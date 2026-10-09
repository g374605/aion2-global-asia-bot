import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const EVENTS_FILE = path.join(ROOT, 'events.json');
const STATE_FILE = path.join(ROOT, 'sent-state.json');
const LEAD_MINUTES = [5, 0];

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID, CHANNEL_ID, ROLE_ID = '' } = process.env;

if (![DISCORD_TOKEN, CLIENT_ID, GUILD_ID, CHANNEL_ID].every(Boolean)) throw new Error('缺少必需的 .env 变量');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const COMMAND_COLOR = 0x5865F2;      // Discord Blurple — 命令面板
const WARN_COLOR = 0xF59E0B;         // 琥珀金 — 5分钟预警
const START_COLOR = 0x22C55E;        // 翡翠绿 — 事件开始
const DIVIDER = '━━━━━━━━━━━━━━━━';

const commands = [
  new SlashCommandBuilder().setName('events').setDescription('查看即将到来的 AION 2 Global 事件'),
  new SlashCommandBuilder().setName('nextboss').setDescription('查看下一个 BOSS 刷新时间'),
  new SlashCommandBuilder().setName('testevent').setDescription('发送一条测试事件通知').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map(c => c.toJSON());

function loadEvents() {
  const data = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
  if (data.timezone !== 'UTC' || !Array.isArray(data.events)) throw new Error('events.json 必须使用 UTC 时区且包含 events 数组');
  const ids = new Set();
  for (const event of data.events) {
    if (ids.has(event.id)) throw new Error('重复的事件 ID: ' + event.id);
    ids.add(event.id);
    if (!event.id || !event.name || !Array.isArray(event.days) || !Array.isArray(event.times)) throw new Error('无效的事件定义');
    if (!event.days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) throw new Error('无效的 UTC 星期');
    if (!event.times.every(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) throw new Error('无效的 UTC 时间');
  }
  return data.events;
}

function occurrences(now, horizonDays = 8) {
  const out = [];
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const event of loadEvents()) for (let day = -1; day <= horizonDays; day++) {
    const midnight = base + day * 86400000;
    if (!event.days.includes(new Date(midnight).getUTCDay())) continue;
    for (const t of event.times) {
      const [h, m] = t.split(':').map(Number);
      const start = midnight + (h * 60 + m) * 60000;
      if (start >= now.getTime() - 600000 && start <= now.getTime() + horizonDays * 86400000) out.push({ event, start });
    }
  }
  return out.sort((a,b) => a.start-b.start);
}

const cnTime = timestamp => new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai', weekday:'short', month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(timestamp));
const unix = ms => Math.floor(ms / 1000);

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function saveState(state) {
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

function embedFor({event,start}, lead) {
  const color = lead ? WARN_COLOR : START_COLOR;
  const statusText = lead ? '⚠️ 即将开始' : '🔔 已开始';
  const durationText = event.durationMinutes > 0 ? `时长 ${event.durationMinutes} 分钟` : '每日重置';

  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: 'AION 2 · Global Asia' })
    .setTitle(`${event.emoji}  ${event.name}`)
    .setDescription(`${DIVIDER}\n**${statusText}**\n${DIVIDER}`)
    .addFields(
      { name: '🕐 开始时间', value: `<t:${unix(start)}:F>`, inline: true },
      { name: '⏱️ 倒计时', value: `<t:${unix(start)}:R>`, inline: true },
      { name: '📌 时长', value: durationText, inline: true },
    )
    .setFooter({ text: event.provisional ? '⚠️ 暂定时间，未经Global Asia确认' : event.note || '数据来源: Shugo.gg · 请在游戏中核实' });
}

function listEmbed(items, title) {
  const lines = items.map(x => {
    const prov = x.event.provisional ? ' ⚠️' : '';
    return `${x.event.emoji} **${x.event.name}**${prov}\n    └ <t:${unix(x.start)}:F> · <t:${unix(x.start)}:R>`;
  }).join('\n\n');

  return new EmbedBuilder()
    .setColor(COMMAND_COLOR)
    .setAuthor({ name: 'AION 2 · Global Asia Event Tracker' })
    .setTitle(title)
    .setDescription(lines || '暂无即将到来的事件')
    .setFooter({ text: '时区: 北京时间 (GMT+8) · 数据来源: Shugo.gg' })
    .setTimestamp();
}

let busy = false;
async function tick() {
  if (busy || !client.isReady()) return;
  busy = true;
  try {
    const now = Date.now();
    const state = readState();
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel?.isTextBased() || !('send' in channel)) throw new Error('频道无法发送消息');
    for (const occurrence of occurrences(new Date(now), 1)) for (const lead of LEAD_MINUTES) {
      const due = occurrence.start - lead * 60000;
      if (now < due || now >= due + 90000) continue;
      const key = `${occurrence.event.id}:${occurrence.start}:${lead}`;
      if (state[key]) continue;
      const mention = ROLE_ID ? `<@&${ROLE_ID}>` : undefined;
      const sent = await channel.send({content: mention, embeds:[embedFor(occurrence,lead)], allowedMentions:{roles: ROLE_ID ? [ROLE_ID] : []}});
      state[key] = {sentAt:new Date().toISOString(),messageId:sent.id};
      saveState(state);
      console.log('已发送:', key);
    }
    for (const [key,val] of Object.entries(state)) if (Date.parse(val.sentAt) < now - 14*86400000) delete state[key];
    saveState(state);
  } catch (err) { console.error('调度器错误:', err); }
  finally { busy = false; }
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  try {
    if (interaction.commandName === 'testevent') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({content:'需要「管理服务器」权限才能使用此命令。',flags:MessageFlags.Ephemeral});
      const example = occurrences(new Date(),8)[0];
      await interaction.reply({content:'✅ 正在向配置的频道发送测试消息。',flags:MessageFlags.Ephemeral});
      const channel = await client.channels.fetch(CHANNEL_ID);
      await channel.send({embeds:[embedFor(example,5)]});
      return;
    }
    let items = occurrences(new Date(),8).filter(x => x.start > Date.now());
    if (interaction.commandName === 'nextboss') items = items.filter(x => ['siegeboss','nahma','kaira'].includes(x.event.id));
    items = items.slice(0,10);
    const title = interaction.commandName === 'nextboss' ? '👹 即将刷新的 BOSS' : '📅 即将到来的事件';
    await interaction.reply({embeds:[listEmbed(items, title)]});
  } catch (err) { console.error(err); if (!interaction.replied) await interaction.reply({content:'命令执行失败，请查看Bot日志。',flags:MessageFlags.Ephemeral}).catch(()=>{}); }
});

client.once('clientReady', () => { console.log(`已登录为 ${client.user.tag}`); tick(); setInterval(tick,20000); });

await new REST({version:'10'}).setToken(DISCORD_TOKEN).put(Routes.applicationGuildCommands(CLIENT_ID,GUILD_ID),{body:commands});
await client.login(DISCORD_TOKEN);
