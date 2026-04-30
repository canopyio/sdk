# create-canopy-agent

Scaffold a pre-configured Canopy agent starter and provision the matching policy + agent in your Canopy org — in one guided command.

```bash
npx create-canopy-agent my-trading-bot
```

The CLI will:

1. Ask which starter to scaffold (trading-defi, research, lead-gen, content-creator, treasury-billpay, travel).
2. Connect to your Canopy org via your org API key (validated against `/api/me`).
3. Create a policy with the starter's recommended preset (or your customization — including a "no approvals needed" option).
4. Create an agent bound to that policy.
5. Scaffold the starter project locally, write `.env` with `CANOPY_API_KEY` + `CANOPY_AGENT_ID` + `ANTHROPIC_API_KEY`.

You only paste two keys: your Canopy org API key (`ak_live_…`) and your Anthropic API key (`sk-ant-…`).

## Available starters

| Starter | What it does |
|---|---|
| `trading-defi-agent` | Quote → validate → execute via price feeds + DEXes |
| `research-agent` | Multi-source research; pays for gated data APIs |
| `lead-gen-agent` | Enrich/verify B2B contacts via per-lead paid APIs |
| `content-creator-agent` | Pay for stock assets + AI image/voice/video generation |
| `treasury-billpay-agent` | Pay vendor invoices + recurring subs within budget |
| `travel-agent` | Search flights/airport schedules; surface options before booking |

All starters are built on [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) with Canopy's hosted MCP server (`https://mcp.trycanopy.ai/mcp`). Zero Canopy code in the templates — the agent reaches Canopy via MCP with your API key + agent id passed as auth headers.

## Requirements

- Node 18+
- A Canopy account with a provisioned treasury (one-time dashboard setup at <https://trycanopy.ai>)
- An Anthropic API key (Claude Agent SDK runs on Claude)

## Local dev

```bash
npm install
npm run start  # tsx src/cli.ts
```

For source-tree dev, the scaffolder reads templates from `../../canopy-agent-starters/`. After `npm run build`, it reads from `dist/templates/`.

## License

MIT
