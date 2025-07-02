import type { Plugin } from "@moxie-protocol/core";
import { discoverGroupsAction } from "./actions/discoverGroupsAction";

const senpiDiscoverPlugin: Plugin = {
    name: "senpi-discover",
    description: "Discover top groups and traders to copy trade on Senpi.",
    actions: [discoverGroupsAction],
    providers: [],
    evaluators: [],
    services: [],
    clients: [],
};

export default senpiDiscoverPlugin;
