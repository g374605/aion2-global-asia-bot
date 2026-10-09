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
if (![DISCORD_TOKEN, CLIENT_ID, GUILD_ID, CHANNEL_ID].every(Boolean)) throw new Error('Missing required .env variables');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const commands = [
  new SlashCommandBuilder().setName('events').setDescription('Upcoming AION 2 Global events'),
  new SlashCommandBuilder().setName('nextboss').setDescription('Next boss spawn'),
  new SlashCommandBuilder().setName('testevent').setDescription('Send a test event notification').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map(c => c.toJSON());

function loadEvents() {
  const data = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
  if (data.timezone !== 'UTC' || !Array.isArray(data.events)) throw new Error('events.json must use UTC and events array');
  const ids = new Set();
  for (const event of data.events) {
    if (ids.has(event.id)) throw new Error('Duplicate event id: ' + event.id);
    ids.add(event.id);
    if (!event.id || !event.name || !Array.isArray(event.days) || !Array.isArray(event.times)) throw new Error('Invalid event definition');
    if (!event.days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) throw new Error('Invalid UTC weekdays');
    if (!event.times.every(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) throw new Error('Invalid UTC time');
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
const vnTime = timestamp => new Intl.DateTimeFormat('vi-VN', {timeZone:'Asia/Ho_Chi_Minh', weekday:'short', day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(timestamp));
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
  const title = lead ? `⏰ Còn 5 phút: ${event.emoji} ${event.name}` : `🚨 Bắt đầu: ${event.emoji} ${event.name}`;
  return new EmbedBuilder().setColor(lead ? 0xF59E0B : 0x22C55E).setTitle(title)
    .setDescription(`**Giờ Việt Nam:** ${vnTime(start)} (GMT+7)\n**Discord time:** <t:${unix(start)}:F>\n**Trạng thái:** ${lead ? 'Sắp diễn ra' : 'Đã đến giờ'}${event.provisional ? '\n⚠️ Lịch tạm thời, chưa xác nhận Global Asia' : ''}`)
    .addFields({name:'Thời lượng',value:event.durationMinutes ? `${event.durationMinutes} phút` : 'Mốc reset',inline:true}, {name:'Khu vực',value:'Global Asia (lịch UTC cộng đồng)',inline:true})
    .setFooter({text: event.note || 'Nguồn tham khảo: Shugo.gg. Hãy kiểm tra giờ trong game.'});
}
let busy = false;
async function tick() {
  if (busy || !client.isReady()) return;
  busy = true;
  try {
    const now = Date.now();
    const state = readState();
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel?.isTextBased() || !('send' in channel)) throw new Error('Channel is not sendable');
    for (const occurrence of occurrences(new Date(now), 1)) for (const lead of LEAD_MINUTES) {
      const due = occurrence.start - lead * 60000;
      // Only send within 90 seconds after due. Avoid old notifications after downtime.
      if (now < due || now >= due + 90000) continue;
      const key = `${occurrence.event.id}:${occurrence.start}:${lead}`;
      if (state[key]) continue;
      const mention = ROLE_ID ? `<@&${ROLE_ID}>` : undefined;
      const sent = await channel.send({content: mention, embeds:[embedFor(occurrence,lead)], allowedMentions:{roles: ROLE_ID ? [ROLE_ID] : []}});
      state[key] = {sentAt:new Date().toISOString(),messageId:sent.id};
      saveState(state);
      console.log('Sent:', key);
    }
    // Keep at most 14 days of sent records.
    for (const [key,val] of Object.entries(state)) if (Date.parse(val.sentAt) < now - 14*86400000) delete state[key];
    saveState(state);
  } catch (err) { console.error('Scheduler:', err); }
  finally { busy = false; }
}
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  try {
    if (interaction.commandName === 'testevent') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({content:'Manage Server permission required.',flags:MessageFlags.Ephemeral});
      const example = occurrences(new Date(),8)[0];
      await interaction.reply({content:'Sending test message to the configured channel.',flags:MessageFlags.Ephemeral});
      const channel = await client.channels.fetch(CHANNEL_ID);
      await channel.send({embeds:[embedFor(example,5)]});
      return;
    }
    let items = occurrences(new Date(),8).filter(x => x.start > Date.now());
    if (interaction.commandName === 'nextboss') items = items.filter(x => ['siegeboss','nahma','kaira'].includes(x.event.id));
    items = items.slice(0,10);
    await interaction.reply({embeds:[new EmbedBuilder().setTitle(interaction.commandName === 'nextboss' ? 'Upcoming bosses' : 'Upcoming Global Asia events').setColor(0x5865F2).setDescription(items.length ? items.map(x=>`${x.event.emoji} **${x.event.name}** — ${vnTime(x.start)} · <t:${unix(x.start)}:R>`).join('\n') : 'No upcoming events')]});
  } catch (err) { console.error(err); if (!interaction.replied) await interaction.reply({content:'Command failed; check bot logs.',flags:MessageFlags.Ephemeral}).catch(()=>{}); }
});
client.once('clientReady', () => { console.log(`Logged in as ${client.user.tag}`); tick(); setInterval(tick,20000); });
await new REST({version:'10'}).setToken(DISCORD_TOKEN).put(Routes.applicationGuildCommands(CLIENT_ID,GUILD_ID),{body:commands});
await client.login(DISCORD_TOKEN);
