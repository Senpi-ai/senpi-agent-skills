import type { Plugin } from "@moxie-protocol/core";
import { dustWalletAction } from "./actions/dustWalletAction";
import { previewDustAction } from "./actions/dustPreview";
const walletDusterPlugin: Plugin = {
    name: "Wallet Duster",
    description:
        "Dust low-value tokens into ETH using your Senpi agent wallet. If user specifically ask to 'dust tokens' or 'dust my wallet', select the `DUST_WALLET_TO_ETH` action. If user just ask to show/preview the dust tokens, select the `PREVIEW_DUST_TOKENS` action instead.",
    actions: [dustWalletAction, previewDustAction],
    providers: [],
    evaluators: [],
    services: [],
    clients: [],
};

export default walletDusterPlugin;
