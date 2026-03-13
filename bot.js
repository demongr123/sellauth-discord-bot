const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ChannelType
} = require("discord.js");
const axios = require("axios");
const express = require("express");
const fs = require("fs");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SHOP_ID = process.env.SHOP_ID;
const SELLAUTH_API_KEY = process.env.SELLAUTH_API_KEY;

const PORT = process.env.PORT || 3000;
const CHECK_INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS || 60000);
const DAILY_STOCK_INTERVAL_MS = Number(process.env.DAILY_STOCK_INTERVAL_MS || 86400000);

const STORE_NAME = "Niro Market";
const STORE_URL = "https://niro-market.mysellauth.com";
const EMBED_COLOR = "#57F287";

const CONFIG_FILE = "./config.json";

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID || !SHOP_ID || !SELLAUTH_API_KEY) {
  console.error("Missing required environment variables.");
  process.exit(1);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({}, null, 2));
  }

  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch (error) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({}, null, 2));
    return {};
  }
}

function saveConfig(data) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

let config = loadConfig();
const lastStock = {};

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const app = express();

app.get("/", (_req, res) => {
  res.send("Niro Market bot is running.");
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});

const commands = [
  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("Set the stock alerts channel")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Channel for stock alerts")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("removechannel")
    .setDescription("Remove the stock alerts channel"),

  new SlashCommandBuilder()
    .setName("channel")
    .setDescription("Show the current stock alerts channel"),

  new SlashCommandBuilder()
    .setName("testrestock")
    .setDescription("Send a test restock alert"),

  new SlashCommandBuilder()
    .setName("teststock")
    .setDescription("Send a test daily stock update")
].map(command => command.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("Slash commands registered.");
}

async function fetchProducts() {
  const response = await axios.get(
    `https://api.sellauth.com/v1/shops/${SHOP_ID}/products`,
    {
      headers: {
        Authorization: `Bearer ${SELLAUTH_API_KEY}`,
        Accept: "application/json"
      },
      timeout: 15000
    }
  );

  return response.data?.data || [];
}

function getProductName(product) {
  return product.name || `Product ${product.id}`;
}

function normalizeImageUrl(value) {
  if (!value || typeof value !== "string") return null;
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return null;
}

