import type { Plugin } from "@moxie-protocol/core";
import { earlybirdAction } from "./actions/earlybirdAction";

const earlybirdsPlugin: Plugin = {
    name: "earlybirds",
    description: "Execute earlybird action to get the early buyers of a set of tokens",
    actions: [earlybirdAction],
    providers: [],
    evaluators: [],
    services: [],
    clients: [],
};

export default earlybirdsPlugin;
