const { Client,GatewayIntentBits,SlashCommandBuilder,REST,Routes,EmbedBuilder,ButtonBuilder,ButtonStyle,ActionRowBuilder} = require("discord.js");
const axios = require("axios");
const express = require("express");
const fs = require("fs");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SHOP_ID = process.env.SHOP_ID;
const API_KEY = process.env.SELLAUTH_API_KEY;

const CHECK_INTERVAL = 60000;

const CONFIG_FILE = "./config.json";

function loadConfig() {
 if (!fs.existsSync(CONFIG_FILE)) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({}));
 }
 return JSON.parse(fs.readFileSync(CONFIG_FILE));
}

function saveConfig(data) {
 fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

let config = loadConfig();
let lastStock = {};

const client = new Client({
 intents: [GatewayIntentBits.Guilds]
});

const commands = [
 new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Setup product tracking")
  .addStringOption(o =>
   o.setName("product_id").setDescription("SellAuth product id").setRequired(true))
  .addChannelOption(o =>
   o.setName("restock_channel").setDescription("Channel for restock").setRequired(true))
  .addChannelOption(o =>
   o.setName("outofstock_channel").setDescription("Channel for out of stock").setRequired(true)),

 new SlashCommandBuilder()
  .setName("remove")
  .setDescription("Remove product tracking")
  .addStringOption(o =>
   o.setName("product_id").setDescription("Product id").setRequired(true)),

 new SlashCommandBuilder()
  .setName("list")
  .setDescription("Show tracked products"),

 new SlashCommandBuilder()
  .setName("testalert")
  .setDescription("Send test alert")
  .addStringOption(o =>
   o.setName("product_id").setDescription("Product id").setRequired(true))
  .addStringOption(o =>
   o.setName("type")
   .setDescription("alert type")
   .setRequired(true)
   .addChoices(
    { name: "restock", value: "restock" },
    { name: "outofstock", value: "outofstock" }
   ))
].map(c => c.toJSON());

async function registerCommands() {
 const rest = new REST({ version: "10" }).setToken(TOKEN);

 await rest.put(
  Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
  { body: commands }
 );
}

async function fetchProducts() {
 const res = await axios.get(
  `https://api.sellauth.com/v1/shops/${SHOP_ID}/products`,
  {
   headers: {
    Authorization: `Bearer ${API_KEY}`
   }
  }
 );

 return res.data.data || [];
}

async function checkStock() {

 try {

  config = loadConfig();

  const products = await fetchProducts();

    for (const product of products) {

  console.log(JSON.stringify(product, null, 2));

  const id = String(product.id);
  const stock = Number(product.stock || 0);
  const name = product.name;

   if (!config[id]) continue;

   const prev = lastStock[id];

   if (prev === undefined) {
    lastStock[id] = stock;
    continue;
   }

if (prev <= 0 && stock > 0) {

  const channel = await client.channels.fetch(config[id].restock);

  const productImage =
    product.image ||
    product.image_url ||
    product.thumbnail ||
    null;

  const productPrice =
    product.price_display ||
    product.price ||
    "Unknown";

  const embed = new EmbedBuilder()
    .setColor("#2ecc71")
    .setTitle(`${name} Restocked`)
    .setDescription(`Our product **${name}** has just been restocked!`)
    .addFields(
      { name: "Variant", value: "Default", inline: true },
      { name: "Price", value: String(productPrice), inline: true },
      { name: "Stock", value: String(stock), inline: true }
    )
    .setFooter({ text: "Niro Market" })
    .setTimestamp();

  if (productImage) {
    embed.setImage(productImage);
  }

  const button = new ButtonBuilder()
    .setLabel("Buy Now")
    .setStyle(ButtonStyle.Link)
    .setURL(`https://niro-market.mysellauth.com`);

  const row = new ActionRowBuilder().addComponents(button);

  await channel.send({
    embeds: [embed],
    components: [row]
  });

}
   if (prev > 0 && stock <= 0) {

    const channel = await client.channels.fetch(config[id].oos);

    const embed = new EmbedBuilder()
     .setTitle("❌ Out Of Stock")
     .setDescription(`${name} is now out of stock`)
     .setTimestamp();

    channel.send({ embeds: [embed] });

   }

   lastStock[id] = stock;

  }

 } catch (err) {

  console.log(err.message);

 }

}

client.on("interactionCreate", async interaction => {

 if (!interaction.isChatInputCommand()) return;

 if (interaction.commandName === "setup") {

  const product = interaction.options.getString("product_id");
  const restock = interaction.options.getChannel("restock_channel");
  const oos = interaction.options.getChannel("outofstock_channel");

  config[product] = {
   restock: restock.id,
   oos: oos.id
  };

  saveConfig(config);

  interaction.reply({
   content: `Setup saved for product ${product}`,
   ephemeral: true
  });

 }

 if (interaction.commandName === "remove") {

  const product = interaction.options.getString("product_id");

  delete config[product];

  saveConfig(config);

  interaction.reply({
   content: `Product removed`,
   ephemeral: true
  });

 }

 if (interaction.commandName === "list") {

  let text = "";

  for (let id in config) {

   text += `Product **${id}**\nRestock: <#${config[id].restock}>\nOutOfStock: <#${config[id].oos}>\n\n`;

  }

  if (text === "") text = "No tracked products";

  interaction.reply({
   content: text,
   ephemeral: true
  });

 }

 if (interaction.commandName === "testalert") {

  const product = interaction.options.getString("product_id");
  const type = interaction.options.getString("type");

  if (!config[product]) {
   return interaction.reply({
    content: "Product not setup",
    ephemeral: true
   });
  }

  if (type === "restock") {

   const channel = await client.channels.fetch(config[product].restock);

   channel.send("🔥 Test Restock Alert");

  }

  if (type === "outofstock") {

   const channel = await client.channels.fetch(config[product].oos);

   channel.send("❌ Test Out Of Stock Alert");

  }

  interaction.reply({
   content: "Test sent",
   ephemeral: true
  });

 }

});

client.once("ready", async () => {

 console.log("Bot ready");

 await registerCommands();

 setInterval(checkStock, CHECK_INTERVAL);

});

client.login(TOKEN);

const app = express();

app.get("/", (req, res) => {
 res.send("Bot running");
});

app.listen(process.env.PORT || 3000);