function getProductImage(product) {
  const candidates = [
    product?.images?.[0]?.url,
    product?.images?.[0]?.image?.url,
    product?.images?.[0]?.src,
    product?.images?.[0]?.secure_url,

    product?.image?.url,
    product?.image?.src,
    product?.image?.secure_url,

    product?.thumbnail?.url,
    product?.thumbnail,
    product?.featured_image?.url,
    product?.featured_image,

    product?.url,
    product?.image_url,
    product?.image,
    product?.cover_image,
    product?.cover?.url
  ];

  for (const candidate of candidates) {
    const normalized = normalizeImageUrl(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function getProductPrice(product) {
  const raw =
    product.price_display ??
    product.display_price ??
    product.price_with_currency ??
    product.currency_price ??
    product.price_formatted ??
    product.price ??
    product.variant?.price ??
    product.variants?.[0]?.price ??
    null;

  if (raw === null || raw === undefined || raw === "") {
    return "Unknown";
  }

  if (typeof raw === "number") {
    return `€${raw}`;
  }

  return String(raw);
}

function getProductStock(product) {
  const raw =
    product.stock ??
    product.quantity ??
    product.virtual_stock ??
    product.variants?.[0]?.stock ??
    product.variants?.[0]?.quantity ??
    0;

  const parsed = Number(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function buildStoreButton(label = "Buy Now") {
  const button = new ButtonBuilder()
    .setLabel(label)
    .setStyle(ButtonStyle.Link)
    .setURL(STORE_URL);

  return new ActionRowBuilder().addComponents(button);
}

function buildRestockEmbed(product) {
  const name = getProductName(product);
  const price = getProductPrice(product);
  const stock = getProductStock(product);
  const image = getProductImage(product);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`${name} Restocked`)
    .setDescription(`**${name}** has just been restocked in **${STORE_NAME}**.`)
    .addFields(
      { name: "Price", value: `**${price}**`, inline: true },
      { name: "Stock", value: `**${stock}**`, inline: true },
      { name: "Store", value: `**${STORE_NAME}**`, inline: true }
    )
    .setFooter({ text: STORE_NAME })
    .setTimestamp();

  if (image) {
    embed.setImage(image);
  }

  return embed;
}

function buildDailyStockEmbeds(products) {
  const productLines = products
    .sort((a, b) => getProductStock(b) - getProductStock(a))
    .map(product => {
      const name = getProductName(product);
      const price = getProductPrice(product);
      const stock = getProductStock(product);

      return `**${name}**\nPrice: **${price}** • Stock: **${stock}**`;
    });

  const chunks = [];
  let currentChunk = "";

  for (const line of productLines) {
    const nextChunk = currentChunk ? `${currentChunk}\n\n${line}` : line;

    if (nextChunk.length > 3800) {
      chunks.push(currentChunk);
      currentChunk = line;
    } else {
      currentChunk = nextChunk;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks.map((chunk, index) =>
    new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(
        index === 0
          ? `${STORE_NAME} Stock Update`
          : `${STORE_NAME} Stock Update (${index + 1})`
      )
      .setDescription(chunk)
      .setFooter({ text: STORE_NAME })
      .setTimestamp()
  );
}

async function getConfiguredChannel() {
  config = loadConfig();

  if (!config.channel_id) {
    return null;
  }

  try {
    const channel = await client.channels.fetch(config.channel_id);
    if (!channel || !channel.isTextBased()) return null;
    return channel;
  } catch (error) {
    console.error("Failed to fetch configured channel:", error.message);
    return null;
  }
}

async function sendDailyStockSummary() {
  try {
    const channel = await getConfiguredChannel();
    if (!channel) return;

    const products = await fetchProducts();

    if (!products.length) {
      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setTitle(`${STORE_NAME} Stock Update`)
            .setDescription("**No products found right now.**")
            .setFooter({ text: STORE_NAME })
            .setTimestamp()
        ],
        components: [buildStoreButton("Open Store")]
      });
      return;
    }

    const embeds = buildDailyStockEmbeds(products);

    for (let i = 0; i < embeds.length; i++) {
      await channel.send({
        embeds: [embeds[i]],
        components: i === 0 ? [buildStoreButton("Open Store")] : []
      });
    }
  } catch (error) {
    console.error("sendDailyStockSummary error:", error.response?.data || error.message);
  }
}

async function checkStockChanges() {
  try {
    const channel = await getConfiguredChannel();
    if (!channel) return;

    const products = await fetchProducts();

    for (const product of products) {
      const id = String(product.id);
      const stock = getProductStock(product);
      const prev = lastStock[id];

      if (prev === undefined) {
        lastStock[id] = stock;
        continue;
      }

      if (prev <= 0 && stock > 0) {
        await channel.send({
          embeds: [buildRestockEmbed(product)],
          components: [buildStoreButton("Buy Now")]
        });
      }

      lastStock[id] = stock;
    }

    const currentIds = new Set(products.map(product => String(product.id)));
    for (const id of Object.keys(lastStock)) {
      if (!currentIds.has(id)) {
        delete lastStock[id];
      }
    }
  } catch (error) {
    console.error("checkStockChanges error:", error.response?.data || error.message);
  }
}

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "setchannel") {
      const channel = interaction.options.getChannel("channel");
      config.channel_id = channel.id;
      saveConfig(config);

      await interaction.reply({
        content: `✅ Stock alerts channel set to <#${channel.id}>`,
        ephemeral: true
      });
      return;
    }

    if (interaction.commandName === "removechannel") {
      if (!config.channel_id) {
        await interaction.reply({
          content: "❌ No stock channel is set.",
          ephemeral: true
        });
        return;
      }

      delete config.channel_id;
      saveConfig(config);

      await interaction.reply({
        content: "🗑️ Stock alerts channel removed.",
        ephemeral: true
      });
      return;
    }

    if (interaction.commandName === "channel") {
      if (!config.channel_id) {
        await interaction.reply({
          content: "❌ No stock channel is set.",
          ephemeral: true
        });
        return;
      }

      await interaction.reply({
        content: `📢 Current stock alerts channel: <#${config.channel_id}>`,
        ephemeral: true
      });
      return;
    }

    if (interaction.commandName === "testrestock") {
      const channel = await getConfiguredChannel();

      if (!channel) {
        await interaction.reply({
          content: "❌ Set a channel first with /setchannel",
          ephemeral: true
        });
        return;
      }

      const fakeProduct = {
        id: "test",
        name: "Test Product",
        price_display: "€0.00",
        stock: 25,
        images: [
          {
            url: "https://api.sellauth.com/storage/images/811919.webp"
          }
        ]
      };

      await channel.send({
        embeds: [buildRestockEmbed(fakeProduct)],
        components: [buildStoreButton("Buy Now")]
      });

      await interaction.reply({
        content: "✅ Test restock alert sent.",
        ephemeral: true
      });
      return;
    }

    if (interaction.commandName === "teststock") {
      await interaction.reply({
        content: "✅ Sending test stock update...",
        ephemeral: true
      });

      await sendDailyStockSummary();
      return;
    }
  } catch (error) {
    console.error("interactionCreate error:", error);
    if (!interaction.replied) {
      await interaction.reply({
        content: "❌ Something went wrong.",
        ephemeral: true
      });
    }
  }
});

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  await registerCommands();

  try {
    const products = await fetchProducts();
    for (const product of products) {
      lastStock[String(product.id)] = getProductStock(product);
    }
    console.log(`Loaded ${products.length} products.`);
  } catch (error) {
    console.error("Initial load error:", error.response?.data || error.message);
  }

  setInterval(checkStockChanges, CHECK_INTERVAL_MS);
  setInterval(sendDailyStockSummary, DAILY_STOCK_INTERVAL_MS);
});

client.login(DISCORD_TOKEN);
