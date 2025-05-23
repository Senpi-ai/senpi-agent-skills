import type { Plugin } from "@moxie-protocol/core";
import { dustWalletAction } from "./actions/dustWalletAction";
import { explainAiDustingAction } from "./actions/explainAiDustingAction";
import { previewDustAction } from "./actions/dustPreview";
const aiDusterPlugin: Plugin = {
    name: "AI Duster",
    description:
        "Dust low-value tokens into ETH using your Senpi agent wallet.",
    actions: [dustWalletAction, explainAiDustingAction, previewDustAction],
    providers: [],
    evaluators: [],
    services: [],
    clients: [],
};

export default aiDusterPlugin;
