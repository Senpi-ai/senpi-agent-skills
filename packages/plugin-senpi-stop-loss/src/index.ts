import type { Plugin } from "@moxie-protocol/core";
import { stopLossAction } from "./actions";

const senpiStopLossPlugin: Plugin = {
    name: "senpiStopLossPlugin",
    description: "Execute stop loss actions",
    actions: [
        stopLossAction
    ],
    providers: [],
    evaluators: [],
    services: [],
    clients: [],
};

export default senpiStopLossPlugin;
