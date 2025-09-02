import {
    type Action,
    type IAgentRuntime,
    type Memory,
    type HandlerCallback,
    type State,
    elizaLogger,
    type ActionExample,
    composeContext,
    generateObject,
    ModelClass,
} from "@moxie-protocol/core";
import { MoxieWalletClient } from "@moxie-protocol/moxie-agent-lib/src/wallet";
import { formatEther, http, createPublicClient } from "viem";
import { base } from "viem/chains";
import { getTokenBalance } from "../utils/balance";

export const balanceAction: Action = {
    name: "TOKEN_BALANCE_ON_BASE",
    similes: [
        "CHECK_BALANCE_ON_BASE",
        "GET_BALANCE_ON_BASE",
        "VIEW_BALANCE_ON_BASE",
        "SHOW_BALANCE_ON_BASE",
        "WALLET_BALANCE_ON_BASE",
        "ETH_BALANCE_ON_BASE",
        "BASE_BALANCE_ON_BASE",
    ],
    description: "Check the balance of your agent wallet on Base",
    suppressInitialMessage: true,
    validate: async () => true,
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback: HandlerCallback
    ) => {
        const publicClient = createPublicClient({
            chain: base,
            transport: http(),
        });
        const { address } = state.agentWallet as MoxieWalletClient;

        const balance = await publicClient.getBalance({
            address: address as `0x${string}`,
        });
        const balanceAsEther = formatEther(balance);
        // TODO: Add functionality to check ERC20 balance, not just ETH balance
        const tokenBalances = await getTokenBalance(address as `0x${string}`);
        await callback?.({
            text: `The balance of your agent wallet is ${balanceAsEther} ETH.`,
        });
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Can you check my token balance on Base?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "The balance of your agent wallet is 0.01 ETH",
                    action: "TOKEN_BALANCE_ON_BASE",
                },
            },
        ],
    ] as ActionExample[][],
};
