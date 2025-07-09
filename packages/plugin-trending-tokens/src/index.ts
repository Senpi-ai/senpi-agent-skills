import type { Plugin } from "@moxie-protocol/core";
import { trendingTokensAction } from "./actions/trendingTokensAction";

const trendingTokensPlugin: Plugin = {
    name: "trending-tokens",
    description: "Fetch trending tokens on Base",
    actions: [trendingTokensAction],
    providers: [],
    evaluators: [],
    services: [],
    clients: [],
};

export default trendingTokensPlugin;
