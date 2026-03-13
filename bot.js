const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const express = require("express");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const SHOP_ID = process.env.SHOP_ID;
const SELLAUTH_API_KEY = process.env.SELLAUTH_API_KEY;
const CHECK_INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS || 60000);

// Render web service must bind to PORT. Render sets PORT automatically.
// Default is usually 10000 for web services.
const PORT = process.env.PORT || 10000;

if (!DISCORD_TOKEN || !CHANNEL_ID || !SHOP_ID || !SELLAUTH_API_KEY) {
  console.error("Missing required environment variables.");
  process.exit(1);
}

const app = express();
app.get("/", (_req, res) => {
  res.status(200).send("Bot is alive");
});

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, uptime: process.uptime() });
});

app.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// Αποθηκεύουμε προηγούμενο stock για να στέλνει μόνο όταν αλλάζει
const lastStock = new Map();
let botReady = false;

async function fetchProducts() {
  // Αν το δικό σου endpoint είναι διαφορετικό, θα το αλλάξουμε μετά.
  const url = `https://api.sellauth.com/v1/shops/${SHOP_ID}/products`;

  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${SELLAUTH_API_KEY}`,
      Accept: "application/json"
    },
    timeout: 15000
  });

  return response.data?.data || [];
}

async function checkStock() {
  if (!botReady) return;

  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel || !channel.isTextBased()) {
      console.error("Invalid Discord channel.");
      return;
    }

    const products = await fetchProducts();

    for (const product of products) {
      const name = product.name || "Unknown Product";
      const id = String(product.id ?? name);
      const stock = Number(product.stock ?? 0);
      const prev = lastStock.has(id) ? lastStock.get(id) : null;

      // πρώτο πέρασμα: αποθήκευση χωρίς spam
      if (prev === null) {
        lastStock.set(id, stock);
        continue;
      }

      // restock
      if (prev <= 0 && stock > 0) {
        const embed = new EmbedBuilder()
          .setTitle("Restock")
          .setDescription(`Το **${name}** είναι ξανά διαθέσιμο.`)
          .addFields(
            { name: "Stock", value: String(stock), inline: true },
            { name: "Product ID", value: id, inline: true }
          )
          .setTimestamp();

        await channel.send({ embeds: [embed] });
      }

      // out of stock
      if (prev > 0 && stock <= 0) {
        await channel.send(`❌ **${name}** είναι τώρα out of stock.`);
      }

      lastStock.set(id, stock);
    }
  } catch (error) {
    console.error("checkStock error:", error.response?.data || error.message);
  }
}

client.once("ready", async () => {
  botReady = true;
  console.log(`Logged in as ${client.user.tag}`);

  // αρχικό check
  await checkStock();

  // επαναληπτικός έλεγχος
  setInterval(checkStock, CHECK_INTERVAL_MS);
});

client.login(DISCORD_TOKEN);
