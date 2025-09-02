import type { Plugin } from "@moxie-protocol/core";
import { senpiOrdersAnalysisAction } from "./actions/senpiOrdersAnalysisAction";

const samplePlugin: Plugin = {
    name: "sample",
    description: "Execute sample onchain actions",
    actions: [senpiOrdersAnalysisAction],
    providers: [],
    evaluators: [],
    services: [],
    clients: [],
};

export default samplePlugin;
