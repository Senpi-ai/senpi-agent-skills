# `plugin-wallet-duster`

Turn your dust into ETH.
AI Duster scans your Senpi Agent wallet for low-value ERC-20 tokens and
automatically swaps them to ETH — with full support for threshold customization
and dry-run previews.

---

## 🚀 What It Does

- 🧹 **Dusting:** Finds ERC-20 tokens below a USD value (default: $5)
- 🔄 **Swaps to ETH:** Uses the 0x API and agent wallet for safe, gas-aware execution
- 💬 **Natural Language Support:** Prompts like “Dust tokens under $10” or “Preview dust” just work
- 🧪 **Preview Mode (`dryRun`):** See what would be swapped without sending a transaction

---

## 💬 Example Prompts

```txt
Dust my wallet for anything under $5.
Swap all tokens under $10 into ETH.
Preview what tokens you'd dust from my wallet.
```

---

## 🧪 Local Setup (Senpi Agent)

Want to run this skill locally with the full **Senpi Agent + Client stack**? Follow these steps:

```bash
# Set correct Node version
pnpm env use --global 23.3.0

# Clone and set up the monorepo
git clone git@github.com:senpi-ai/senpi-agent-skills.git
cd senpi-agent-skills
git checkout -b feature/plugin-wallet-duster
pnpm install --no-frozen-lockfile

# Build agent libs and workspace
cd ./packages/moxie-agent-lib && pnpm run build && cd ../../ && pnpm build

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys

# Start the agent
pnpm start

# In a second terminal
pnpm start:client
# Open: http://localhost:5173/
```

---

## 📦 Workspace Dependencies

Make sure the following are installed in your root or plugin workspace:

```bash
pnpm add zod --workspace
pnpm add qs --workspace
pnpm add @moxie-protocol/core --workspace
pnpm add @moxie-protocol/moxie-agent-lib --workspace
```

---

## 🔑 Environment Variables

Add the following to your `.env`:

```env
ZAPPER_API_KEY=your-zapper-api-key
ZERO_EX_API_KEY=your-0x-api-key
```

---

## 🧪 Test Preview Mode

You can test dusting in dry run mode using prompts like:

```txt
Preview what tokens you’d dust from my wallet.
```

Example expected response:

```
🧪 Preview: You have 4 dust token(s) totaling ~$12.45:
- 0xabc... (100000 tokens worth ~$2.14)
- 0xdef... (90000 tokens worth ~$3.20)
- 0x123... (5000 tokens worth ~$2.08)
```

✅ No swaps are sent in dryRun mode.

---

## 🧠 Skill Metadata

This Skill is registered with the Senpi Skills Marketplace and is fully compliant with ElizaOS:

- ✅ Token-gated via `alexcomeau` token
- ✅ Supports actions: `DUST_WALLET_TO_ETH`, `PREVIEW_DUSTING_MY_WALLET`
- ✅ Supports `dryRun` preview mode
- ✅ Fully integrated with Senpi Agent Wallet API

---

## 🛠️ Troubleshooting

**Sharp Package Error**

```bash
export SHARP_IGNORE_GLOBAL_LIBVIPS=1
```

**SQLite Vector Embedding Error**

```bash
rm agent/data/db.sqlite
pnpm start
```

---

## 📄 License

**MIT** — open to use, extend, and remix.

---

### ✨ Made by Alex & Yoseph from [Airstack](https://airstack.xyz)
