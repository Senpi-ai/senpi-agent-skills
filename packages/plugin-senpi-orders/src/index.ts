export * from "./actions/senpiOrdersAction";

import type { Plugin } from "@moxie-protocol/core";
import { senpiOrdersAction } from "./actions/senpiOrdersAction";

export const moxieSwapPlugin: Plugin = {
    name: "senpiOrdersPlugin",
    description: "Senpi Orders plugin",
    providers: [],
    evaluators: [],
    services: [],
    actions: [senpiOrdersAction],
};

export default moxieSwapPlugin;
