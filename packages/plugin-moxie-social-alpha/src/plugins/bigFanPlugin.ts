import { Plugin } from "@moxie-protocol/core";
import { creatorTweetSummary } from "../actions/twitterSummaryAction";
import { creatorFarcasterSummary } from "../actions/farcasterSummaryAction";
import { creatorSocialSummary } from "../actions/socialSummaryAction";

export const moxieBigFanPlugin: Plugin = {
    name: "Moxie Big Fan plugin",
    description:
        "Provides insights about your favorite creators' activities, including Twitter and Farcaster posts, token swaps, and creator coin transactions",
    actions: [
        creatorTweetSummary,
        creatorFarcasterSummary,
        creatorSocialSummary,
    ],
    providers: [],
    evaluators: [],
    services: [],
    clients: [],
};
