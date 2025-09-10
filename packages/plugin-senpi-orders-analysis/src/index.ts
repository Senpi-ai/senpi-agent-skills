import type { Plugin } from "@moxie-protocol/core";
import { senpiOrdersAnalysisAction } from "./actions/senpiOrdersAnalysisAction";

const senpiOrdersAnalysisPlugin: Plugin = {
    name: "Senpi Orders Analysis",
    description:
        "Provide users with stas analysis or recommendataions based on their orders to improve their trading strategy, and ultimately improve their trading performance.",
    actions: [senpiOrdersAnalysisAction],
    providers: [],
    evaluators: [],
    services: [],
    clients: [],
};

export default senpiOrdersAnalysisPlugin;
