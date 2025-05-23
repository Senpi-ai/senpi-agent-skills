import { composeContext, elizaLogger } from "@moxie-protocol/core";
import {
    Action,
    ActionExample,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    State,
    streamText,
} from "@moxie-protocol/core";
import { agentCapabilitiesTemplate } from "../templates";

export const agentCapabilitiesAction: Action = {
    name: "AGENT_CAPABILITIES",
    similes: [
        "AGENT_ACTIONS",
        "AGENT_CAPABILITY",
        "WHAT_CAN_YOU_DO",
        "EXPLAIN_WALLET_DUSTING",
        "WHAT_IS_WALLET_DUSTING",
        "HOW_DOES_WALLET_DUSTING_WORK",
        "WHAT_DOES_THE_WALLET_DUSTING_SKILL_DO",
        "EXPLAIN_WALLET_DUSTING",
        "WHAT_IS_WALLET_DUSTING",
    ],
    description:
        'ONLY use this action when the user is inquiring about the agent’s overall capabilities — i.e., "What can the agent do?" — or when asking about the capabilities of a specific skill, e.g. "How does Wallet Dusting work?". Note: At present, this action currently supports only the Wallet Dusting skill and answering how does wallet dusting work.',
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        return true;
    },
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        options: any,
        callback: HandlerCallback
    ) => {
        elizaLogger.info(
            "AGENT_CAPABILITIES",
            "Starting agent capabilities action"
        );
        if (!state) {
            state = (await runtime.composeState(message)) as State;
        }
        state = await runtime.updateRecentMessageState(state);

        const agentCapabilities = composeContext({
            state,
            template: agentCapabilitiesTemplate,
        });

        const capabilities = streamText({
            runtime,
            context: agentCapabilities,
            modelClass: ModelClass.MEDIUM,
        });

        for await (const textPart of capabilities) {
            callback({ text: textPart, action: "AGENT_CAPABILITIES" });
        }
        elizaLogger.success(
            "[AGENT_CAPABILITIES] Successfully generated agent capabilities"
        );

        return true;
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "What can you do?",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: `I'm your onchainGPT — built to trade, track, and hunt alpha while you sleep.
Here’s just a glimpse of what I can do for you:
- Auto-Buy when top wallets move, and Auto-Sell when they exit — even combining exit strategies to protect your gains.
- Set Limit Orders — dip buys, profit-taking sells, all automated.
- Analyze any wallet — your portfolio, your trades, or any user's on Base.
- Copy social alpha — track what top wallets and builders are buying, selling, and saying across socials.
- Create and manage trading groups — instantly spin up new squads and add your frens.
- Whale Hunt — follow the biggest players by token, by day, or by chain.
- Find the hottest tokens — trending today, trending last 4 hours, or live across Base.
- Swap tokens, send tokens — lightning-fast, always onchain.
- Track social sentiment — find out what the market is feeling before it moves.

In short: I help you move faster, trade smarter, and exit sharper — with one-click commands or fully autonomous setups.
:crossed_swords: Welcome to the dojo of onchain alpha.`,
                    action: "AGENT_CAPABILITIES",
                },
            },
        ],

        [
            {
                user: "{{user1}}",
                content: {
                    text: "Tell me about your capabilities.",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: `I'm your onchainGPT — built to trade, track, and hunt alpha while you sleep.
Here’s just a glimpse of what I can do for you:
- Auto-Buy when top wallets move, and Auto-Sell when they exit — even combining exit strategies to protect your gains.
- Set Limit Orders — dip buys, profit-taking sells, all automated.
- Analyze any wallet — your portfolio, your trades, or any user's on Base.
- Copy social alpha — track what top wallets and builders are buying, selling, and saying across socials.
- Create and manage trading groups — instantly spin up new squads and add your frens.
- Whale Hunt — follow the biggest players by token, by day, or by chain.
- Find the hottest tokens — trending today, trending last 4 hours, or live across Base.
- Swap tokens, send tokens — lightning-fast, always onchain.
- Track social sentiment — find out what the market is feeling before it moves.

In short: I help you move faster, trade smarter, and exit sharper — with one-click commands or fully autonomous setups.
:crossed_swords: Welcome to the dojo of onchain alpha.`,
                    action: "AGENT_CAPABILITIES",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: { text: "How does Wallet Dusting work?" },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Wallet Dusting automatically scans your wallet for low-value tokens — often called 'dust' — and converts them into ETH...",
                    action: "AGENT_CAPABILITIES",
                },
            },
        ],
    ] as ActionExample[][],
} as Action;
