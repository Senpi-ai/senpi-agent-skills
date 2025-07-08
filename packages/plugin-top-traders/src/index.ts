import type { Plugin } from "@moxie-protocol/core";
import { discoverTopTradersAction } from "./actions/discoverTopTradersAction";

const topTradersPlugin: Plugin = {
    name: "top-traders",
    description: "Discover top traders to copy trade on Senpi.",
    actions: [discoverTopTradersAction],
    providers: [],
    evaluators: [],
    services: [],
    clients: [],
};

export default topTradersPlugin;
