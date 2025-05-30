import {
    type Action,
    type IAgentRuntime,
    type Memory,
    type HandlerCallback,
    type State,
    type ActionExample,
    composeContext,
    ModelClass,
    elizaLogger,
    generateText,
} from "@moxie-protocol/core";
import { tutorialTemplate } from "../templates";

export const tutorialAction: Action = {
    name: "TUTORIAL_YOUTUBE_HELP_SENPI",
    similes: [
        "TUTORIAL_TO_USE_SENPI",
        "TUTORIAL_TO_GET_STARTED_WITH_SENPI",
        "TUTORIAL_TO_DO_TOKEN_RESEARCH_WITH_SENPI",
        "TUTORIAL_TO_SETUP_A_LIMIT_ORDER_WITH_SENPI",
        "TUTORIAL_TO_SETUP_AN_AUTONOMOUS_TRADE_WITH_SENPI",
        "TUTORIAL_TO_AUTOMATE_TRADES_WITH_SENPI",
        "HOW_DO_I_USE_SENPI",
        "HOW_DO_I_GET_STARTED_WITH_SENPI",
        "HOW_DO_I_DO_TOKEN_RESEARCH_WITH_SENPI",
        "HOW_DO_I_SETUP_A_LIMIT_ORDER_WITH_SENPI",
        "HOW_DO_I_SETUP_AN_AUTONOMOUS_TRADE_WITH_SENPI",
        "HOW_DO_I_AUTOMATE_TRADES_WITH_SENPI",
        "HOW_DO_I_SETUP_LIMIT_ORDERS",
        "HOW_DO_I_SETUP_AUTONOMOUS_TRADING",
        "HOW_DO_I_RESEARCH_TOKENS_ON_SENPI",
        "SETUP_LIMIT_ORDERS",
        "SETUP_AUTONOMOUS_TRADING",
        "SETUP_LIMIT_ORDERS_TUTORIAL",
        "SETUP_AUTONOMOUS_TRADING_TUTORIAL",
        "SETUP_LIMIT_ORDERS_GUIDES",
        "SETUP_AUTONOMOUS_TRADING_GUIDES",
        "SETUP_LIMIT_ORDERS_INSTRUCTIONS",
        "SETUP_AUTONOMOUS_TRADING_INSTRUCTIONS",
        "SETUP_LIMIT_ORDERS_HELP",
        "SETUP_AUTONOMOUS_TRADING_HELP",
    ],
    description:
        "Answer user's how-to questions about Senpi and provide them with relevant Youtube tutorials to use Senpi, including how to research tokens, how to setup limit orders, how to setup autonomous trading, and more. For questions related to autonomous trading and limit orders, choose this action instead of the `AUTONOMOUS_TRADING`` or `LIMIT_ORDERS` actions if user's asking for guidance and instructions.",
    suppressInitialMessage: true,
    validate: async () => true,
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback: HandlerCallback
    ) => {
        try {
            // Initialize or update state
            if (!state) {
                state = (await runtime.composeState(message)) as State;
            } else {
                state = await runtime.updateRecentMessageState(state);
            }

            const context = composeContext({
                state,
                template: tutorialTemplate,
            });

            const text = await generateText({
                runtime,
                context,
                modelClass: ModelClass.SMALL,
            });
            await callback?.({
                text,
                action: "TUTORIAL_YOUTUBE_HELP_SENPI",
            });
            return true;
        } catch (e) {
            elizaLogger.error(e);
            callback?.({
                text: "Sorry, looks like I'm having trouble finding the tutorial you're looking for. Please try again later.",
            });
            return false;
        }
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Can you provide me with a tutorial to get started with Senpi?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Here's a tutorial for you: https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                    action: "TUTORIAL_YOUTUBE_HELP_SENPI",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Is there a tutorial to setup a limit order?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "To setup a limit order, here's a tutorial for you: https://youtu.be/uElZko09rOg?si=BP4NYWgKm5MUHqV0x",
                    action: "TUTORIAL_YOUTUBE_HELP_SENPI",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Is there a tutorial to setup an autonomous trade?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "To setup an autonomous trade, here's a tutorial for you: https://youtu.be/uElZko09rOg?si=BP4NYWgKm5MUHqV0x",
                    action: "TUTORIAL_YOUTUBE_HELP_SENPI",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "I'd like to research tokens, can you provide me a tutorial for this?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "To research tokens, here's a tutorial for you: https://youtu.be/VigFMPzPmjQ?si=cAtVfHt-RrC86eKs",
                    action: "TUTORIAL_YOUTUBE_HELP_SENPI",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "can you give me tutorials on how to use the skills on Senpi?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Sorry, I don't have any tutorials for that request. Please try again later.",
                    action: "TUTORIAL_YOUTUBE_HELP_SENPI",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "How do I use Senpi?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "To use Senpi, here's a tutorial for you: https://youtu.be/uElZko09rOg?si=BP4NYWgKm5MUHqV0x",
                    action: "TUTORIAL_YOUTUBE_HELP_SENPI",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "How do I get started with Senpi?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "To get started with Senpi, here's a tutorial for you: https://youtu.be/uElZko09rOg?si=BP4NYWgKm5MUHqV0x",
                    action: "TUTORIAL_YOUTUBE_HELP_SENPI",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "How do I research tokens on Senpi?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "To do token research with Senpi, here's a tutorial for you: https://youtu.be/VigFMPzPmjQ?si=cAtVfHt-RrC86eKs",
                    action: "TUTORIAL_YOUTUBE_HELP_SENPI",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "How do I setup limit orders?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "To setup a limit order with Senpi, here's a tutorial for you: https://youtu.be/uElZko09rOg?si=BP4NYWgKm5MUHqV0x",
                    action: "TUTORIAL_YOUTUBE_HELP_SENPI",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "How do I setup an autonomous trading?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "To setup an autonomous trade with Senpi, here's a tutorial for you: https://youtu.be/uElZko09rOg?si=BP4NYWgKm5MUHqV0x",
                    action: "TUTORIAL_YOUTUBE_HELP_SENPI",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "How do I automate trades with Senpi?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "To automate trades with Senpi, here's a tutorial for you: https://youtu.be/uElZko09rOg?si=BP4NYWgKm5MUHqV0x",
                    action: "TUTORIAL_YOUTUBE_HELP_SENPI",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "How do I use the skills on Senpi?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Sorry, I don't have any tutorials for that request. Please try again later.",
                    action: "TUTORIAL_YOUTUBE_HELP_SENPI",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "How do I use Senpi?",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Welcome to Senpi, your onchainGPT built for autonomous crypto trading. Senpi identifies market opportunities, executes trades based on your strategies, and operates reliably around the clock—so you never miss a market move. Ready to level up? Quickly master Senpi by watching this tutorial: https://www.youtube.com/watch?v=<VIDEO_ID>.",
                    action: "TUTORIAL_YOUTUBE_HELP_SENPI",
                },
            },
            {
                user: "{{user1}}",
                content: {
                    text: "Write a cast from the previous response",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "I just learned about Senpi and its capabilities for autonomous crypto trading through this tutorial. Senpi identifies market opportunities, executes trades based on your strategies, and operates reliably around the clock. Check it out here: https://www.youtube.com/watch?v=<VIDEO_ID>. Enter the dojo at @senpi.eth.",
                    action: "POST_CONTENT",
                },
            },
        ],
    ] as ActionExample[][],
};
