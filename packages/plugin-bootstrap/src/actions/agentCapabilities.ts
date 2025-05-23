import { composeContext, elizaLogger } from "@moxie-protocol/core";
import {
    Action,
    ActionExample,
    Content,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    State,
    streamText,
} from "@moxie-protocol/core"; 

export const agentCapabilitiesTemplate = `
<conversation_history>
{{recentMessages}}
</conversation_history>

Focus on the latest messages in the conversation history. And see if the user is asking about the capabilities of the agent.

Below is the list of capabilities that the agent has along with the description:

{{actions}}

These represent the actions that the agent can perform.

Please review the above capabilities to understand what the agent can do in response to your queries.

Actions to ignore: CONTINUE, FOLLOW_ROOM, IGNORE, MUTE_ROOM, NONE, UNFOLLOW_ROOM, UNMUTE_ROOM

You can start like this:

"Hi, I'm {{agentName}}, your AI edge in the market

Here are the actions that I can perform:

- Auto-Buy when top wallets move, and Auto-Sell when they exit — even combining exit strategies to protect your gains.
- Set Limit Orders — dip buys, profit-taking sells, all automated.
- Analyze any wallet — your portfolio, your trades, or any user's on Base.
- Copy social alpha — track what top wallets and builders are buying, selling, and saying across socials.
- Create and manage trading groups — instantly spin up new squads and add your frens.
- Whale Hunt — follow the biggest players by token, by day, or by chain.
- Find the hottest tokens — trending today, trending last 4 hours, or live across Base.
- Swap tokens, send tokens — lightning-fast, always onchain.
- Track social sentiment — find out what the market is feeling before it moves."

Update the above response based on the latest actions that the agent has.
`;

export const agentCapabilitiesAction: Action = {
    name: "AGENT_CAPABILITIES",
    similes: ["AGENT_ACTIONS", "AGENT_CAPABILITY", "WHAT_CAN_YOU_DO"],
    description:
        "ONLY use this action when the user is asking about the capabilities of agent in other words, what can the agent do?",
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
        elizaLogger.info("AGENT_CAPABILITIES", "Starting agent capabilities action");
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
        elizaLogger.success("[AGENT_CAPABILITIES] Successfully generated agent capabilities");

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
                    action: "AGENT_CAPABILITIES" 
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
                content: { text: `I'm your onchainGPT — built to trade, track, and hunt alpha while you sleep.
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
:crossed_swords: Welcome to the dojo of onchain alpha.`, action: "AGENT_CAPABILITIES" },
            },
        ],
    ] as ActionExample[][],
} as Action;
