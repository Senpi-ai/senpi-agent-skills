import { ActionExample } from "@moxie-protocol/core";

export const sharingExamples: ActionExample[][] = [
    [
        {
            user: "{{user1}}",
            content: {
                text: "Share my Senpi NFT #1234 with @[user2|M456]",
            },
        },
        {
            user: "{{agent}}",
            content: {
                text: `Successfully shared Senpi NFT #1234 with user2!

## Sharing Details
- NFT: Senpi #1234
- Shared with: user2
- Access Level: View & Display
- Duration: 30 days
- Status: Active

The recipient can now view and display this NFT in their collection.`,
                action: "SHARE_SUCCESS",
            },
        },
    ],
    [
        {
            user: "{{user1}}",
            content: {
                text: "Share NFT #5678 with @[user2|M456]",
            },
        },
        {
            user: "{{agent}}",
            content: {
                text: "You don't own Senpi NFT #5678. Please check the NFT ID and try again.",
                action: "SHARE_ERROR",
            },
        },
    ],
    [
        {
            user: "{{user1}}",
            content: {
                text: "Share my Senpi NFT collection with @[user2|M456] and @[user3|M789]",
            },
        },
        {
            user: "{{agent}}",
            content: {
                text: `Successfully shared your Senpi NFT collection!

## Sharing Summary
Shared 3 NFTs with user2 and user3:
- Senpi #1234
- Senpi #2345
- Senpi #3456

### Sharing Details
- Recipients: user2, user3
- Access Level: View & Display
- Duration: 30 days
- Status: Active

All recipients can now view and display these NFTs in their collections.`,
                action: "SHARE_MULTIPLE_SUCCESS",
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
];
