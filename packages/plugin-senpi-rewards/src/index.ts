import type { Plugin } from "@moxie-protocol/core";
import { checkRewardsAction } from "./actions/checkRewardAction";
import { claimRewardsAction } from "./actions/claimRewardAction";

const senpiRewardsPlugin: Plugin = {
    name: "senpi-rewards",
    description: "View and claim senpi rewards",
    actions: [checkRewardsAction, claimRewardsAction],
    providers: [],
    evaluators: [],
    services: [],
    clients: [],
};

export default senpiRewardsPlugin;
