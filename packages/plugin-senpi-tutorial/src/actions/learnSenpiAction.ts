import {
    Action,
    ActionExample,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    State,
} from "@moxie-protocol/core";

export const learnSenpiAction: Action = {
    name: "LEARN_SENPI",
    similes: [
        "LEARN_SENPI",
        "LEARN_SENPI_TUTORIAL",
        "LEARN_SENPI_TUTORIALS",
        "LEARN_SENPI_TUTORIAL_FOR_SENPI",
        "WHAT_TUTORIALS_ARE_AVAILABLE_FOR_SENPI",
        "MENTION_ALL_TUTORIALS_FOR_SENPI",
        "LIST_ALL_TUTORIALS_FOR_SENPI",
        "LIST_ALL_AVAILABLE_TUTORIALS_FOR_SENPI",
        "LIST_ALL_AVAILABLE_TUTORIAL_HELP_SENPI",
    ],
    description: "Learn how to use Senpi complete with all the tutorials",
    suppressInitialMessage: true,
    validate: async () => true,
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback: HandlerCallback
    ) => {
        callback({
            text: `Welcome to Senpi, your onchainGPT built for autonomous crypto trading. Senpi identifies market opportunities, executes trades based on your strategies, and operates reliably around the clock—so you never miss a market move.

Ready to level up? Quickly master Senpi by watching this tutorial:

<iframe src="${process.env.GET_STARTED_TUTORIAL_URL_EMBED}" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>

Want to learn more? Click one of the buttons below to explore more essential videos.

And don’t forget to join The Dojo! Our official Senpi Telegram group ([Join Now](${process.env.SENPI_TELEGRAM_GROUP_URL})) to ask questions, get insider alpha, share feedback, and chat directly with our team 🥷.`,
            action: "LEARN_SENPI",
            cta: [
                "HOW_DO_I_SETUP_AN_AUTONOMOUS_TRADE_WITH_SENPI",
                "HOW_DO_I_DO_TOKEN_RESEARCH_WITH_SENPI",
                "HOW_DO_I_SETUP_A_LIMIT_ORDER_WITH_SENPI",
            ],
        });
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Learn Senpi",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Here are all the tutorials for Senpi: [Watch Now](${process.env.GET_STARTED_SENPI_YOUTUBE_URL})",
                    action: "LEARN_SENPI",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Can you list all the tutorials for Senpi?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Here are all the tutorials for Senpi: [Watch Now](${process.env.GET_STARTED_SENPI_YOUTUBE_URL})",
                    action: "LEARN_SENPI",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Learn Senpi.",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Welcome to Senpi, your onchainGPT built for autonomous crypto trading. Senpi identifies market opportunities, executes trades based on your strategies, and operates reliably around the clock—so you never miss a market move. Ready to level up? Quickly master Senpi by watching this tutorial: https://www.youtube.com/watch?v=<VIDEO_ID>.",
                    action: "LEARN_SENPI",
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
