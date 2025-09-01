import express from "express";
import bodyParser from "body-parser";
import Web3 from "web3";
import TelegramBot from "node-telegram-bot-api";

// === CONFIG ===
const TELEGRAM_BOT_TOKEN = "8141338863:AAGCtAXF9RNl-v6E6Djk2yAJTtXEqSlcVY4";
const CHAT_ID = "8270313050"; // your Telegram user/group ID
const PRIVATE_KEY = "0x63d52e9b019498230f56d07e2192581f4b64633bc767d5a434e4350a119e9fbe"; // test wallet key
const USDT_CONTRACT = "0x55d398326f99059fF775485246999027B3197955"; // USDT BEP20
const RPC_URL = "https://bsc-dataseed.binance.org/";

// === INIT ===
const app = express();
app.use(bodyParser.json());
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
const web3 = new Web3(new Web3.providers.HttpProvider(RPC_URL));

// Load wallet
web3.eth.accounts.wallet.add(PRIVATE_KEY);
const senderAddress = web3.eth.accounts.wallet[0].address;
console.log("✅ Wallet loaded:", senderAddress);

// USDT ABI (transfer + decimals)
const usdtAbi = [
  {
    constant: false,
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    type: "function"
  },
  {
    constant: true,
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    type: "function"
  }
];
const usdt = new web3.eth.Contract(usdtAbi, USDT_CONTRACT);

// Store pending transfers
let pendingTransfers = {};

// === API Endpoint (Frontend calls this) ===
app.post("/request-transfer", async (req, res) => {
  const { from, to, amount } = req.body;
  const requestId = Date.now().toString();

  // Save request
  pendingTransfers[requestId] = { from, to, amount };

  // Send Telegram message with approve button
  await bot.sendMessage(
    CHAT_ID,
    `🔔 New Transfer Request\n\nFrom: ${from}\nTo: ${to}\nAmount: ${amount} USDT`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Approve", callback_data: `approve_${requestId}` },
          { text: "❌ Reject", callback_data: `reject_${requestId}` }
        ]]
      }
    }
  );

  res.json({ status: "pending", requestId });
});

// === Handle Telegram Actions ===
bot.on("callback_query", async (msg) => {
  const data = msg.data;
  const chatId = msg.message.chat.id;

  if (data.startsWith("approve_")) {
    const requestId = data.split("_")[1];
    const transfer = pendingTransfers[requestId];
    if (!transfer) return;

    try {
      // Get decimals from contract
      const decimals = await usdt.methods.decimals().call();
      const amountInWei = web3.utils.toBN(
        web3.utils.toWei(transfer.amount, "ether")
      ).div(web3.utils.toBN(10).pow(web3.utils.toBN(18 - decimals)));

      // Send tx
      const tx = await usdt.methods
        .transfer(transfer.to, amountInWei.toString())
        .send({ from: senderAddress, gas: 200000 });

      await bot.sendMessage(
        chatId,
        `✅ Transfer Approved\nHash: ${tx.transactionHash}`
      );
      delete pendingTransfers[requestId];
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Transfer Failed: ${err.message}`);
    }
  }

  if (data.startsWith("reject_")) {
    const requestId = data.split("_")[1];
    delete pendingTransfers[requestId];
    await bot.sendMessage(chatId, "❌ Transfer Rejected");
  }
});

// === Start Server ===
app.listen(3000, () =>
  console.log("🚀 Backend running on http://localhost:3000")
);
